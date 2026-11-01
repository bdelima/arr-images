#!/usr/bin/env python3
"""tdarr-download-validator: the PreImportValidator service for Sonarr, Radarr and Sportarr.

The arr apps (with the preimport-validator patch) call it before importing a completed download:

    POST /validate   {"path": "<file or folder>"}
    -> 200           {"ready": bool, "failed": bool, "message": str}

It answers from Tdarr's own records and starts Tdarr on a download it has not seen yet:

    processing  the path (or a file under it) is in Tdarr's staged collection, so a Flow is running    -> not ready
    failed      Tdarr decided on a file and the decision says "error"                                  -> failed
    triggered   Tdarr has not decided anything about the path yet; a scan is requested (at most once
                per TRIGGER_DEDUP_SECONDS per path)                                                    -> not ready
    done        every file Tdarr knows under the path has a decision that is not an error              -> ready

The arr apps send the download's folder for multi-file downloads and the file itself otherwise. Tdarr keeps its
records per file, keyed by the file's absolute path, so a folder is answered from the records whose path is under
it. Every container must therefore see the downloads under the same path (as the compose file does).

Tdarr's scan API (scanFolderWatcher) only accepts individual file paths, never a folder, so triggering a scan on a
folder walks it on disk for its real files first (this container needs read access to the same downloads tree, same
path, as the arr apps and Tdarr -- mount it read-only). Every file found is handed over, including non-video extras
(.nfo, .txt, subtitles): nothing is filtered here, since the Tdarr library's own scan-level filter (Filters ->
Container types to scan for) already ignores anything outside its configured extensions. If the path isn't visible
on disk (no mount, or it is already gone), the bare path is sent as-is, same as before this walk was added -- which
still works for a single file, just not for a folder.

A successful scan-files call answers with a plain-text "OK", not JSON; that response is never parsed, so it is never
mistaken for a failure.

Standard library only. Configuration (environment):

    TDARR_URL              e.g. http://192.168.0.50:8266 (the Tdarr server port)
    TDARR_LIBRARY_ID       dbID of the library the downloads belong to
    PORT                   listen port (default 8080)
    TRIGGER_DEDUP_SECONDS  minimum seconds between scan requests for one path (default 60)
    TDARR_TIMEOUT_SECONDS  timeout of each call to Tdarr (default 8; the arr apps give up on us after 10)
"""
import json
import logging
import os
import posixpath
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("tdarr-download-validator")


class TdarrError(Exception):
    pass


def _norm(path):
    path = path.replace("\\", "/")
    return posixpath.normpath(path) if path else path


def _under(candidate, folder):
    return candidate == folder or candidate.startswith(folder.rstrip("/") + "/")


class Tdarr:
    def __init__(self, url, library_id, timeout):
        self.url = url.rstrip("/")
        self.library_id = library_id
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

    def get_all(self, collection):
        value = self._post("/api/v2/cruddb", {"collection": collection, "mode": "getAll"})
        if value is None:
            return []
        if not isinstance(value, list):
            raise TdarrError(f"getAll {collection}: expected a list")
        return [d for d in value if self._doc(d)]

    def scan(self, paths):
        # the response is discarded either way (and is plain text "OK" on success, not JSON) -- _post_raw,
        # not _post, so a successful scan is never mistaken for an "unparseable response" failure
        self._post_raw("/api/v2/scan-files", {"scanConfig": {
            "dbID": self.library_id, "arrayOrPath": list(paths), "mode": "scanFolderWatcher"}})


def _decision(doc):
    return str(doc.get("TranscodeDecisionMaker") or "").strip()


