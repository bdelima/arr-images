"""Tests for validator.py against a fake Tdarr server. Run: python3 -m unittest discover -s tdarr-download-validator"""
import json
import os
import tempfile
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
                    # the real Tdarr answers a successful scan with plain text "OK", not JSON -- confirmed
                    # live 2026-11-01; validator.py must not treat this as an unparseable response
                    body = b"OK"
                    self.send_response(200)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
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

    def check(self, path, tags=None):
        return self.validator.safe_validate(path, tags)

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
        # not visible on disk in this test -> falls back to the bare path (see ScanTargetsTests
        # for the case where the path IS on disk and gets walked for real files instead)
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


class QualityTagRoutingTests(unittest.TestCase):
    """Scans for an unknown download should land in the library TDARR_LIBRARY_MAP names for one of its tags."""

    def setUp(self):
        self.tdarr = FakeTdarr()
        self.now = 1000.0
        self.validator = validator.Validator(
            validator.Tdarr(self.tdarr.url, "lib-default", 2), dedup_seconds=60, clock=lambda: self.now,
            library_map={"better": "lib-better", "balanced": "lib-balanced", "smallest": "lib-smallest"})

    def tearDown(self):
        self.tdarr.close()

    def test_mapped_tag_routes_the_scan_to_its_library(self):
        r = self.validator.safe_validate("/downloads/a/ep.mkv", ["balanced"])
        self.assertEqual(r["message"], "triggered")
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_one_map_match_among_unrelated_tags_routes_correctly(self):
        self.validator.safe_validate("/downloads/a/ep.mkv", ["drama", "balanced", "hd"])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_two_map_matches_use_the_lowest_sorting_one_and_log_it(self):
        with self.assertLogs("tdarr-download-validator", level="WARNING") as logs:
            self.validator.safe_validate("/downloads/a/ep.mkv", ["smallest", "drama", "better"])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-better")
        self.assertIn("better, smallest", logs.output[0])

    def test_the_same_tag_twice_is_not_a_conflict(self):
        self.validator.safe_validate("/downloads/a/ep.mkv", ["balanced", "Balanced"])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_matching_is_case_insensitive_and_ignores_surrounding_space(self):
        self.validator.safe_validate("/downloads/a/ep.mkv", [" Balanced "])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_map_keys_are_matched_as_written_so_must_be_lowercase(self):
        v = validator.Validator(validator.Tdarr(self.tdarr.url, "lib-default", 2),
                                library_map={"Balanced": "lib-balanced"})
        v.safe_validate("/downloads/a/ep.mkv", ["balanced"])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-default")

    def test_a_new_tier_needs_only_a_map_entry(self):
        v = validator.Validator(validator.Tdarr(self.tdarr.url, "lib-default", 2),
                                library_map={"archive": "lib-archive"})
        v.safe_validate("/downloads/a/ep.mkv", ["archive"])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-archive")

    def test_no_tags_uses_the_default_library(self):
        self.validator.safe_validate("/downloads/a/ep.mkv")
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-default")

    def test_empty_list_uses_the_default_library(self):
        self.validator.safe_validate("/downloads/a/ep.mkv", [])
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-default")

    def test_tags_that_are_not_in_the_map_fall_back_to_the_default_library_without_failing(self):
        r = self.validator.safe_validate("/downloads/a/ep.mkv", ["ultra-quality", "drama"])
        self.assertEqual(r["message"], "triggered")
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-default")

    def test_tags_have_no_effect_on_a_file_tdarr_already_finished(self):
        # routing only ever decides where a *scan* goes; a file Tdarr already has a decision for answers
        # ready/failed the same way regardless of what tags come in on this call
        self.tdarr.file("/downloads/a/ep.mkv", "Transcode success")
        r = self.validator.safe_validate("/downloads/a/ep.mkv", ["balanced"])
        self.assertTrue(r["ready"])
        self.assertEqual(self.tdarr.scans, [])

    def test_dedup_is_per_path_not_per_tag(self):
        # the first call (no tags yet) already triggers a default-library scan; a second call a moment later
        # that now carries tags is still inside the dedup window, so no second scan goes out for it -- a
        # known limitation of keying dedup by path alone, not by (path, library)
        self.validator.safe_validate("/downloads/a/ep.mkv")
        self.now += 5
        self.validator.safe_validate("/downloads/a/ep.mkv", ["balanced"])
        self.assertEqual(len(self.tdarr.scans), 1)
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-default")


