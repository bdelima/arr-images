#!/usr/bin/env python3
"""tdarr-process-api: a blocking "process this file and tell me when it is done" call on top of Tdarr.

    POST /process   {"path": "/downloads/Some.Show.S01E01.mkv", "library": "<dbID>", "max_wait_seconds": 3600}
    -> 200          {"status": "ok", "reason": null, "message": "...", "decision": "Transcode success", "joined": false}

The caller sends one file path (exactly as Tdarr sees it). The service makes Tdarr process that file from scratch, holds
the HTTP request open until Tdarr has finished, and answers once. Tdarr has no synchronous processing endpoint, so this
is trigger plus poll behind a blocking facade. It is a sibling of tdarr-download-validator (which answers "is this
download ready yet?" at once and leaves the retrying to the caller), not a change to it. It uses the same Tdarr API
the validator uses (/api/v2/scan-files and /api/v2/cruddb); the Tdarr helpers below are copied from validator.py on
purpose, so that the two images stay independent.

Outcomes (status / reason / HTTP):

    ok          null                  200   Tdarr finished with a decision that is not an error (including "Not required")
    error       transcode_failed      422   Tdarr finished with a decision containing "error"
    timeout     still_running         202   the caller's max_wait_seconds elapsed; Tdarr keeps processing, nothing is cancelled
    error       not_picked_up         422   a scan was requested but Tdarr never made a record for the file
    error       record_not_removed    502   the file's old Tdarr record could not be removed (or the removal not verified)
    error       tdarr_unreachable     503   Tdarr was unreachable for longer than UNREACHABLE_SECONDS in a row
    error       bad_request           400   bad JSON, a missing or invalid field, no library

Callers branch on status and reason, never on message (one plain line for a log or a person).

Every call starts a fresh run: the file's old FileJSONDB record is removed (and the removal verified) before the scan
is requested, so an "ok" or "transcode_failed" always comes from a record that did not exist when the call began. A file
that is already staged (queued, processing, or parked at a Require Review node) is never removed or rescanned: the call
joins that run instead and answers "joined": true. Two calls for the same file and library at once share one run.
A call keeps waiting while a file sits at Require Review (a job at review is still in progress).

The library is, in order: the request's "library"; else TDARR_LIBRARY_MAP, a JSON object mapping a path prefix to a
library dbID (the longest prefix the path is under wins); else TDARR_LIBRARY_ID; else the request is a 400. "library"
and "max_wait_seconds" may be null, which counts as omitted.

Standard library only. Configuration (environment):

    TDARR_URL              Tdarr server, e.g. http://192.168.0.50:8266 (required)
    TDARR_LIBRARY_ID       default library dbID (optional: a caller may always send "library")
    TDARR_LIBRARY_MAP      optional JSON object: path prefix -> library dbID
    PORT                   listen port (default 8080)
    TDARR_TIMEOUT_SECONDS  timeout of each single Tdarr call (default 8)
    POLL_SECONDS           delay between polls while waiting (default 5)
    SCAN_PICKUP_SECONDS    after a scan request, how long to wait for Tdarr to make a record (default 120)
    SCAN_RETRY_SECONDS     while there is no record, how often the scan request is repeated (default 60)
    UNREACHABLE_SECONDS    how long Tdarr may stay unreachable, in a row, before 503 (default 300)
    TDARR_PROCESS_API_VERSION  the image's version, reported by /health (set by the Dockerfile)

There is deliberately no overall wait limit setting: by default a call waits as long as Tdarr takes, and only the caller
sets a maximum. Run one instance only: the runs live in this process's memory.
"""
import json
import logging
import math
import os
import posixpath
import re
import select
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("tdarr-process-api")

MAX_BODY_BYTES = 64 * 1024          # a request body larger than this is a 400
DRAIN_LIMIT_BYTES = 1024 * 1024     # how much of an oversized body is read and thrown away before answering