class Validator:
    def __init__(self, tdarr, dedup_seconds=60, clock=time.time):
        self.tdarr = tdarr
        self.dedup_seconds = dedup_seconds
        self.clock = clock
        self._triggered = {}
        self._lock = threading.Lock()

    def _records(self, path):
        """Return (staged, files): the Tdarr records for a file, or for the files under a folder."""
        staged = self.tdarr.get_by_id("StagedJSONDB", path)
        file = self.tdarr.get_by_id("FileJSONDB", path)
        if staged or file:
            return ([staged] if staged else []), ([file] if file else [])
        # Not a file Tdarr knows: the path may be a download folder.
        staged = [d for d in self.tdarr.get_all("StagedJSONDB") if _under(_norm(d["_id"]), path)]
        files = [d for d in self.tdarr.get_all("FileJSONDB") if _under(_norm(d["_id"]), path)]
        return staged, files

    def _resolve_scan_targets(self, path):
        """The actual file paths to hand scanFolderWatcher for `path`.

        scanFolderWatcher only accepts individual file paths, never a folder, so a multi-file download's folder is
        walked on disk here for its real files. Nothing is filtered out: the Tdarr library's own scan-level filter
        (Filters -> Container types to scan for) already drops non-video extras like .nfo/.txt. If `path` is not
        visible on disk at all (no mount, or it is already gone), fall back to the bare path so this degrades to
        the old behaviour -- correct for a single file, a no-op for a folder -- instead of scanning nothing.
        """
        if os.path.isfile(path):
            return [path]
        if os.path.isdir(path):
            found = [_norm(os.path.join(root, name)) for root, _dirs, files in os.walk(path) for name in files]
            return sorted(found)
        return [path]

    def _trigger(self, path):
        now = self.clock()
        with self._lock:
            last = self._triggered.get(path)
            if last is not None and now - last < self.dedup_seconds:
                return False
            self._triggered[path] = now
            # forget old entries so the map cannot grow without bound
            for key in [k for k, t in self._triggered.items() if now - t >= self.dedup_seconds]:
                if key != path:
                    del self._triggered[key]
        targets = self._resolve_scan_targets(path)
        if targets:
            self.tdarr.scan(targets)
        return True

    def validate(self, path):
        path = _norm(path)
        staged, files = self._records(path)
        if staged:
            return {"ready": False, "message": f"processing ({len(staged)} file(s) in a Flow)"}
        errors = [d for d in files if "error" in _decision(d).lower()]
        if errors:
            first = errors[0]
            return {"ready": False, "failed": True,
                    "message": f"Tdarr: {_decision(first)} ({first['_id']})"}
        pending = [d for d in files if _decision(d).lower() in ("", "queued")]
        if not files or pending:
            if self._trigger(path):
                return {"ready": False, "message": "triggered"}
            return {"ready": False, "message": "triggered, waiting for Tdarr to pick it up"}
        return {"ready": True, "message": f"done ({len(files)} file(s))"}

    def safe_validate(self, path):
        """Never raises: a Tdarr problem is 'not ready', logged, so the arr app defers and asks again."""
        try:
            return self.validate(path)
        except TdarrError as exc:
            log.warning("Tdarr call failed for %s: %s", path, exc)
            return {"ready": False, "message": f"Tdarr unreachable or unusable: {exc}"}
        except Exception as exc:  # noqa: BLE001 - the contract is "always an answer"
            log.exception("unexpected error validating %s", path)
            return {"ready": False, "message": f"internal error: {exc}"}


def make_handler(validator):
    class Handler(BaseHTTPRequestHandler):
        server_version = "tdarr-download-validator"

        def log_message(self, fmt, *args):  # route http.server's access log through logging
            log.debug("%s - %s", self.address_string(), fmt % args)

        def _send(self, obj, status=200):
            body = json.dumps(obj).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path == "/health":
                self._send({"ok": True})
            else:
                self._send({"message": "not found"}, 404)

        def do_POST(self):  # noqa: N802
            if self.path != "/validate":
                self._send({"message": "not found"}, 404)
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                path = json.loads(self.rfile.read(length) or b"{}").get("path")
            except (ValueError, AttributeError):
                path = None
            if not isinstance(path, str) or not path.strip():
                self._send({"ready": False, "message": 'bad request: expected {"path": "<path>"}'})
                return
            result = validator.safe_validate(path)
            level = logging.INFO if result.get("message") != "triggered, waiting for Tdarr to pick it up" else logging.DEBUG
            log.log(level, "%s -> ready=%s failed=%s %s", path, result["ready"],
                    result.get("failed", False), result.get("message", ""))
            self._send(result)

    return Handler


def main():
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(message)s")
    url = os.environ.get("TDARR_URL", "").strip()
    library = os.environ.get("TDARR_LIBRARY_ID", "").strip()
    if not url or not library:
        sys.exit("TDARR_URL and TDARR_LIBRARY_ID must be set")
    port = int(os.environ.get("PORT", "8080"))
    tdarr = Tdarr(url, library, float(os.environ.get("TDARR_TIMEOUT_SECONDS", "8")))
    validator = Validator(tdarr, float(os.environ.get("TRIGGER_DEDUP_SECONDS", "60")))
    log.info("listening on :%d, Tdarr at %s, library %s", port, url, library)
    ThreadingHTTPServer(("0.0.0.0", port), make_handler(validator)).serve_forever()


if __name__ == "__main__":
    main()
