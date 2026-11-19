"""Tests for process_api.py against a fake Tdarr server. Run: python3 -m unittest discover -s tdarr-process-api -v

Every case drives the real HTTP service against a fake Tdarr over real HTTP. The fake is the one from
tdarr-download-validator/test_validator.py, extended with an event log and with scripted records: a script is a list of
steps for one path; step N runs on the Nth read of that path's StagedJSONDB record (read 0 is the service's own look at
arrival), before the read is answered, and changes the fake's records. The polling intervals are milliseconds, so the
suite runs in seconds."""
import json
import socket
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer

import logging

import process_api

process_api.log.setLevel(logging.CRITICAL)      # the service logs every Tdarr retry and outcome; keep the suite quiet

P = "/downloads/Some.Show.S01E01.mkv"
OTHER = "/downloads/Other.Show.S02E02.mkv"


class FakeTdarr:
    """Just enough of /api/v2/cruddb and /api/v2/scan-files."""

    def __init__(self):
        self.staged = {}
        self.files = {}
        self.scans = []
        self.removed = []
        self.events = []             # in order: ("getById", collection, path, decision or None), ("removeOne", ...), ("scan", path)
        self.down = False            # every call answers 500
        self.fail_remove = False     # removeOne answers 500
        self.remove_noop = False     # removeOne answers 200 but removes nothing
        self.scripts = {}            # path -> list of steps, each a callable taking this fake
        self.staged_reads = {}       # path -> number of StagedJSONDB reads so far
        self.lock = threading.Lock()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _answer(self, out):
                body = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):  # noqa: N802
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["data"]
                with fake.lock:
                    if fake.down:
                        self.send_response(500)
                        self.end_headers()
                        return
                    if self.path == "/api/v2/scan-files":
                        for scanned in data["scanConfig"]["arrayOrPath"]:
                            fake.events.append(("scan", scanned))
                        fake.scans.append(data["scanConfig"])
                        # the real Tdarr answers a successful scan with plain text "OK", not JSON
                        body = b"OK"
                        self.send_response(200)
                        self.send_header("Content-Type", "text/plain; charset=utf-8")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    if self.path != "/api/v2/cruddb":
                        self.send_response(404)
                        self.end_headers()
                        return
                    is_staged = data["collection"] == "StagedJSONDB"
                    table = fake.staged if is_staged else fake.files
                    out = None
                    if data["mode"] == "getById":
                        path = data["docID"]
                        if is_staged:
                            n = fake.staged_reads.get(path, 0)
                            fake.staged_reads[path] = n + 1
                            steps = fake.scripts.get(path, [])
                            if n < len(steps):
                                steps[n](fake)
                        out = table.get(path, "")
                        decision = out.get("TranscodeDecisionMaker") if isinstance(out, dict) else None
                        fake.events.append(("getById", data["collection"], path, decision))
                    elif data["mode"] == "removeOne":
                        if fake.fail_remove:
                            self.send_response(500)
                            self.end_headers()
                            return
                        fake.events.append(("removeOne", data["collection"], data["docID"]))
                        fake.removed.append((data["collection"], data["docID"]))
                        if not fake.remove_noop:
                            table.pop(data["docID"], None)
                self._answer(out)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.02), daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def file(self, path, decision):
        self.files[path] = {"_id": path, "TranscodeDecisionMaker": decision}

    def stage(self, path):
        self.staged[path] = {"_id": path}

    def script(self, path, *steps):
        self.scripts[path] = list(steps)
        self.staged_reads[path] = 0


# steps for FakeTdarr.script
def nothing(fake):
    pass


def stage(path=P):
    return lambda fake: fake.stage(path)


def finish(decision, path=P):
    """Tdarr un-stages the file and writes its record."""
    def step(fake):
        fake.staged.pop(path, None)
        fake.file(path, decision)
    return step


def record(decision, path=P):
    """A record appears without the file ever being seen staged."""
    return lambda fake: fake.file(path, decision)