# status, reason -> HTTP status code
HTTP_STATUS = {
    ("ok", None): 200,
    ("error", "transcode_failed"): 422,
    ("timeout", "still_running"): 202,
    ("error", "not_picked_up"): 422,
    ("error", "record_not_removed"): 502,
    ("error", "tdarr_unreachable"): 503,
    ("error", "bad_request"): 400,
}


# --- Tdarr: copied from tdarr-download-validator/validator.py (do not import from it; see the header) ---------------

class TdarrError(Exception):
    """Tdarr could not be reached, did not answer in time, or answered with something unusable."""


class TdarrRefused(TdarrError):
    """Tdarr answered, with an HTTP error status."""


def _norm(path):
    path = path.replace("\\", "/")
    return posixpath.normpath(path) if path else path


def _under(candidate, folder):
    return candidate == folder or candidate.startswith(folder.rstrip("/") + "/")


class Tdarr:
    def __init__(self, url, timeout):
        self.url = url.rstrip("/")
        self.timeout = timeout

    def _post_raw(self, endpoint, data):
        """POST and return the raw response bytes, without trying to parse them as JSON.

        scan-files answers a successful call with a plain-text "OK", not JSON; callers that don't need the
        response body (scan()) use this directly instead of _post, so that reply is not mistaken for a failure.
        """
        body = json.dumps({"data": data}).encode()
        req = urllib.request.Request(
            self.url + endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            raise TdarrRefused(f"{endpoint}: HTTP {exc.code}") from exc
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise TdarrError(f"{endpoint}: {exc}") from exc

    def _post(self, endpoint, data):
        raw = self._post_raw(endpoint, data)
        if not raw.strip():
            return None
        try:
            return json.loads(raw)
        except ValueError as exc:
            raise TdarrError(f"{endpoint}: unparseable response") from exc

    @staticmethod
    def _doc(value):
        # a miss comes back as null, an empty string or an empty object, depending on the Tdarr version
        return value if isinstance(value, dict) and value.get("_id") else None

    def get_by_id(self, collection, doc_id):
        return self._doc(self._post("/api/v2/cruddb",
                                    {"collection": collection, "mode": "getById", "docID": doc_id}))

    def remove_one(self, collection, doc_id):
        self._post("/api/v2/cruddb", {"collection": collection, "mode": "removeOne", "docID": doc_id})

    def scan(self, paths, library_id):
        # the response is discarded either way (and is plain text "OK" on success, not JSON) -- _post_raw,
        # not _post, so a successful scan is never mistaken for an "unparseable response" failure.
        self._post_raw("/api/v2/scan-files", {"scanConfig": {
            "dbID": library_id, "arrayOrPath": list(paths), "mode": "scanFolderWatcher"}})


def _decision(doc):
    return str(doc.get("TranscodeDecisionMaker") or "").strip()


def _load_library_map(raw, logger=log):
    """Parse TDARR_LIBRARY_MAP. Empty/unset -> {}. Invalid JSON or a non-object is logged and treated as {} --
    the service still starts and falls back to TDARR_LIBRARY_ID for every request, same as if it were unset."""
    raw = (raw or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        logger.warning("TDARR_LIBRARY_MAP is not valid JSON (%s); every request falls back to TDARR_LIBRARY_ID", exc)
        return {}
    if not isinstance(parsed, dict) or not all(isinstance(v, str) for v in parsed.values()):
        logger.warning("TDARR_LIBRARY_MAP must be a JSON object of path prefix -> dbID strings; "
                        "every request falls back to TDARR_LIBRARY_ID")
        return {}
    return parsed


# --- configuration -----------------------------------------------------------------------------------------------

@dataclass
class Config:
    url: str
    default_library: str = ""
    library_map: dict = field(default_factory=dict)     # path prefix -> library dbID
    tdarr_timeout: float = 8.0
    poll: float = 5.0
    scan_pickup: float = 120.0
    scan_retry: float = 60.0
    unreachable: float = 300.0

    def __post_init__(self):
        # prefixes are matched on normalised paths, longest first
        self.library_map = {_norm(k.strip()).rstrip("/") or "/": v for k, v in (self.library_map or {}).items()
                            if isinstance(k, str) and k.strip()}


def _env_number(name, default, env):
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        sys.exit(f"{name} must be a positive number, got {raw!r}")
    if not math.isfinite(value) or value <= 0:
        sys.exit(f"{name} must be a positive number, got {raw!r}")
    return value


def config_from_env(env):
    url = (env.get("TDARR_URL") or "").strip()
    if not url:
        sys.exit("TDARR_URL must be set")
    return Config(
        url=url,
        default_library=(env.get("TDARR_LIBRARY_ID") or "").strip(),
        library_map=_load_library_map(env.get("TDARR_LIBRARY_MAP", "")),
        tdarr_timeout=_env_number("TDARR_TIMEOUT_SECONDS", 8.0, env),
        poll=_env_number("POLL_SECONDS", 5.0, env),
        scan_pickup=_env_number("SCAN_PICKUP_SECONDS", 120.0, env),
        scan_retry=_env_number("SCAN_RETRY_SECONDS", 60.0, env),
        unreachable=_env_number("UNREACHABLE_SECONDS", 300.0, env),
    )


def resolve_library(config, path, requested):
    """The library a call uses: the request's, else the longest map prefix the path is under, else the default,
    else None."""
    if requested:
        return requested
    best = None
    for prefix in config.library_map:
        if _under(path, prefix) and (best is None or len(prefix) > len(best)):
            best = prefix
    if best is not None:
        return config.library_map[best]
    return config.default_library or None


# --- the service -------------------------------------------------------------------------------------------------

@dataclass
class Result:
    status: str
    reason: object
    message: str
    decision: object = None
    joined: bool = False

    def body(self):
        return {"status": self.status, "reason": self.reason, "message": self.message,
                "decision": self.decision, "joined": self.joined}

    def http_status(self):
        return HTTP_STATUS[(self.status, self.reason)]


class Stop(Exception):
    """Ends one call. result None: the caller went away and nothing is written."""

    def __init__(self, result):
        super().__init__()
        self.result = result


class Run:
    """What the calls for one (library, path) share. Reference counted by the calls attached to it."""

    def __init__(self, key, library, path):
        self.key = key
        self.library = library
        self.path = path
        self.refs = 0
        self.lock = threading.Lock()
        self.setup_done = threading.Event()
        self.setup_failure = None       # a Result when the setup failed
        self.abandoned = False          # the creating call left before the setup was done
        self.seen_staged = False
        self.last_scan = None
        self.no_record_since = None


class Call:
    """One POST /process."""

    def __init__(self, deadline, is_closed):
        self.deadline = deadline
        self.is_closed = is_closed
        self.joined = False
        self.down_since = None


class Service:
    def __init__(self, config, version="unknown", clock=time.monotonic):
        self.config = config
        self.version = version
        self.clock = clock
        self.tdarr = Tdarr(config.url, config.tdarr_timeout)
        self._lock = threading.Lock()
        self._runs = {}
        self._calls = 0

    # observable state, for tests and for a curious operator
    def active_runs(self):
        with self._lock:
            return len(self._runs)

    def active_calls(self):
        with self._lock:
            return self._calls

    # -- one call ---------------------------------------------------------------------------------------------

    def process(self, path, library, max_wait=None, is_closed=lambda: False):
        """Runs one call to its end. Returns a Result, or None when the caller went away."""
        call = Call(self.clock() + max_wait if max_wait else None, is_closed)
        key = (library, path)
        with self._lock:
            self._calls += 1
        log.info("accepted: %s library=%s%s", path, library, f" max_wait={max_wait:g}s" if max_wait else "")
        try:
            while True:
                run, creator = self._attach(key, library, path)
                try:
                    if creator:
                        outcome = self._setup(run, call)
                    else:
                        call.joined = True
                        log.info("joined: %s library=%s", path, library)
                        outcome = self._await_setup(run, call)
                        if outcome == "retry":
                            continue
                    if outcome is None:
                        outcome = self._wait(run, call)
                    outcome.joined = call.joined
                    log.info("outcome: %s library=%s -> %s %s (%s)", path, library, outcome.status,
                             outcome.reason or "", outcome.decision or "")
                    return outcome
                except Stop as stop:
                    if stop.result is not None:
                        stop.result.joined = call.joined
                        log.info("outcome: %s library=%s -> %s %s", path, library, stop.result.status,
                                 stop.result.reason)
                    else:
                        log.info("caller disconnected: %s library=%s", path, library)
                    return stop.result
                finally:
                    self._detach(run, creator)
        finally:
            with self._lock:
                self._calls -= 1

    def _attach(self, key, library, path):
        with self._lock:
            run = self._runs.get(key)
            if run is not None and (run.abandoned or run.setup_failure is not None):
                run = None      # a run that never got going is not joined; this call starts a new one
            creator = run is None
            if creator:
                run = Run(key, library, path)
                self._runs[key] = run
            run.refs += 1
            return run, creator

    def _detach(self, run, creator):
        if creator and not run.setup_done.is_set():
            # left before the setup finished: whoever is waiting for it starts over
            run.abandoned = True
            run.setup_done.set()
        with self._lock:
            run.refs -= 1
            if (run.refs <= 0 or run.abandoned or run.setup_failure is not None) and self._runs.get(run.key) is run:
                del self._runs[run.key]

    # -- waiting and calling Tdarr ------------------------------------------------------------------------------

    def _check(self, call):
        if call.is_closed():
            raise Stop(None)
        if call.deadline is not None and self.clock() >= call.deadline:
            raise Stop(Result("timeout", "still_running",
                              "the maximum wait elapsed; Tdarr keeps processing the file"))

    def _sleep(self, call, seconds):
        if call.deadline is not None:
            seconds = min(seconds, max(0.0, call.deadline - self.clock()))
        if seconds > 0:
            time.sleep(seconds)
        self._check(call)

    def _tdarr(self, call, fn, refused="retry"):
        """fn() against Tdarr. Unreachable (or, with refused="retry", an HTTP error): retried on the poll cadence until
        Tdarr has been down for UNREACHABLE_SECONDS in a row (then Stop with 503). Any success resets that clock.
        With refused="raise" a TdarrRefused is passed up to the caller."""
        while True:
            self._check(call)
            try:
                value = fn()
            except TdarrRefused as exc:
                if refused == "raise":
                    raise
                failure = exc
            except TdarrError as exc:
                failure = exc
            else:
                call.down_since = None
                return value
            now = self.clock()
            if call.down_since is None:
                call.down_since = now
            left = self.config.unreachable - (now - call.down_since)
            if left <= 0:
                raise Stop(Result("error", "tdarr_unreachable",
                                  f"Tdarr has been unreachable for {self.config.unreachable:g} s: {failure}"))
            log.warning("Tdarr call failed (%s); retrying", failure)
            self._sleep(call, min(self.config.poll, left))

    # -- setup: the creating call ---------------------------------------------------------------------------------

    def _setup(self, run, call):
        """Old record out, scan in. Returns None when the run is set up (the caller goes on to wait), or a Result."""
        path, library = run.path, run.library
        tdarr = self.tdarr
        # a Stop raised below leaves setup_done unset: _detach then marks the run abandoned, and a joined call starts over
        if self._tdarr(call, lambda: tdarr.get_by_id("StagedJSONDB", path)):
            # already queued or running: never remove or rescan, just wait for that run
            call.joined = True
            run.seen_staged = True
            log.info("staged seen: %s library=%s (already in Tdarr; waiting for it)", path, library)
            run.setup_done.set()
            return None
        if self._tdarr(call, lambda: tdarr.get_by_id("FileJSONDB", path)):
            try:
                self._tdarr(call, lambda: tdarr.remove_one("FileJSONDB", path), refused="raise")
            except TdarrRefused as exc:
                return self._setup_failed(run, Result("error", "record_not_removed",
                                                      f"Tdarr refused to remove the old record: {exc}"))
            if self._tdarr(call, lambda: tdarr.get_by_id("FileJSONDB", path)):
                return self._setup_failed(run, Result("error", "record_not_removed",
                                                      "the old Tdarr record is still there after removing it"))
            log.info("record removed: %s library=%s", path, library)
        self._tdarr(call, lambda: tdarr.scan([path], library))
        now = self.clock()
        run.last_scan = now
        run.no_record_since = now
        log.info("scan requested: %s library=%s", path, library)
        run.setup_done.set()
        return None

    @staticmethod
    def _setup_failed(run, result):
        run.setup_failure = result
        run.setup_done.set()
        return result

    def _await_setup(self, run, call):
        """A joining call waits for the creating call's setup. None: set up; "retry": the creator left, start over;
        a Result: the setup failed."""
        while not run.setup_done.is_set():
            self._check(call)
            run.setup_done.wait(min(self.config.poll, 0.05))
        if run.abandoned:
            return "retry"
        if run.setup_failure is not None:
            return Result(run.setup_failure.status, run.setup_failure.reason, run.setup_failure.message)
        return None

    # -- waiting for the outcome ------------------------------------------------------------------------------

    def _wait(self, run, call):
        path, library = run.path, run.library
        tdarr, cfg = self.tdarr, self.config
        settling = None     # a finished decision read once since staging ended; it counts when read twice in a row
        while True:
            self._check(call)
            if self._tdarr(call, lambda: tdarr.get_by_id("StagedJSONDB", path)):
                # in progress, including parked at a Require Review node
                if not run.seen_staged:
                    log.info("staged seen: %s library=%s", path, library)
                run.seen_staged = True
                run.no_record_since = None
                settling = None
                self._sleep(call, cfg.poll)
                continue
            doc = self._tdarr(call, lambda: tdarr.get_by_id("FileJSONDB", path))
            now = self.clock()
            if doc:
                run.no_record_since = None
                decision = _decision(doc)
                if decision.lower() in ("", "queued"):
                    settling = None
                elif not run.seen_staged or settling == decision:
                    # Tdarr un-stages a file and updates its record at slightly different moments; after seeing the
                    # run staged, the same finished decision twice in a row is what counts
                    if "error" in decision.lower():
                        return Result("error", "transcode_failed", f"Tdarr: {decision}", decision)
                    return Result("ok", None, f"Tdarr: {decision}", decision)
                else:
                    settling = decision
            else:
                settling = None
                with run.lock:
                    if run.last_scan is None:       # joined a run that was already in Tdarr: no scan of ours yet
                        run.last_scan = now
                    if run.no_record_since is None:
                        run.no_record_since = now
                    waited = now - run.no_record_since
                    rescan = now - run.last_scan >= cfg.scan_retry
                    if rescan and waited < cfg.scan_pickup:
                        run.last_scan = now
                    else:
                        rescan = False
                if waited >= cfg.scan_pickup:
                    return Result("error", "not_picked_up",
                                  f"Tdarr did not create a record for the file within {cfg.scan_pickup:g} s of the scan")
                if rescan:
                    self._tdarr(call, lambda: tdarr.scan([path], library))
                    log.info("scan requested again: %s library=%s", path, library)
            self._sleep(call, cfg.poll)


# --- HTTP ---------------------------------------------------------------------------------------------------------

def _socket_closed(sock):
    """True when the caller has closed its end: the socket is readable and a peek finds end-of-file."""
    try:
        readable, _, _ = select.select([sock], [], [], 0)
        if not readable:
            return False
        return sock.recv(1, socket.MSG_PEEK) == b""
    except (OSError, ValueError):
        return True


class BadRequest(Exception):
    pass


_DRIVE_PATH = re.compile(r"^[A-Za-z]:[\\/]")


def parse_request(raw):
    """(path, library, max_wait) from a request body, or BadRequest with a message."""
    try:
        parsed = json.loads(raw or b"")
    except ValueError:
        raise BadRequest("the body is not valid JSON")
    if not isinstance(parsed, dict):
        raise BadRequest("the body must be a JSON object")
    path = parsed.get("path")
    if not isinstance(path, str) or not path.strip():
        raise BadRequest('"path" is required: one file path, as Tdarr sees it')
    path = path.strip()
    if "\0" in path:
        raise BadRequest('"path" contains a NUL character')
    if not (path.startswith(("/", "\\")) or _DRIVE_PATH.match(path)):
        raise BadRequest('"path" must be an absolute path')
    library = parsed.get("library")
    if library is not None and (not isinstance(library, str) or not library.strip()):
        raise BadRequest('"library" must be a non-empty string')
    max_wait = parsed.get("max_wait_seconds")
    if max_wait is not None:
        if isinstance(max_wait, bool) or not isinstance(max_wait, (int, float)) \
                or not math.isfinite(max_wait) or max_wait <= 0:
            raise BadRequest('"max_wait_seconds" must be a positive number')
    return _norm(path), (library.strip() if library else None), max_wait


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "tdarr-process-api"

        def log_message(self, fmt, *args):  # route http.server's access log through logging
            log.debug("%s - %s", self.address_string(), fmt % args)

        def _send(self, obj, status=200, headers=None):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(body)

        def _bad(self, message):
            self._send(Result("error", "bad_request", message).body(), 400)

        def _drain(self):
            """Read and throw away the request body (up to a limit), so that an answer sent without using it is not
            lost in a connection reset when the connection closes with the caller's bytes still unread."""
            try:
                left = min(int(self.headers.get("Content-Length") or 0), DRAIN_LIMIT_BYTES)
            except ValueError:
                return
            while left > 0:
                chunk = self.rfile.read(min(left, 65536))
                if not chunk:
                    break
                left -= len(chunk)

        def _route(self, method):
            if self.path == "/health":
                allowed = "GET"
            elif self.path == "/process":
                allowed = "POST"
            else:
                self._drain()
                self._send({"message": "not found"}, 404)
                return False
            if method != allowed:
                self._drain()
                self._send({"message": "method not allowed"}, 405, {"Allow": allowed})
                return False
            return True

        def do_GET(self):  # noqa: N802
            if self._route("GET"):
                self._send({"ok": True, "version": service.version})

        def do_POST(self):  # noqa: N802
            if not self._route("POST"):
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0:
                self._bad("Content-Length is not a number")
                return
            if length > MAX_BODY_BYTES:
                self._drain()
                self._bad(f"the body is larger than {MAX_BODY_BYTES} bytes")
                return
            try:
                path, library, max_wait = parse_request(self.rfile.read(length))
            except BadRequest as exc:
                self._bad(str(exc))
                return
            library = resolve_library(service.config, path, library)
            if not library:
                self._bad('no library: send "library", or set TDARR_LIBRARY_MAP or TDARR_LIBRARY_ID')
                return
            result = service.process(path, library, max_wait, is_closed=lambda: _socket_closed(self.connection))
            if result is None:
                return      # the caller went away: nothing to write
            try:
                self._send(result.body(), result.http_status())
            except OSError:
                log.info("caller disconnected before the answer for %s was written", path)

        def _other(self):
            self._route(self.command)

        do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _other  # noqa: N815

    return Handler


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(message)s")
    config = config_from_env(os.environ)
    try:
        port = int(os.environ.get("PORT", "8080"))
    except ValueError:
        sys.exit("PORT must be a whole number")
    version = (os.environ.get("TDARR_PROCESS_API_VERSION") or "unknown").strip() or "unknown"
    service = Service(config, version=version)
    log.info("listening on :%d (version %s), Tdarr at %s, default library %s, library map for %s",
             port, version, config.url, config.default_library or "(none)", sorted(config.library_map) or "(none)")
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(service)).serve_forever()


if __name__ == "__main__":
    main()