class LibraryMapParsingTests(unittest.TestCase):
    def test_empty_or_unset_is_an_empty_map(self):
        self.assertEqual(validator._load_library_map(""), {})
        self.assertEqual(validator._load_library_map(None), {})

    def test_valid_json_object_of_strings(self):
        self.assertEqual(
            validator._load_library_map('{"better": "abc", "smallest": "def"}'),
            {"better": "abc", "smallest": "def"})

    def test_invalid_json_is_an_empty_map(self):
        self.assertEqual(validator._load_library_map("not json"), {})

    def test_non_object_json_is_an_empty_map(self):
        self.assertEqual(validator._load_library_map("[1, 2, 3]"), {})

    def test_non_string_values_are_rejected_as_an_empty_map(self):
        self.assertEqual(validator._load_library_map('{"better": 123}'), {})


class ScanTargetsTests(unittest.TestCase):
    """What gets sent to scanFolderWatcher when the path IS visible on disk."""

    def setUp(self):
        self.tdarr = FakeTdarr()
        self.validator = validator.Validator(validator.Tdarr(self.tdarr.url, "lib1", 2))

    def tearDown(self):
        self.tdarr.close()

    @staticmethod
    def _touch(*parts):
        path = os.path.join(*parts)
        open(path, "w").close()
        return path

    def test_folder_scan_enumerates_real_files_including_non_video(self):
        with tempfile.TemporaryDirectory() as d:
            one = self._touch(d, "one.mkv")
            two = self._touch(d, "two.mkv")
            # not filtered here -- Tdarr's own library scan filter (Filters -> Container types
            # to scan for) is what drops this, not the validator
            notes = self._touch(d, "notes.txt")
            r = self.validator.safe_validate(d)
            self.assertEqual(r["message"], "triggered")
            self.assertEqual(set(self.tdarr.scans[0]["arrayOrPath"]), {one, two, notes})

    def test_folder_scan_recurses_into_subdirectories(self):
        with tempfile.TemporaryDirectory() as d:
            sub = os.path.join(d, "Subs")
            os.mkdir(sub)
            ep = self._touch(d, "ep.mkv")
            srt = self._touch(sub, "ep.en.srt")
            self.validator.safe_validate(d)
            self.assertEqual(set(self.tdarr.scans[0]["arrayOrPath"]), {ep, srt})

    def test_single_file_download_scans_just_that_file(self):
        with tempfile.TemporaryDirectory() as d:
            f = self._touch(d, "ep.mkv")
            self.validator.safe_validate(f)
            self.assertEqual(self.tdarr.scans[0]["arrayOrPath"], [f])

    def test_empty_folder_triggers_without_calling_tdarr_scan(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.validator.safe_validate(d)
            self.assertEqual(r["message"], "triggered")
            self.assertEqual(self.tdarr.scans, [])

    def test_path_not_on_disk_falls_back_to_the_bare_path(self):
        missing = "/no/such/path/ep.mkv"
        self.validator.safe_validate(missing)
        self.assertEqual(self.tdarr.scans[0]["arrayOrPath"], [missing])


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.tdarr = FakeTdarr()
        v = validator.Validator(validator.Tdarr(self.tdarr.url, "lib1", 2),
                                 library_map={"balanced": "lib-balanced"})
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

    def test_tags_in_the_body_route_the_scan(self):
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv", "tags": ["drama", "Balanced"]}')
        self.assertEqual((status, body["message"]), (200, "triggered"))
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_the_legacy_singular_tag_still_routes_the_scan(self):
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv", "tag": "balanced"}')
        self.assertEqual((status, body["message"]), (200, "triggered"))
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_tags_win_over_the_legacy_tag_when_both_are_sent(self):
        self.post(b'{"path": "/downloads/a/ep.mkv", "tags": ["drama"], "tag": "balanced"}')
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib1")

    def test_a_bare_string_for_tags_is_malformed_and_falls_back_not_a_bad_request(self):
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv", "tags": "balanced"}')
        self.assertEqual((status, body["message"]), (200, "triggered"))
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib1")

    def test_a_malformed_tags_falls_back_to_the_legacy_tag(self):
        self.post(b'{"path": "/downloads/a/ep.mkv", "tags": "nope", "tag": "balanced"}')
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib-balanced")

    def test_a_non_string_inside_tags_makes_the_whole_list_malformed(self):
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv", "tags": ["balanced", 5]}')
        self.assertEqual(status, 200)
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib1")

    def test_non_string_legacy_tag_is_ignored_not_a_bad_request(self):
        status, body = self.post(b'{"path": "/downloads/a/ep.mkv", "tag": 5}')
        self.assertEqual(status, 200)
        self.assertEqual(self.tdarr.scans[0]["dbID"], "lib1")

    def test_bad_body_is_200_not_ready(self):
        for raw in (b"not json", b"{}", b'{"path": 5}', b'{"path": "  "}'):
            status, body = self.post(raw)
            self.assertEqual((status, body["ready"]), (200, False))

    def test_health(self):
        with urllib.request.urlopen(self.base + "/health", timeout=5) as resp:
            self.assertEqual(json.loads(resp.read()), {"ok": True})


if __name__ == "__main__":
    unittest.main()
