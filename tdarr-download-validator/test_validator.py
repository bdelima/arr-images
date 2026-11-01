"""Tests for validator.py against a fake Tdarr server. Run: python3 -m unittest discover -s tdarr-download-validator"""
import json
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from http.server import ThreadingHTTPServer

import validator


class FakeTdarr:
    """Just enough of /api/v2/cruddb and /api/v2/scan-files."""

    def __init__(self):
        self.staged = {}
        self.files = {}
        self.scans = []
        self.down = False
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):  # noqa: N802
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["data"]
                if fake.down:
                    self.send_response(500)
                    self.end_headers()
                    return
                if self.path == "/api/v2/scan-files":
                    fake.scans.append(data["scanConfig"])
                    out = {}
                elif self.path == "/api/v2/cruddb":
                    table = fake.staged if data["collection"] == "StagedJSONDB" else fake.files
                    if data["mode"] == "getById":
                        out = table.get(data["docID"], "")
                    elif data["mode"] == "getAll":
                        out = list(table.values())
                    else:
                        out = None
                else:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.dumps(out).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def file(self, path, decision):
        self.files[path] = {"_id": path, "TranscodeDecisionMaker": decision}

    def stage(self, path):
        self.staged[path] = {"_id": path}


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.tdarr = FakeTdarr()
        self.now = 1000.0
        self.validator = validator.Validator(
            validator.Tdarr(self.tdarr.url, "lib1", 2), dedup_seconds=60, clock=lambda: self.now)

    def tearDown(self):
        self.tdarr.close()

    def check(self, path):
        return self.validator.safe_validate(path)

    def test_unknown_file_is_triggered_once_per_minute(self):
        r = self.check("/downloads/a/ep.mkv")
        self.assertEqual((r["ready"], r["message"]), (False, "triggered"))
        self.assertEqual(self.tdarr.scans, [{"dbID": "lib1", "arrayOrPath": ["/downloads/a/ep.mkv"],
                                            "mode": "scanFolderWatcher"}])
        self.now += 10
        self.assertFalse(self.check("/downloads/a/ep.mkv")["ready"])
        self.assertEqual(len(self.tdarr.scans), 1)
        self.now += 60
        self.check("/downloads/a/ep.mkv")
        self.assertEqual(len(self.tdarr.scans), 2)

    def test_queued_file_triggers_like_unknown(self):
        self.tdarr.file("/downloads/a/ep.mkv", "Queued")
        self.assertEqual(self.check("/downloads/a/ep.mkv")["message"], "triggered")

    def test_staged_file_is_processing(self):
        self.tdarr.stage("/downloads/a/ep.mkv")
        self.tdarr.file("/downloads/a/ep.mkv", "Queued")
        r = self.check("/downloads/a/ep.mkv")
        self.assertFalse(r["ready"])
        self.assertTrue(r["message"].startswith("processing"))
        self.assertEqual(self.tdarr.scans, [])

    def test_finished_file_is_ready(self):
        self.tdarr.file("/downloads/a/ep.mkv", "Transcode success")
        self.assertEqual(self.check("/downloads/a/ep.mkv")["ready"], True)

    def test_not_required_is_ready(self):
        self.tdarr.file("/downloads/a/ep.mkv", "Not required")
        self.assertTrue(self.check("/downloads/a/ep.mkv")["ready"])

    def test_error_is_failed_and_not_ready(self):
        self.tdarr.file("/downloads/a/ep.mkv", "Transcode error")
        r = self.check("/downloads/a/ep.mkv")
        self.assertEqual((r["ready"], r.get("failed")), (False, True))
        self.assertIn("Transcode error", r["message"])

    def test_folder_all_done_is_ready(self):
        self.tdarr.file("/downloads/a/one.mkv", "Transcode success")
        self.tdarr.file("/downloads/a/two.mkv", "Not required")
        self.tdarr.file("/downloads/ab/other.mkv", "Transcode error")  # a sibling folder with the same prefix
        self.assertTrue(self.check("/downloads/a")["ready"])
        self.assertTrue(self.check("/downloads/a/")["ready"])

    def test_folder_with_staged_file_is_processing(self):
        self.tdarr.file("/downloads/a/one.mkv", "Transcode success")
        self.tdarr.file("/downloads/a/two.mkv", "Queued")
        self.tdarr.stage("/downloads/a/two.mkv")
        r = self.check("/downloads/a")
        self.assertFalse(r["ready"])
        self.assertTrue(r["message"].startswith("processing"))

    def test_folder_with_one_error_fails(self):
        self.tdarr.file("/downloads/a/one.mkv", "Transcode success")
        self.tdarr.file("/downloads/a/two.mkv", "Transcode error")
        self.assertTrue(self.check("/downloads/a").get("failed"))

    def test_folder_with_queued_file_triggers_folder_scan(self):
        self.tdarr.file("/downloads/a/one.mkv", "Transcode success")
        self.tdarr.file("/downloads/a/two.mkv", "")
        self.assertEqual(self.check("/downloads/a")["message"], "triggered")
        self.assertEqual(self.tdarr.scans[0]["arrayOrPath"], ["/downloads/a"])

    def test_unknown_folder_is_triggered(self):
        self.assertEqual(self.check("/downloads/new")["message"], "triggered")

    def test_tdarr_down_is_not_ready_not_failed(self):
        self.tdarr.down = True
        r = self.check("/downloads/a/ep.mkv")
        self.assertEqual(r["ready"], False)
        self.assertNotIn("failed", r)
        self.assertIn("Tdarr", r["message"])

    def test_tdarr_unreachable(self):
        v = validator.Validator(validator.Tdarr("http://127.0.0.1:9", "lib1", 1))
        self.assertFalse(v.safe_validate("/downloads/a")["ready"])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tdarr = FakeTdarr()
        v = validator.Validator(validator.Tdarr(self.tdarr.url, "lib1", 2))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), validator.make_handler(v))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tdarr.close()

    def post(self, body, path="/validate"):
        req = urllib.request.Request(self.base + path, data=body, method="POST")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read())

    def test_validate_over_http(self):
        self.tdarr.file("/downloads/a/ep.mkv", "Transcode success")
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv"}')
        self.assertEqual((status, body["ready"]), (200, True))

    def test_bad_body_is_200_not_ready(self):
        for raw in (b"not json", b"{}", b'{"path": 5}', b'{"path": "  "}'):
            status, body = self.post(raw)
            self.assertEqual((status, body["ready"]), (200, False))

    def test_health(self):
        with urllib.request.urlopen(self.base + "/health", timeout=5) as resp:
            self.assertEqual(json.loads(resp.read()), {"ok": True})


if __name__ == "__main__":
    unittest.main()