class Env:
    """The service on a real port, in front of a fake Tdarr."""

    def __init__(self, default_library="lib1", library_map=None, **overrides):
        self.tdarr = FakeTdarr()
        settings = dict(tdarr_timeout=2.0, poll=0.02, scan_pickup=0.5, scan_retry=0.1, unreachable=0.5)
        settings.update(overrides)
        self.config = process_api.Config(url=self.tdarr.url, default_library=default_library,
                                         library_map=library_map or {}, **settings)
        self.service = process_api.Service(self.config, version="9.9.9")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), process_api.make_handler(self.service))
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.02), daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.tdarr.close()

    def request(self, method, path, body=None, timeout=15):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.url + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"} if data is not None else {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, json.loads(resp.read() or b"null")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"null")

    def process(self, body, timeout=15):
        return self.request("POST", "/process", body, timeout)

    def process_in_thread(self, body, results, key):
        def run():
            results[key] = self.process(body)
        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def wait_for(self, condition, seconds=5.0):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if condition():
                return True
            time.sleep(0.01)
        return False


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.tdarr = self.env.tdarr

    def tearDown(self):
        self.env.close()

    def events_of(self, kind):
        return [i for i, e in enumerate(self.tdarr.events) if e[0] == kind]

    def test_happy_path(self):
        self.tdarr.script(P, nothing, nothing, stage(), nothing, finish("Transcode success"))
        status, body = self.env.process({"path": P})
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertIsNone(body["reason"])
        self.assertEqual(body["decision"], "Transcode success")
        self.assertFalse(body["joined"])
        self.assertEqual(len(self.tdarr.scans), 1)
        self.assertEqual(self.tdarr.scans[0], {"dbID": "lib1", "arrayOrPath": [P], "mode": "scanFolderWatcher"})
        self.assertEqual(self.tdarr.removed, [])
        self.assertEqual(self.env.service.active_runs(), 0)
        self.assertEqual(self.env.service.active_calls(), 0)

    def test_not_required_is_ok(self):
        self.tdarr.script(P, nothing, nothing, stage(), finish("Not required"))
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"], body["decision"]), (200, "ok", "Not required"))

    def test_failure(self):
        self.tdarr.script(P, nothing, nothing, stage(), nothing, finish("Transcode error"))
        status, body = self.env.process({"path": P})
        self.assertEqual(status, 422)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["reason"], "transcode_failed")
        self.assertEqual(body["decision"], "Transcode error")

    def test_always_re_runs_an_unchanged_file(self):
        self.tdarr.file(P, "Transcode success")      # processed before, nothing staged
        self.tdarr.script(P, nothing, nothing, stage(), nothing, finish("Transcode success"))
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"]), (200, "ok"))
        removal = self.events_of("removeOne")
        scan = self.events_of("scan")
        self.assertEqual(len(removal), 1)
        self.assertEqual(len(scan), 1)
        # the order: removal, then a read that verifies it, then the scan
        verifying = [i for i in self.events_of("getById") if self.tdarr.events[i][1] == "FileJSONDB"
                     and removal[0] < i < scan[0]]
        self.assertEqual(len(verifying), 1)
        self.assertIsNone(self.tdarr.events[verifying[0]][3])
        self.assertLess(removal[0], verifying[0])
        self.assertLess(verifying[0], scan[0])

    def test_a_stale_result_is_not_mistaken_for_done(self):
        # after the removal Tdarr has no record for a while, then a finished one that was never seen staged
        self.tdarr.file(P, "Transcode error")        # the old run's result, removed first
        self.tdarr.script(P, nothing, nothing, nothing, nothing, nothing, record("Transcode success"))
        started = time.monotonic()
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"], body["decision"]), (200, "ok", "Transcode success"))
        self.assertGreaterEqual(time.monotonic() - started, 4 * 0.02)
        # the old decision was never reported, and it was never read after the removal
        removal = self.events_of("removeOne")[0]
        self.assertNotIn("Transcode error", [e[3] for e in self.tdarr.events[removal + 1:] if e[0] == "getById"])

    def test_removal_that_fails(self):
        self.tdarr.file(P, "Transcode success")
        self.tdarr.fail_remove = True
        status, body = self.env.process({"path": P})
        self.assertEqual(status, 502)
        self.assertEqual((body["status"], body["reason"]), ("error", "record_not_removed"))
        self.assertEqual(self.tdarr.scans, [])

    def test_removal_that_does_nothing(self):
        self.tdarr.file(P, "Transcode success")
        self.tdarr.remove_noop = True
        status, body = self.env.process({"path": P})
        self.assertEqual(status, 502)
        self.assertEqual(body["reason"], "record_not_removed")
        self.assertEqual(self.tdarr.scans, [])
        self.assertEqual(self.env.service.active_runs(), 0)

    def test_already_staged_on_arrival_joins_the_run(self):
        self.tdarr.file(P, "Transcode success")      # an older result must not be removed under a running job
        self.tdarr.stage(P)
        self.tdarr.script(P, nothing, nothing, nothing, finish("Transcode success"))
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"]), (200, "ok"))
        self.assertTrue(body["joined"])
        self.assertEqual(self.tdarr.removed, [])
        self.assertEqual(self.tdarr.scans, [])

    def test_waits_while_the_file_is_parked_at_review(self):
        steps = [nothing, nothing, stage()] + [nothing] * 15 + [finish("Transcode success")]
        self.tdarr.script(P, *steps)
        started = time.monotonic()
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"]), (200, "ok"))
        self.assertGreaterEqual(time.monotonic() - started, 15 * 0.02)

    def test_the_callers_maximum_wait(self):
        self.tdarr.script(P, nothing, nothing, stage())      # staged for good: Tdarr never finishes
        started = time.monotonic()
        status, body = self.env.process({"path": P, "max_wait_seconds": 0.3})
        took = time.monotonic() - started
        self.assertEqual(status, 202)
        self.assertEqual((body["status"], body["reason"]), ("timeout", "still_running"))
        self.assertGreaterEqual(took, 0.28)
        self.assertLess(took, 2.0)
        self.assertEqual(self.tdarr.removed, [])         # nothing is cancelled or removed
        self.assertEqual(len(self.tdarr.scans), 1)
        self.assertEqual(self.env.service.active_runs(), 0)

    def test_no_maximum_wait_means_no_limit(self):
        steps = [nothing, nothing, stage()] + [nothing] * 30 + [finish("Transcode success")]   # about 0.6 s
        self.tdarr.script(P, *steps)
        started = time.monotonic()
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"]), (200, "ok"))
        self.assertGreater(time.monotonic() - started, 0.4)      # outlasted a 0.3 s limit that would have fired

    def test_never_picked_up(self):
        status, body = self.env.process({"path": P})            # the scan is accepted but no record ever appears
        self.assertEqual(status, 422)
        self.assertEqual((body["status"], body["reason"]), ("error", "not_picked_up"))
        # pickup 0.5 s, retry every 0.1 s: the first request plus several repeats
        self.assertGreaterEqual(len(self.tdarr.scans), 3)
        self.assertLessEqual(len(self.tdarr.scans), 7)

    def test_settle_check_does_not_return_the_previous_decision(self):
        # staging ends; Tdarr's record still shows the old decision for one read, then the new one
        self.tdarr.script(P, nothing, nothing, stage(), stage(), finish("Transcode error"), finish("Transcode success"))
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"], body["decision"]), (200, "ok", "Transcode success"))

    def test_a_run_never_seen_staged_is_accepted_on_the_first_finished_read(self):
        self.tdarr.script(P, nothing, nothing, record("Transcode success"))
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["decision"]), (200, "Transcode success"))
        reads = [e for e in self.tdarr.events if e[:3] == ("getById", "FileJSONDB", P) and e[3] == "Transcode success"]
        self.assertEqual(len(reads), 1)

    def test_two_calls_for_one_file_share_one_run(self):
        self.tdarr.file(P, "Transcode error")
        steps = [nothing, nothing, stage()] + [nothing] * 12 + [finish("Transcode success")]
        self.tdarr.script(P, *steps)
        results = {}
        first = self.env.process_in_thread({"path": P}, results, "a")
        self.assertTrue(self.env.wait_for(lambda: self.tdarr.scans))
        second = self.env.process_in_thread({"path": P}, results, "b")
        first.join(10)
        second.join(10)
        self.assertEqual(results["a"][0], 200)
        self.assertEqual(results["b"][0], 200)
        self.assertEqual(results["a"][1]["decision"], "Transcode success")
        self.assertEqual(results["b"][1]["decision"], "Transcode success")
        self.assertEqual(len(self.tdarr.removed), 1)
        self.assertEqual(len(self.tdarr.scans), 1)
        self.assertEqual(sorted([results["a"][1]["joined"], results["b"][1]["joined"]]), [False, True])
        self.assertEqual(self.env.service.active_runs(), 0)

    def test_calls_for_different_files_do_not_interfere(self):
        self.tdarr.script(P, nothing, nothing, stage(), nothing, finish("Transcode success"))
        self.tdarr.script(OTHER, nothing, nothing, stage(OTHER), nothing, nothing, finish("Transcode error", OTHER))
        results = {}
        threads = [self.env.process_in_thread({"path": P}, results, "a"),
                   self.env.process_in_thread({"path": OTHER}, results, "b")]
        for thread in threads:
            thread.join(10)
        self.assertEqual((results["a"][0], results["a"][1]["decision"]), (200, "Transcode success"))
        self.assertEqual((results["b"][0], results["b"][1]["reason"]), (422, "transcode_failed"))
        self.assertEqual(len(self.tdarr.scans), 2)
        self.assertFalse(results["a"][1]["joined"] or results["b"][1]["joined"])

    def test_calls_for_one_file_in_different_libraries_do_not_interfere(self):
        self.tdarr.script(P, nothing, nothing, nothing, stage(), finish("Transcode success"))
        results = {}
        threads = [self.env.process_in_thread({"path": P, "library": "libA"}, results, "a"),
                   self.env.process_in_thread({"path": P, "library": "libB"}, results, "b")]
        for thread in threads:
            thread.join(10)
        self.assertEqual(results["a"][0], 200)
        self.assertEqual(results["b"][0], 200)

    def test_tdarr_down_for_a_spell_then_back(self):
        self.tdarr.script(P, nothing, nothing, stage(), finish("Transcode success"))
        self.tdarr.down = True
        results = {}
        thread = self.env.process_in_thread({"path": P}, results, "a")
        time.sleep(0.2)                                          # well inside UNREACHABLE_SECONDS (0.5)
        self.tdarr.down = False
        thread.join(10)
        self.assertEqual((results["a"][0], results["a"][1]["status"]), (200, "ok"))

    def test_tdarr_down_for_too_long(self):
        self.tdarr.down = True
        started = time.monotonic()
        status, body = self.env.process({"path": P})
        took = time.monotonic() - started
        self.assertEqual(status, 503)
        self.assertEqual((body["status"], body["reason"]), ("error", "tdarr_unreachable"))
        self.assertGreaterEqual(took, 0.45)
        self.assertLess(took, 3.0)

    def test_tdarr_not_listening_is_unreachable_too(self):
        env = Env(unreachable=0.3, tdarr_timeout=0.2)
        try:
            env.tdarr.close()       # the port is closed now: connection refused
            status, body = env.process({"path": P})
            self.assertEqual((status, body["reason"]), (503, "tdarr_unreachable"))
        finally:
            env.server.shutdown()
            env.server.server_close()

    def test_client_disconnect_ends_the_wait(self):
        self.tdarr.script(P, nothing, nothing, stage())          # never finishes
        body = json.dumps({"path": P}).encode()
        sock = socket.create_connection(("127.0.0.1", self.env.server.server_port), timeout=5)
        sock.sendall(b"POST /process HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s"
                     % (len(body), body))
        self.assertTrue(self.env.wait_for(lambda: self.tdarr.scans))
        self.assertEqual(self.env.service.active_calls(), 1)
        sock.close()
        self.assertTrue(self.env.wait_for(lambda: self.env.service.active_calls() == 0 and
                                          self.env.service.active_runs() == 0, 3.0))
        self.assertEqual(self.tdarr.removed, [])

    def test_retry_after_a_dropped_connection_joins_the_still_running_file(self):
        self.tdarr.script(P, nothing, nothing, stage(), nothing, nothing, nothing, nothing, nothing, nothing, nothing,
                          nothing, finish("Transcode success"))
        status, _ = self.env.process({"path": P, "max_wait_seconds": 0.1})
        self.assertEqual(status, 202)
        status, body = self.env.process({"path": P})
        self.assertEqual((status, body["status"], body["joined"]), (200, "ok", True))
        self.assertEqual(len(self.tdarr.scans), 1)
        self.assertEqual(self.tdarr.removed, [])


class LibraryTests(unittest.TestCase):
    env = None

    def tearDown(self):
        if self.env is not None:
            self.env.close()

    def run_one(self, env, body):
        self.env = env
        env.tdarr.script(P, nothing, nothing, record("Transcode success"))
        return env.process(body)

    def test_an_explicit_library(self):
        env = Env(default_library="lib1", library_map={"/downloads": "libMap"})
        status, _ = self.run_one(env, {"path": P, "library": "libX"})
        self.assertEqual(status, 200)
        self.assertEqual(env.tdarr.scans[0]["dbID"], "libX")

    def test_the_map_by_path_prefix_longest_wins(self):
        env = Env(default_library="lib1", library_map={"/downloads": "libShort", "/downloads/Some.Show.S01E01.mkv": "libExact",
                                                       "/other": "libOther"})
        status, _ = self.run_one(env, {"path": P})
        self.assertEqual(status, 200)
        self.assertEqual(env.tdarr.scans[0]["dbID"], "libExact")

    def test_the_map_is_matched_on_whole_path_parts(self):
        env = Env(default_library="lib1", library_map={"/down": "libWrong"})
        self.run_one(env, {"path": P})
        self.assertEqual(env.tdarr.scans[0]["dbID"], "lib1")

    def test_the_default_library(self):
        env = Env(default_library="lib1")
        self.run_one(env, {"path": P})
        self.assertEqual(env.tdarr.scans[0]["dbID"], "lib1")

    def test_no_library_at_all_is_a_bad_request(self):
        env = Env(default_library="")
        status, body = self.run_one(env, {"path": P})
        self.assertEqual(status, 400)
        self.assertEqual((body["status"], body["reason"]), ("error", "bad_request"))
        self.assertEqual(env.tdarr.scans, [])
        self.assertEqual(env.tdarr.events, [])

    def test_resolve_library_directly(self):
        cfg = process_api.Config(url="http://x", default_library="d", library_map={"/a/": "A", "/a/b": "AB", "  ": "none"})
        self.assertEqual(process_api.resolve_library(cfg, "/a/b/c.mkv", None), "AB")
        self.assertEqual(process_api.resolve_library(cfg, "/a/c.mkv", None), "A")
        self.assertEqual(process_api.resolve_library(cfg, "/z/c.mkv", None), "d")
        self.assertEqual(process_api.resolve_library(cfg, "/a/c.mkv", "X"), "X")


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def assert_bad(self, body):
        status, answer = self.env.process(body)
        self.assertEqual(status, 400, body)
        self.assertEqual((answer["status"], answer["reason"]), ("error", "bad_request"), body)
        self.assertIsNone(answer["decision"])
        self.assertFalse(answer["joined"])
        self.assertTrue(answer["message"])
        self.assertEqual(self.env.tdarr.events, [], body)       # nothing was sent to Tdarr

    def test_not_json(self):
        self.assert_bad(b"this is not json")

    def test_empty_body(self):
        self.assert_bad(b"")

    def test_not_an_object(self):
        self.assert_bad(b"[1, 2]")
        self.assert_bad(b'"/downloads/x.mkv"')

    def test_missing_or_bad_path(self):
        self.assert_bad({})
        self.assert_bad({"path": ""})
        self.assert_bad({"path": "   "})
        self.assert_bad({"path": 7})
        self.assert_bad({"path": ["/downloads/x.mkv"]})

    def test_relative_path(self):
        self.assert_bad({"path": "downloads/x.mkv"})
        self.assert_bad({"path": "x.mkv"})

    def test_bad_library(self):
        self.assert_bad({"path": P, "library": ""})
        self.assert_bad({"path": P, "library": 5})

    def test_bad_max_wait(self):
        for bad in (0, -1, -0.5, "30", "", True, [], {}):
            self.assert_bad({"path": P, "max_wait_seconds": bad})
        self.assert_bad(b'{"path": "/downloads/x.mkv", "max_wait_seconds": NaN}')
        self.assert_bad(b'{"path": "/downloads/x.mkv", "max_wait_seconds": Infinity}')

    def test_body_too_large(self):
        self.assert_bad(json.dumps({"path": P, "padding": "x" * (process_api.MAX_BODY_BYTES + 10)}).encode())

    def test_null_optional_fields_count_as_omitted(self):
        self.env.tdarr.script(P, nothing, nothing, record("Transcode success"))
        status, body = self.env.process({"path": P, "library": None, "max_wait_seconds": None})
        self.assertEqual((status, body["status"]), (200, "ok"))

    def test_windows_style_absolute_path_is_accepted(self):
        path = "D:/media/x.mkv"
        self.env.tdarr.script(path, nothing, nothing, record("Transcode success", path))
        status, body = self.env.process({"path": "D:\\media\\x.mkv"})
        self.assertEqual((status, body["status"]), (200, "ok"))


class RoutingTests(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_health(self):
        status, body = self.env.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True, "version": "9.9.9"})

    def test_unknown_path_is_404(self):
        self.assertEqual(self.env.request("GET", "/nope")[0], 404)
        self.assertEqual(self.env.request("POST", "/nope", {})[0], 404)
        self.assertEqual(self.env.request("PUT", "/nope", {})[0], 404)

    def test_wrong_method_is_405(self):
        self.assertEqual(self.env.request("GET", "/process")[0], 405)
        self.assertEqual(self.env.request("POST", "/health", {})[0], 405)
        self.assertEqual(self.env.request("PUT", "/process", {})[0], 405)
        self.assertEqual(self.env.request("DELETE", "/health")[0], 405)
        self.assertEqual(self.env.request("PATCH", "/process", {})[0], 405)


class ConfigTests(unittest.TestCase):
    def test_defaults(self):
        cfg = process_api.config_from_env({"TDARR_URL": "http://tdarr:8266"})
        self.assertEqual((cfg.url, cfg.default_library, cfg.library_map), ("http://tdarr:8266", "", {}))
        self.assertEqual((cfg.tdarr_timeout, cfg.poll, cfg.scan_pickup, cfg.scan_retry, cfg.unreachable),
                         (8.0, 5.0, 120.0, 60.0, 300.0))

    def test_values_from_the_environment(self):
        cfg = process_api.config_from_env({
            "TDARR_URL": "http://tdarr:8266", "TDARR_LIBRARY_ID": "lib", "POLL_SECONDS": "0.5",
            "SCAN_PICKUP_SECONDS": "30", "SCAN_RETRY_SECONDS": "10", "UNREACHABLE_SECONDS": "2",
            "TDARR_TIMEOUT_SECONDS": "3", "TDARR_LIBRARY_MAP": '{"/downloads/4k/": "lib4k"}'})
        self.assertEqual((cfg.default_library, cfg.poll, cfg.scan_pickup, cfg.scan_retry, cfg.unreachable, cfg.tdarr_timeout),
                         ("lib", 0.5, 30.0, 10.0, 2.0, 3.0))
        self.assertEqual(cfg.library_map, {"/downloads/4k": "lib4k"})

    def test_a_missing_url_stops_the_start(self):
        with self.assertRaises(SystemExit):
            process_api.config_from_env({})
        with self.assertRaises(SystemExit):
            process_api.config_from_env({"TDARR_URL": "  "})

    def test_a_bad_number_stops_the_start(self):
        for bad in ("abc", "0", "-3", "nan", "inf"):
            with self.assertRaises(SystemExit, msg=bad):
                process_api.config_from_env({"TDARR_URL": "http://x", "POLL_SECONDS": bad})

    def test_a_bad_library_map_is_ignored(self):
        for bad in ("not json", "[1]", '{"/a": 5}'):
            cfg = process_api.config_from_env({"TDARR_URL": "http://x", "TDARR_LIBRARY_MAP": bad})
            self.assertEqual(cfg.library_map, {}, bad)


class PathTests(unittest.TestCase):
    def test_norm(self):
        self.assertEqual(process_api._norm("/a//b/../c.mkv"), "/a/c.mkv")
        self.assertEqual(process_api._norm("D:\\x\\y.mkv"), "D:/x/y.mkv")

    def test_the_status_table_covers_every_outcome(self):
        self.assertEqual(process_api.Result("ok", None, "").http_status(), 200)
        self.assertEqual(process_api.Result("error", "transcode_failed", "").http_status(), 422)
        self.assertEqual(process_api.Result("timeout", "still_running", "").http_status(), 202)
        self.assertEqual(process_api.Result("error", "not_picked_up", "").http_status(), 422)
        self.assertEqual(process_api.Result("error", "record_not_removed", "").http_status(), 502)
        self.assertEqual(process_api.Result("error", "tdarr_unreachable", "").http_status(), 503)
        self.assertEqual(process_api.Result("error", "bad_request", "").http_status(), 400)


if __name__ == "__main__":
    unittest.main()
