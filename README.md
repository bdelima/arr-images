# arr-images

Unofficial Radarr, Sonarr and Lidarr container images where **every scheduled-task interval can be overridden** from a
plain properties file in `/config`.

Upstream hard-codes most of these intervals (they are compiled into `TaskManager.Handle(ApplicationStartedEvent)`
and overwritten from the code on every start, so editing the database does not stick). That is a problem on a
file server whose disks spin down: library-wide tasks such as *Refresh Movies* walk every movie folder on their
own timer and wake every drive. These images fix that. (Sonarr and Radarr also carry one unrelated fix, and there
is a Sportarr image that carries only that fix -- see [Import hold](#import-hold) below.)

| Image | Based on |
|---|---|
| `bdelima/radarr` | [`lscr.io/linuxserver/radarr`](https://github.com/linuxserver/docker-radarr) |
| `bdelima/sonarr` | [`lscr.io/linuxserver/sonarr`](https://github.com/linuxserver/docker-sonarr) |
| `bdelima/lidarr` | [`lscr.io/linuxserver/lidarr`](https://github.com/linuxserver/docker-lidarr) |
| `bdelima/sportarr` | [`sportarr/sportarr`](https://hub.docker.com/r/sportarr/sportarr) (no LinuxServer image exists) |

Tags: `latest`, `<upstream version>` (for example `6.4.4.10685`) and `<upstream version>-ls<N>` (for example
`6.4.4.10685-ls323`, the exact LinuxServer build it was made from). `amd64` and `arm64`. `bdelima/sportarr` has
`latest` and `<upstream version>` only: Sportarr publishes one image per release, so there is no `-ls<N>` build.

**The version number is upstream's.** An image's tag is the upstream release it was built from, the running app
reports that same version (the start-test asserts it), and the rebuilt assembly is stamped with it the way
upstream stamps its own releases. There is no separate version number for this repository. Only stable upstream
releases are followed, not pre-releases or nightlies.

## Using it

Swap the image name in your compose file. Your existing `/config` mount already carries the file:

```yaml
services:
  radarr:
    image: bdelima/radarr:latest
    volumes:
      - /opt/servarr/radarr:/config     # put scheduled-tasks.properties in this folder
```

Create `scheduled-tasks.properties` in that folder (examples with every task and its default:
[`radarr/`](radarr/scheduled-tasks.properties.example),
[`sonarr/`](sonarr/scheduled-tasks.properties.example),
[`lidarr/`](lidarr/scheduled-tasks.properties.example)):

```properties
# minutes. 0 turns the task's own schedule off (you can still run it by hand or from a script).
RefreshMovie=10080
RefreshCollections=0
Housekeeping=0
CheckHealth=1440
```

- **Key**: the task's name as shown by `GET /api/v3/system/task` (Lidarr: `/api/v1/system/task`) in `taskName` (its command name without
  `Command`), or the full type name. Case-insensitive.
- **Value**: whole minutes, `>= 0`.
- **Any task** can be overridden, including the ones whose interval otherwise comes from Settings (`Backup`,
  `RssSync`, `RefreshMonitoredDownloads`). An override in the file wins over Settings for those, including after
  Settings is saved.
- **Read once, when the app starts.** Restart the container after editing the file.
- **No file**: upstream defaults. **A bad line** (no `=`, an unknown task, a value that is not a whole number
  `>= 0`) is logged as a warning in the app's log and ignored; the rest of the file still applies.
- The log shows what was applied, for example `Scheduled task Housekeeping: interval 1440 -> 0 minutes`.
- Check the result at `System > Tasks` in the UI, or `GET /api/v3/system/task`.

A task you run yourself (for example from a cron job through the API) re-stamps its own "last run" time as
upstream does, so it does not fire again on its own timer straight afterwards.

### Running a task through the API as the app's own timer would

`POST /api/v3/command` (Lidarr: `/api/v1/command`) normally runs the task as a **Manual** run, and for the refresh
tasks that means it walks the whole library. Upstream's own timer runs them as **Scheduled**, which does less:
Radarr `RefreshMovie` and Lidarr `RefreshArtist` ask the metadata server what changed since the last run and refresh
only those, `RefreshCollections` skips recent ones, `CheckHealth` runs a subset, Sonarr `RefreshSeries` refreshes only
series that are due. These images let an API call ask for that:

```json
{ "name": "RefreshMovie", "trigger": "scheduled" }
```

- Only `"trigger": "scheduled"` is honored. A call without `trigger` (or the UI) is a Manual run, exactly as before.
  `GET /api/v3/command/<id>` shows which one ran in its `trigger` field.
- Radarr `RefreshMovie` and Lidarr `RefreshArtist` need a "changed since" time, which the app works out itself: the
  task's interval plus 5 minutes (1445 with the default 1440), or `ScheduledLookback.<Task>=minutes` from the
  properties file. Any `lastStartTime` in the request is replaced. Upstream ignores a window over 14 days (20160
  minutes) and falls back to its per-item rules; a longer value is logged as a warning.
- A task whose interval is `0` in the properties file **refuses** a scheduled request with HTTP 400 instead of
  quietly running as Manual. A request for a task with no scheduled entry just gets the trigger.
- The app logs one line per scheduled request, for example `Scheduled request for RefreshMovie: trigger honored,
  look-back 1445 minutes (interval 1440 + 5)`.
- Radarr and Sonarr need only `Core`. Lidarr's controller forced the trigger to Manual, so its image also rebuilds
  `Lidarr.Api.V1.dll` with that one line removed.

## Import hold

Sonarr and Radarr also carry a second, unrelated patch, and `bdelima/sportarr` exists only for it: a way for an
external pre-import process (stripping non-English audio/subtitle tracks and embedded images before import, say)
to hold a download back from being imported, without touching the download client at all.

Pausing a torrent, or any other "make the download client say it isn't done yet" trick, does not actually work for
this: both apps map a paused/stopped/seeding torrent to `DownloadItemStatus.Completed` regardless of client state,
so a process relying on that is racing the app's own queue refresh, not blocking it. `CompletedDownloadService.Check()`
is the one call every tracked download passes through before it becomes `ImportPending`, independent of which
download client it came from, so the gate lives there.

**Sonarr and Radarr** ask a **PreImportValidator** (a small HTTP service; see the next section) at the last step of
`Check()`, after the app has matched the download and found its folder, and before it would mark the download
`ImportPending`:

- Configure it with `/config/preimport-validator.properties` containing `Url=http://<validator>:<port>` (an example is
  in [`common/preimport-validator.properties.example`](common/preimport-validator.properties.example)); restart to
  apply. **Without a Url nothing changes versus upstream.**
- The app sends `POST <Url>/validate` with `{"path": "<the download's output folder or file>"}` (10 second timeout)
  and reads only the JSON body: `{"ready": bool, "failed": bool, "message": string}`.
- `ready: true` -> the download goes on to import as it always does. `ready: false` -> it stays in `Downloading`
  (still visible in the queue) and is asked again on the next queue refresh.
- `failed: true` -> the download is marked failed: blocklisted, a replacement is searched for as for any failed
  download, and it is removed from the download client **if that client's "Remove Failed Downloads" is on**.
- **Fail-closed:** a timeout, an HTTP error status, an unreadable answer or a mistyped Url all count as "not ready"
  (logged as a warning). The import never goes ahead on a missing answer, and there is no time limit; if the
  validator is down, imports wait.
- The old `.tdarr-hold` marker is no longer looked for anywhere.
- **Quality-tag routing:** before calling, Sonarr/Radarr add every tag the series/movie has, unfiltered, as `"tags"`
  in the `/validate` body -- `{"path": "...", "tags": ["balanced", "drama"]}` (left out when there are none). They do
  not know which tags mean a quality tier; that is defined only by the validator's `TDARR_LIBRARY_MAP` (see
  [Import validator](#import-validator-tdarr-download-validator) below), so adding or renaming a tier never needs a
  rebuilt image. Every tag on the series/movie therefore reaches the validator on every check.

**Sportarr** has no `CompletedDownloadService`; its own `EnhancedDownloadMonitorService.HandleCompletedDownload` is the
one place both a freshly completed download and an `ImportPending` retry pass through, so the same check sits at the
top of that method. It works like the above, with these differences:

- Configure it with `preimport-validator.properties` in Sportarr's data folder (`/config` in the image), same format.
- The path sent is the one the download client reported, **translated with Sportarr's Remote Path Mappings** (the
  same translation the import itself uses). A multi-file download is a folder, a single-file download is the file.
- A download that is not ready is left exactly as it is: no state change, no import retry used up.
- `failed: true` pins the download to Failed, so Sportarr's usual failed-download handling runs: blocklist, re-search
  if enabled, and removal from the client if the client's "Remove Failed Downloads" is on. **Unlike any other
  import failure**, the completed-download guard (which otherwise never deletes the data of a download that finished,
  to protect a seeding torrent from a hit-and-run) is bypassed for this one trigger.
- Downloads Sportarr finds on its own in a client ("external" downloads) take a different path and are not gated.
- **Quality-tag routing:** Sportarr keeps tags on the *league*, not on each event, so the `"tags"` it sends are every tag
  on the league the download's event belongs to (unfiltered, as above) -- every event in a league gets the same tier.
  They can be set from the league's tag selector in the web UI. No league tags, no such event/league, or a lookup error
  sends no tags (the validator's default library); it never blocks an import.

## Finding a Tdarr library id

`TDARR_LIBRARY_ID`, the values in `TDARR_LIBRARY_MAP` and the `library` field of the process API all take a Tdarr **library
id** (the `dbID` Tdarr's scan call uses), not the library's name. The same `cruddb` call the two services use lists every
library with its id; run it from any machine that can reach the Tdarr server (the server port, `8266` by default).
The call answers with a JSON array, one document per library: the document's `_id` is the library id and `name` is the
name you gave it in the **Libraries** tab. Each document is long (it carries the library's whole schedule and plugin
stack), so filter it. Every library document starts with its `_id`, then `priority`, then `name`, so this prints one
`id  name` line per library with nothing but `grep` and `sed`:

```bash
curl -s -X POST http://<tdarr>:8266/api/v2/cruddb -H 'Content-Type: application/json' -d '{"data":{"collection":"LibrarySettingsJSONDB","mode":"getAll"}}' | grep -o '"_id":"[^"]*","priority":[0-9]*,"name":"[^"]*"' | sed 's/"_id":"\([^"]*\)","priority":[0-9]*,"name":"\([^"]*\)"/\1  \2/'
```

```
aBcDeFgH1  Downloads (best)
xYz-9QwEr  Test
```

(With [`jq`](https://jqlang.github.io/jq/): `... | jq -r '.[] | "\(._id)  \(.name)"'`.) Copy the id of the library the downloads
belong to; for the validator's `TDARR_LIBRARY_MAP`, the id of each quality tier's library.

`LibrarySettingsJSONDB` and the `getAll` mode are in [Tdarr's API reference](https://tdarr.readme.io/reference/post_cruddb)
(from Tdarr 2.25.01 it is also in the web UI under **Tools → API Docs**). If Tdarr's authentication is switched on, the
request also needs an `x-api-key` header (**Tools → API Keys**); the services here do not send one yet, so they need
Tdarr's authentication off.

## Import validator (tdarr-download-validator)

`bdelima/tdarr-download-validator` is a small service the arr images can ask "is this download ready to import?"
before they import it. It answers from [Tdarr](https://github.com/HaveAGitGat/Tdarr)'s own records and starts Tdarr on
a download it has not seen (walking the download's folder on disk to tell Tdarr about the files in it -- see below),
so nothing has to be wired into the download client. This replaces the hook script that wrote `.tdarr-hold` markers:
the Sonarr, Radarr and Sportarr images call it (see above).
Remove the "run on completion" hooks from qBittorrent and NZBGet once the apps point at the validator.

```
POST /validate   {"path": "/downloads/Some.Show.S01E01", "tags": ["balanced", "drama"]}     (a folder, or a single file; tags optional)
-> 200           {"ready": false, "failed": false, "message": "triggered"}
```

Per call, in order: a file under the path is in Tdarr's staged collection (a Flow is running) → `processing`; Tdarr
decided on a file and the decision contains "error" → `failed: true`; Tdarr has no decision yet (never seen,
`Queued`, or blank) → ask Tdarr to scan it (at most once a minute per path) and answer `triggered`; a finished
record that no longer matches the file on disk (see below) → remove it and scan the file; otherwise
`ready: true`. Tdarr being unreachable is "not ready", never "failed". Tdarr keeps its records per file, so for a
folder the answer covers every file Tdarr knows under it.

**Stale records.** A finished Tdarr record is compared with the file on disk (size and modification time from the record's `statSync`). If they differ, the record belongs to an older file at the same path (a re-download of a release): it is removed from Tdarr's file database and the file is scanned like an unseen one. Some records carry no stored size (the error records of the 2026-11-11 Boroughs pack had a modification time but no size), so that comparison cannot be made; for those the record's own date (its last transcode date, else its creation time) is compared with the file's modification time, and a record written more than 2 seconds before the file on disk is treated the same way (removed, file scanned). Without this, an old error record failed every re-download of the same path and Sonarr blocklisted it again. Files not visible to the validator, records with no decision yet, and records with neither a usable stored size/time nor a date are left as they are. A path is not cleaned again for an hour. A re-download whose file keeps an old modification time (some clients restore the release's own time) is not caught by the date rule.

Tdarr's scan API (`scanFolderWatcher`) only accepts individual file paths, never a folder, so to trigger a scan on a
multi-file download the validator walks that folder **on disk** itself and hands Tdarr the files it finds there --
it needs read access to the same downloads tree the arr apps and Tdarr use, at the same path (mount it read-only).
Every file found is sent, including non-video extras (`.nfo`, `.txt`, subtitles, release notes): nothing is
filtered here, since the Tdarr library's own scan-level filter (**Filters → Container types to scan for**) already
drops anything outside its configured extensions. Without that mount, or if the path isn't there, the validator
falls back to asking Tdarr about the bare path as given, same as before this walk was added -- correct for a single
file, but a no-op for a folder, since `scanFolderWatcher` silently ignores a path that isn't an individual file.

**Quality-tag routing:** `TDARR_LIBRARY_MAP` is the only definition of what a quality tier is. It maps a tag label to
the dbID of the Tdarr library that holds that quality tier; the arr apps send every tag the series/movie/league has
(`"tags"`, see above) and know nothing about which ones matter. A scan a request triggers goes to the library of the
tag that is in the map, instead of always `TDARR_LIBRARY_ID`. **Adding or renaming a tier is one edit to this variable
on this one container -- nothing in any arr app changes.** Matching is case-insensitive on both sides (a key of `"Better"` matches a
`better` tag, and the reverse). If more than one
tag is in the map the lowest-sorting one wins and the rest are logged. No tags, an unset/empty map, or no tag the map
covers all fall back to `TDARR_LIBRARY_ID` unchanged -- nothing about an existing single-library setup changes by
leaving this unset. The map only decides which library a *scan* is pointed at; the `ready`/`failed`/`processing`
answer is read from Tdarr's records by file path alone, independent of library, so it is unaffected either way. The
older singular `"tag": "<label>"` field is still accepted when `"tags"` is absent or malformed, so the validator and
the arr images can be updated in either order; it is a migration aid and will go.

| Variable | |
|---|---|
| `TDARR_URL` | Tdarr server, e.g. `http://192.168.0.50:8266` |
| `TDARR_LIBRARY_ID` | dbID of the default library the downloads belong to ([how to find it](#finding-a-tdarr-library-id)) |
| `TDARR_LIBRARY_MAP` | optional JSON object mapping a quality-tier tag label (case-insensitive) to a library dbID, e.g. `{"better": "<dbID>", "balanced": "<dbID>", "smallest": "<dbID>"}` |
| `PORT` | listen port, default `8080` |
| `TRIGGER_DEDUP_SECONDS` | minimum seconds between scan requests for one path, default `60` |

```yaml
  tdarr-download-validator:
    image: bdelima/tdarr-download-validator:latest
    container_name: tdarr-download-validator
    restart: unless-stopped
    volumes:
      - /path/to/downloads:/downloads:ro   # same path the arr apps and Tdarr use, read-only
    environment:
      - TDARR_URL=http://tdarr:8266
      - TDARR_LIBRARY_ID=<your default/Downloads library id>
      - TDARR_LIBRARY_MAP={"better": "<better library id>", "balanced": "<balanced library id>", "smallest": "<smallest library id>"}
```

It is published by dispatching [`release-validator.yml`](.github/workflows/release-validator.yml) (it does not follow
an upstream release), and tested by [`ci.yml`](.github/workflows/ci.yml) against a fake Tdarr. The Tdarr calls were
written from the records observed on a live instance; live testing on 2026-11-01 confirmed `cruddb`/`getAll` behaves
as expected, but also found that `scan-files` with `scanFolderWatcher` silently does nothing when given a folder
path instead of individual files -- the on-disk walk above is the fix, and the Downloads library's own
`Filters at scan level` setting is what keeps non-video files out of Tdarr without any filtering on the validator's
side.

## Process API (tdarr-process-api)

`bdelima/tdarr-process-api` is a small service that gives any caller a blocking "process this file and tell me when it is
done" call on top of [Tdarr](https://github.com/HaveAGitGat/Tdarr). The caller sends one file path; the service makes Tdarr
process it from scratch, holds the HTTP request open until Tdarr has finished, and answers `ok` or `error`. Nothing about it
is specific to Radarr, Sonarr or any other app. It is a sibling of the import validator above, not a change to it: the
validator answers "is this download ready yet?" at once and leaves the retrying to the caller; this service does the waiting
itself. It uses the same Tdarr API (`/api/v2/scan-files` and `/api/v2/cruddb`). Tdarr has no synchronous processing
endpoint, so this is trigger plus poll behind a blocking facade.

```
POST /process   {"path": "/downloads/Some.Show.S01E01.mkv", "library": "<dbID>", "max_wait_seconds": 3600}     (library and max_wait_seconds optional)
-> 200          {"status": "ok", "reason": null, "message": "Tdarr: Transcode success", "decision": "Transcode success", "joined": false}
GET  /health    {"ok": true, "version": "0.1.0"}
```

`path` is one file, absolute, exactly as Tdarr sees it (the path inside the Tdarr container or node); the service does not
need to see the file itself. The body always has the same shape. Branch on `status` and `reason`, never on `message`.

| Outcome | HTTP | `status` | `reason` |
|---|---|---|---|
| Tdarr finished with a decision that is not an error (including "Not required") | 200 | `ok` | `null` |
| Tdarr finished with a decision containing "error" | 422 | `error` | `transcode_failed` |
| The caller's `max_wait_seconds` elapsed. Tdarr keeps processing; nothing is cancelled | 202 | `timeout` | `still_running` |
| A scan was requested but Tdarr never created a record for the file within `SCAN_PICKUP_SECONDS` | 422 | `error` | `not_picked_up` |
| The file's old Tdarr record could not be removed, or the removal could not be verified | 502 | `error` | `record_not_removed` |
| Tdarr was unreachable for longer than `UNREACHABLE_SECONDS` in a row | 503 | `error` | `tdarr_unreachable` |
| Bad JSON, a missing or invalid field, or no library | 400 | `error` | `bad_request` |

`decision` is Tdarr's own `TranscodeDecisionMaker` text when the service saw one, else `null`. `joined` is `true` when the
call attached to a run that was already in progress.

- **Every call starts a fresh run.** The file's old Tdarr record is removed (and the removal verified) before the scan is
  requested, so an `ok` or `transcode_failed` always comes from a record that did not exist when the call began, even for a
  file Tdarr already processed and that has not changed. Removing the record drops that file's earlier Tdarr history.
- **A file that is already queued or running is not touched.** The call joins that run (`"joined": true`) instead of
  removing or rescanning anything. Two calls for the same file and library at once share one run: one removal, one scan, the
  same answer for both. That also makes a retry after a timeout or a dropped connection safe.
- **A job parked at a Require Review node keeps the call waiting**, the same as in the validator: a job at review is
  still in progress, and the call returns when someone acts on it in Tdarr.
- **No overall limit by default.** A call waits as long as Tdarr takes. Send `max_wait_seconds` to cap it, and set your own
  client timeout slightly above it; many reverse proxies cut an idle upstream call at 60 seconds. If the caller closes the
  connection the service stops waiting; Tdarr carries on.
- **Library.** The request's `library`, else `TDARR_LIBRARY_MAP` (path prefix to library dbID, the longest prefix the path
  is under wins; note this differs from the validator's map, which is keyed by tag), else `TDARR_LIBRARY_ID`; none of them is a
  `400`. `library` and `max_wait_seconds` may be `null`, which counts as omitted.
- **One instance only.** The runs live in the process's memory. Restarting it drops every waiting call; Tdarr carries on, and
  a retried call joins the still-running file. There is no authentication of its own: it is meant for a trusted LAN.

| Variable | |
|---|---|
| `TDARR_URL` | Tdarr server, e.g. `http://192.168.0.50:8266` (required) |
| `TDARR_LIBRARY_ID` | default library dbID (optional: a caller may always send `library`; [how to find it](#finding-a-tdarr-library-id)) |
| `TDARR_LIBRARY_MAP` | optional JSON object mapping a path prefix to a library dbID, e.g. `{"/downloads/4k": "<dbID>"}` |
| `PORT` | listen port, default `8080` |
| `TDARR_TIMEOUT_SECONDS` | timeout of each single Tdarr call, default `8` |
| `POLL_SECONDS` | delay between polls while waiting, default `5` |
| `SCAN_PICKUP_SECONDS` | how long to wait for Tdarr to create a record after a scan request, default `120` |
| `SCAN_RETRY_SECONDS` | while there is no record, how often the scan request is repeated, default `60` |
| `UNREACHABLE_SECONDS` | how long Tdarr may stay unreachable, in a row, before `503`, default `300` |

```yaml
  tdarr-process-api:
    image: bdelima/tdarr-process-api:latest
    container_name: tdarr-process-api
    restart: unless-stopped
    environment:
      - TDARR_URL=http://tdarr:8266
      - TDARR_LIBRARY_ID=<your default library id>
```

```bash
curl -fsS -X POST http://tdarr-process-api:8080/process -d '{"path":"/downloads/Some.Show.S01E01.mkv","max_wait_seconds":3600}'
```

It is published by dispatching [`release-process-api.yml`](.github/workflows/release-process-api.yml) (it does not follow
an upstream release), and tested by [`ci.yml`](.github/workflows/ci.yml) against a fake Tdarr. The classification of
Tdarr's decision text (blank or `Queued` is undecided, a decision containing "error" is a failure, anything else is
finished) is copied from the validator and has not been checked against every value Tdarr can write; a value meaning
"cancelled" would be read as `ok`. If a library is switched off or its queue paused, a record can sit queued indefinitely and
a call without `max_wait_seconds` then waits indefinitely. It has not yet been run against a real Tdarr.

## Tdarr VMAF scoring (tdarr-vmaf-cuda)

`bdelima/tdarr-vmaf-cuda` is a [`DOCKER_MODS`](https://github.com/linuxserver/docker-mods) overlay for a Tdarr node
(Tdarr's node image is built on LinuxServer's base). It adds an ffmpeg built with CUDA and
[libvmaf](https://github.com/Netflix/vmaf) as **`/usr/local/bin/ffmpeg-vmaf-cuda`**, so a Flow step can score a
transcoded file against its original with `libvmaf_cuda` on an NVIDIA GPU. It does not touch the ffmpeg Tdarr ships,
and Tdarr's own image is never rebuilt.

```yaml
  tdarr-node:
    environment:
      - DOCKER_MODS=bdelima/tdarr-vmaf-cuda:latest
```

The binary starts on a node with or without an NVIDIA GPU. With a GPU (host driver, `nvidia-container-toolkit`, the GPU
passed to the container with the `video` driver capability) the CUDA filters (`libvmaf_cuda`, `scale_cuda`) work and the
driver-level libraries come from the host, which this image deliberately does not carry. Without one, the CPU `libvmaf`
filter works. This is done by a small shim: libvmaf is linked against `libcuda-lazy.so`, generated at build time by
[Implib.so](https://github.com/yugr/Implib.so) from the CUDA stub library, which exports the driver functions and loads the real
`libcuda.so.1` with `dlopen` the first time one is called. Nothing calls the driver unless a CUDA filter runs, so the binary no
longer lists `libcuda.so.1` as a start-up dependency. If a CUDA filter does run on a node with no driver, the process stops with
a message naming `libcuda.so.1` (it does not hang). Choosing between the two filters is up to the caller: the Run VMAF plugin
(`tdarr-flow-plugins`) is meant to look for the GPU and pick.

What is in the overlay: the binary, libvmaf and any CUDA runtime library it links in
`/usr/local/lib/tdarr-vmaf-cuda/` (the binary has an RPATH to it, so no `LD_LIBRARY_PATH` is needed), the VMAF model in
`/usr/local/share/model/`, and the licences plus the exact source revisions in `/usr/share/doc/tdarr-vmaf-cuda/`.
Decoding goes through NVDEC and scaling through `scale_cuda`; x264, x265 and libnpp are left out on purpose.

It is built for one GPU generation, set by the `CUDA_ARCH` build argument (default `75`, Turing -- the RTX 2060 Super).
amd64 only. It is published by dispatching [`release-tdarr-vmaf-cuda.yml`](.github/workflows/release-tdarr-vmaf-cuda.yml)
(it does not follow an upstream release) and built and smoke-tested by [`ci.yml`](.github/workflows/ci.yml). CI has no GPU:
the build checks that no shipped file lists `libcuda.so` as needed and that the shim forwards a call to a real `libcuda.so.1`
(the stub, which answers with its own error code) and names the library when there is none; the smoke test checks that the
binary starts on a plain Ubuntu 22.04 with no NVIDIA driver and nothing injected, links everything, reports
`--enable-libvmaf`/`--enable-cuda-nvcc`, has the `libvmaf_cuda` and `scale_cuda` filters, and that (CPU) libvmaf scores a clip
against itself. Scoring on the GPU is checked by hand on a node with one after a release (the shim cannot be tried against a
real driver in CI). Versions are `0.x` until that has been done on real files.

**Newer GPUs and the first-run delay.** The CUDA kernels (libvmaf's and FFmpeg's `scale_cuda`) are shipped as PTX, which the
driver compiles for whatever GPU it finds, so the default `sm_75` build also runs on newer generations without a rebuild;
a Blackwell card (RTX 5060 Ti) was reported to run it unmodified. The price is a one-off compile by the driver (JIT) the first
time each kernel is loaded: about 15 s on that card, against about 4 s once the driver's compute cache is warm. The cache lives
in the container (`~/.nv/ComputeCache`), so a container started with `docker run --rm` pays the 15 s on every run. To keep it,
point `CUDA_CACHE_PATH` at a mounted directory (and raise `CUDA_CACHE_MAXSIZE` if the default is small). Building for the
card's own architecture (`--build-arg CUDA_ARCH=...`, and `CUDA_VERSION` if that architecture needs a newer CUDA toolkit than
the default 12.4.1) avoids the JIT, at the cost of an image that no longer runs on older GPUs. For a Tdarr node this only
lengthens the first scored file after a container is created; it does not change the score.

CUDA scores are not guaranteed to be bit-identical from run to run: in one repeat reported on the RTX 5060 Ti the single lowest
frame (`min`) moved from 82.18 to 81.44. Judge a file by the mean and the low percentile, and keep any minimum-frame threshold
well clear of the limit (the Run VMAF defaults are far from it).

Because it is built with `--enable-gpl --enable-nonfree` it is for your own use; see [`ATTRIBUTION.md`](ATTRIBUTION.md).

## DoVi/HDR10+ toolkit (tdarr-dovi-tool)

`bdelima/tdarr-dovi-tool` is a [`DOCKER_MODS`](https://github.com/linuxserver/docker-mods) overlay for a Tdarr node. It
adds [`dovi_tool`](https://github.com/quietvoid/dovi_tool) and
[`hdr10plus_tool`](https://github.com/quietvoid/hdr10plus_tool) -- both prebuilt, unmodified upstream release binaries,
MIT-licensed -- as `/usr/local/bin/dovi_tool` and `/usr/local/bin/hdr10plus_tool`, so a Flow step can extract and
re-inject Dolby Vision RPU or HDR10+ dynamic metadata around a re-encode (`dovi_tool` also does the `demux`/`mux` a
dual-layer Profile 7 stream needs). Neither tool touches the ffmpeg Tdarr ships, and Tdarr's own image is never rebuilt.

```yaml
  tdarr-node:
    environment:
      - DOCKER_MODS=bdelima/tdarr-dovi-tool:latest
```

Several overlays on one node are separated by `|`, for example
`DOCKER_MODS=bdelima/tdarr-vmaf-cuda:latest|bdelima/tdarr-dovi-tool:latest`.

Both tools are fully static binaries with no runtime library dependencies, so the overlay is just the two binaries and
their licences plus the exact releases in `/usr/share/doc/tdarr-dovi-tool/`. The Dockerfile pins both release tags and
the SHA-256 of both tarballs it downloads. `amd64` only. It is published by dispatching
[`release-tdarr-dovi-tool.yml`](.github/workflows/release-tdarr-dovi-tool.yml) (it does not follow an upstream release)
and built and smoke-tested by [`ci.yml`](.github/workflows/ci.yml). CI has no DoVi/HDR10+ sample file to test against:
it checks that both binaries run standalone on a plain Debian, report the exact pinned version, and list the
subcommands the flow depends on (`extract-rpu`/`inject-rpu`/`demux`/`mux`, `extract`/`inject`). A real
extract/re-encode/inject round trip, and playback on a device, are checked by hand once a flow uses the image. Versions
are `0.x` until that has been done on real files.

## Tdarr flow plugins (tdarr-flow-plugins)

`bdelima/tdarr-flow-plugins` is a [`DOCKER_MODS`](https://github.com/linuxserver/docker-mods) overlay for the Tdarr **server**
container. It replaces hand-copying files onto the server: at every container start it puts thirty-six Local Flow Plugins
(`classifySource`, `setMaxBitrate`, `tagEncodeSettings`, `tagOutputMetadata`, `checkSourceEfficiency`,
`setSourceRelativeBitrate`, `setEncodeQuality`, `setQualityWithNodeOffset`, `requireEnglishAudio`, `removeUntaggedAudio`, `mkvmergeExecute`, `repairLanguageTags`, `markStep`, `requireTrail`, `runVmaf`, `keepAwake`, `setQualityWithTierOffset`, `compareFileSizeToSource`, `ffmpegSplitStreams`, `saveCurrentNode`, `setReEncodeOffset`, `readSourceFileTag`, `tagVmafScore`, and the Dolby Vision / HDR10+ re-injection steps `doviLookInSource`, `hdr10PlusExtract`, `doviExtractRpu`, `doviCountFrames`, `doviCheckRpuFrames`, `doviWriteRawStream`, `hdr10PlusInject`, `doviInjectRpu`, `doviMuxResult`, `doviVerifyResult`, `doviCleanUp`, the two H.264 splice plugins `detectH264Splice` and `fixH264Splice`) and the flow template files for the Downloads
Flow (Controller, Encoder, Muxer) and the VMAF Scoring Flow into the server's plugin folder. The files in
[`tdarr-flow-plugins/root`](tdarr-flow-plugins/root) are the source of truth and are shipped as they are, except that the build appends each flow template's own version to its name (below).

```yaml
  tdarr:
    environment:
      - DOCKER_MODS=bdelima/tdarr-flow-plugins:latest
    volumes:
      - /opt/tdarr/server:/app/server
```

Several overlays are separated by `|`. Put it on the server container only; remote nodes get the plugins from the server.

- **How it works.** A host bind mount of `/app/server` hides anything an image puts there, so the image stages the files under
  `/defaults/tdarr-plugins` and an s6 oneshot (`init-mod-tdarr-flow-plugins`, which runs before the Tdarr services) copies them
  to `/app/server/Tdarr/Plugins/FlowPlugins/` (`LocalFlowPlugins/video/<name>/1.0.0/index.js` and `LocalFlowTemplates/video/`).
  The plugins `require()` Tdarr's helpers by relative path, so each file must land at exactly that depth.
- **Copy rule, per file.** Missing: installed. Identical: left alone. Different: replaced, and the log says so
  (`[mod-tdarr-flow-plugins] replaced ... (it differed from the one in the image)`), so a host edit is never lost silently.
  Nothing else in the plugin folder is touched. The one exception is a short retired list: a file this image used to ship and no longer does
  is deleted at start if it is still there (the `RETIRED` array in the run script, exact paths only, never a folder, a link, a path outside the
  plugin folder or a file the image ships; the log says `removed ...`). Today it holds `LocalFlowTemplates/video/languageTagRepair.js`, `LocalFlowTemplates/video/cleanOnlyPassthrough.js`, `LocalFlowTemplates/video/streamCleanup.js`, `LocalFlowTemplates/video/converter.js` and `LocalFlowTemplates/video/validator.js` (the last two are the old file names of the Encoder and Muxer templates, which keep their flow ids). Files are
  owned by `PUID:PGID` (when set), mode 664, new folders 775.
  The script never stops the container from starting; a failure is a log line. A new plugin file needs the server restarted to load, which a container restart does anyway.
- **Not in the image:** the flows themselves (they live in Tdarr's database; import them with Add Flow > Import JSON Flow
  Template or from the Local tab) and any Tdarr settings. A flow already imported from a template stays in Tdarr's database when the template is retired;
  delete it in the Flows tab (the separate Stream Cleanup, Clean-only passthrough, Converter and Validator flows of earlier versions are in that case).
- **Timestamp repair in Split Streams.** If ffmpeg's stream copy rewrites video timestamps (the job log shows `Invalid DTS` or `Non-monotonic DTS` for the video output), `ffmpegSplitStreams` copies the video once more, alone, through the `setts` bitstream filter with the original timestamps kept (the PTS as it was, a DTS that follows the packet count, at the stream's frame rate rounded up to a whole number), and replaces the video-only file with that copy. Files that copy cleanly are not read a second time, and the audio+subtitles file is never touched. Without this, two frames can end up with the same timestamp and the encode drops one, so Run VMAF stops the job on a frame count mismatch (job fz2k4xc, 83018 frames in, 83017 out). If the second copy fails, or the stream has no usable frame rate (none, or above 240 fps as variable frame rate files report), the first video-only file stays and the job log says so; the frame-count check in Run VMAF is then the backstop. Detection relies on ffmpeg printing `[vost#0:0/copy ...]` before the warning; with a different wording the plugin behaves as it did before. Checked on the original file of that job (the repaired copy has the original's video timestamps, 83018 packets, no warnings); not yet seen in a real Tdarr job, and only H.264/HEVC sources in Matroska have been tried.
- **H.264 splice repair (not wired into any flow).** `detectH264Splice` and `fixH264Splice` deal with an H.264 video that has a segment spliced in whose SPS declare colour tags the rest of the file lacks (a studio logo after the end credits: the episode's SPS declare no colour, the logo's declare tv range and bt709, and the logo's SEI sits ahead of its new SPS). Such a file makes ffmpeg print `SEI type 0 overread by 8 bits` and makes a GPU encode or VMAF run that keeps its frames on the GPU fail when the colour changes mid-stream. `ffmpegSplitStreams` counts those warnings into the Flow Variable `h264SeiOverread` at no extra cost. `detectH264Splice` scans the working file's SPS only when that count is above 0 (or always, with its switch off) and routes: output 1 repairable, 2 nothing to fix, 3 differs in a way it does not repair. `fixH264Splice` moves each SEI that precedes an SPS/PPS to just after it (same packet size, in place in the job's own copy, original bytes restored on failure), writes the colour the file's own later SPS declare into every SPS with `h264_metadata`, checks the result (same frame timestamps and key frames, no overread warning, every SPS declares that colour) and makes it the working file and `videoOnlySource`. Nothing is removed and nothing is re-encoded. Tested only on synthetic files with ffmpeg 6.1.1 and mkvtoolnix; not run in a real Tdarr job.
- **The three flows.** The **Controller** (`bdelima/Controller`) takes the file in, queues it to a local node, runs the quick health check, does the stream cleanup
  (English audio and subtitles only, images removed, language-tag repair, then `ffmpegSplitStreams` writes a video-only working file and an audio+subtitles file into the remux cache), classifies the
  source (Classify Source has ten outputs: H.264, HEVC, HEVC with HDR/Dolby Vision, HEVC with Dolby Vision 4/5, AV1, AV1 with HDR/Dolby Vision, AV1 with Dolby Vision 4/5, legacy codecs, other, other with HDR/Dolby Vision;
  as shipped, H.264, HEVC, HEVC with HDR/Dolby Vision and legacy go through Check Source Efficiency to the Encoder, and every other output goes straight to the Muxer) and sends it either to the Encoder or straight to the Muxer. The **Encoder** (`bdelima/Encoder`) re-encodes the video only: it picks the encoder node by frame rate and encodes, checks the encoded file's size against the source straight away (a file that fails is replaced by the original before any scoring), scores the
  result with Run VMAF against the video-only file on a GPU worker, and when a VMAF check fails a second size check (at most 85% of the video-only source) decides between another pass at a lower quality and restoring the original; it then hands over to the Muxer. The **Muxer** (`bdelima/Muxer`) puts the
  video and the audio+subtitles file back together with mkvmerge, re-injects Dolby Vision / HDR10+ metadata where the source had it, runs the thorough health check and the trail gate, stops at a Require Review node before the final merge, writes the
  output tags and replaces the original. The separate Stream Cleanup flow was merged into the Controller, and the Validator was renamed Muxer. None of this has been run in a real Tdarr job since the
  templates were last changed.
- **Flow ids.** The templates' `_id` values are `bdelima/Controller`, `bdelima/Encoder`, `bdelima/Muxer` and, for the VMAF Scoring Flow, `bdelima/VmafScoring` (the first three were `HWxfel7zZ`, `20ZN6oc41` and `Yaax7LBej`), and every Go To Flow node uses them:
  Controller to the Encoder (entry `X4ANCc9vI`) and to the Muxer (`FShP88xbjPT`, final merge), Encoder to the Muxer (`QgTm1GUmZ`, re-encoded, and `FShP88xbjPT`, final merge). Tdarr treats a
  new `_id` as a new flow, so Replace does not overwrite a flow that still has an old id: import the new flows, move the libraries over, then delete the old ones. Ids written `bdelima:<name>` were tried first: they imported, but the flow editor then opened the Controller for all three flows (cause not confirmed); `bdelima/<name>` imported and worked (observed by the owner, 2026-11-19).
- **VMAF Scoring Flow** (`bdelima/VmafScoring`, a separate flow that no other flow calls). For a file that is already finished: it reads the `TDARR_SOURCE_FILE` tag from the input file
  (`readSourceFileTag`, which also checks that the path exists on the node, is a file, and is not the working file itself, since a file scored against itself would get a perfect score), scores the input file against the
  file at that path with Run VMAF (on a node tagged `vmaf`, with the same four 8-bit / 10-bit / 4K Run VMAF nodes as the Encoder, their Reference file set to the path read), and writes the result into the input
  file's `TDARR_VMAF_SCORE` tag (`tagVmafScore`: in place with `mkvpropedit`, Matroska only, every other `TDARR_` tag kept, read back and checked). It does not encode, remux or replace anything. No tag, or a
  tagged path that does not exist, fails the job; a score that fails the thresholds is written anyway. **It only works where the original is still at the tagged path:** Replace Original File overwrites the original, so
  for a file the Controller / Encoder / Muxer produced the path normally holds nothing (after the arr import) or the encoded file itself, and the flow then fails the job with "no file exists at ..." or "is the working
  file itself". The flow is not bound to any library; the library that runs it needs its own settings. Checked in a sandbox with real ffmpeg, ffprobe and `mkvpropedit` and a stand-in scorer; not run in a real Tdarr job,
  and whether Tdarr renders the `{{{args.variables.user.sourceFile}}}` template in Run VMAF's Reference file input is not confirmed.
- **Dolby Vision / HDR10+ re-injection (Muxer).** A file that comes back from the Encoder and classifies as HDR or Dolby Vision goes through one Local plugin per step: Look In Source reads the first frames of the video-only
  source with `dovi_tool` / `hdr10plus_tool`, Profile 7 is converted to 8.1 and Profile 8 is used as is, any other profile leaves through a failure output wired to Fail Flow; the metadata is extracted from the whole source,
  the frame counts are compared, the encode is written as a raw HEVC stream, HDR10+ and then the RPU are injected, mkvmerge writes the MKV, Verify Result reads the metadata back out and compares it, and Clean Up
  removes the work files. The steps that read a whole file (RPU and HDR10+ extraction, frame counting, writing the raw stream, both injections, the mkvmerge write and the read-back) report a percentage and an estimated time to the worker while they run: for `dovi_tool`, `hdr10plus_tool`, `ffprobe` and `ffmpeg` it is the share of the input file the process has read so far (taken from `rchar` in `/proc/<pid>/io` once a second, Linux only), for mkvmerge it is the `Progress:` figure it prints, and Verify Result gives each of its up to three read-back programs its own share of 0 to 100. The figure stays one below the end of its range until the program exits with code 0. It is only a display: without `/proc` or `updateWorker` there is just no percentage, and the results do not change. Tested with stand-in tools; not seen with the real `dovi_tool` / `hdr10plus_tool` or in the Tdarr worker display. The nodes need `dovi_tool`, `hdr10plus_tool` (the `tdarr-dovi-tool` overlay above) and `mkvmerge` on the node that runs the Muxer's local branch. Tested on small synthetic files with a harness that walks the flow
  JSON; not run in a real Tdarr, and not tested with a real Profile 7 file or a variable frame rate file.
- **Each flow template has its own version, stamped by the build.** The build appends a version to each template's flow name
  ("Controller" becomes "Controller (v9)"), so copies of a flow made from different template versions can be told apart in
  Tdarr. The version is the number of commits that touched that template file
  ([`template-versions.sh`](tdarr-flow-plugins/template-versions.sh), which CI and the release workflow run on the full
  history and pass to the build). It goes up by one each time a template is changed and stays put while it is not, so a release
  does not rename templates that did not change, and nobody has to bump anything. Commits are counted per file path, so a renamed template file starts counting again (the Encoder and Muxer templates, formerly `converter.js` and `validator.js`, did). It is a counter, not the release number: the image
  version (`tdarr-flow-plugins/VERSION`) is separate. The template files in the repo keep their plain names. The build and smoke
  test fail if a template has no version stamped. Nothing in Tdarr refers to a flow by name (`goToFlow` takes a flow id and a node id).
- **Step trail (confirming the order of steps).** A node's job-log lines can arrive late, so log times cannot show the order in which
  steps ran. `markStep` appends one numbered entry (`seq|label|node|worker|UTC time`) to the Flow Variable `tdarrTrail` at the point it
  is placed, and `requireTrail` fails the flow (output 2, wired to Fail Flow) unless the labels it is given are in the trail in that
  order; the order comes from the sequence numbers, not from any clock. The Controller, Encoder and Muxer templates carry the
  stamps, the Muxer ends in a `requireTrail` gate (`validator-hc-queue`, then `validator-hc-done`)
  in front of Tag Output Metadata (both Muxer entries, re-encoded and final merge, go through the same health check and gate; the 0.6.0 flow also required `validator-back-local` there and failed every passthrough file, so it is not required), and Tag Output Metadata adds its own closing entry and writes the whole trail into the file's
  `TDARR_TRAIL` tag. Read it back with `tdarr-ffmpeg -i <file> 2>&1 | grep -i TDARR_TRAIL`. The time in an entry is the clock of the
  node that ran the step, so it is comparable between nodes only when their clocks agree.
- **Tags survive a later pass.** Every mkvmerge remux drops the file's global tags, so without help a second pass over an already-encoded
  file would lose the tags its encode run wrote. Tag Output Metadata first reads the `TDARR_` tags of the original library file (from the
  probe data Tdarr holds, `format.tags`; if that has none, from an `ffmpeg -f ffmetadata` read of the file) and merges them with this run's.
  The tags that describe an encode (`TDARR_ENCODE_PARAMS`, `TDARR_QUALITY_TIER`, `TDARR_SOURCE_CLASS`, `TDARR_SOURCE_BPP`,
  `TDARR_SOURCE_VIDEO_KBPS`, `TDARR_SOURCE_PEAK_KBPS`, `TDARR_SOURCE_FILE`, `TDARR_SIZE_RATIO`, `TDARR_VMAF_SCORE`, `TDARR_ENCODE_VERSION`, `TDARR_ENCODE_TRAIL`) are rewritten only when this run re-encoded the video
  (the trail has `converter-encode-done`); when it did not, and the original already carries `TDARR_ENCODE_PARAMS` or `TDARR_ENCODE_TRAIL`,
  they are kept as the encode run wrote them. `TDARR_PIPELINE_VERSION` and `TDARR_TRAIL` always describe the run that wrote them, so
  `TDARR_ENCODE_VERSION` and `TDARR_ENCODE_TRAIL` are copies of those two taken at the encode run. Any other `TDARR_` tag on the original is
  carried over unchanged. `TDARR_SOURCE_FILE` is the full path of the original library file the job was queued for, as Tdarr saw it (for example
  `/downloads/usenet/completed/.../name.mkv`); it is in the encode group, so a later pass keeps the path the encode run recorded, and a file
  encoded before this tag existed does not get one added by a later pass. The job log says how many tags were found, where they came from and which were kept. Checked on real Matroska
  files with `mkvpropedit`, `ffprobe` and `ffmpeg` in a sandbox, with Tdarr's helpers stubbed; not yet seen in a real Tdarr job, and whether
  Tdarr's own probe data carries `format.tags` is not confirmed (the ffmpeg read covers it if it does not).
- **Quality baseline and per-node offset.** The shipped flows no longer cap the bitrate of a standard quality-based encode (no `-b:v` / `-maxrate` / `-bufsize`, so hevc_qsv stays plain
  ICQ). Two plugins decide the quality number instead. **Set Encode Quality** (not in the shipped Controller since Controller v12) sets the Flow Variable
  `tdarrQuality`, the baseline: its input *Quality* (default 18, a whole number from 1 to 51, templatable, so a library variable such as `{{{args.userVariables.library.crf}}}` works), or, for a source above
  *High frame rate above fps* (default 30, 0 = off), *High frame rate quality* (default 31, the same in every tier). The frame rate is the video stream's `avg_frame_rate`, else `r_frame_rate`; if it cannot be
  read the normal quality is used. A quality that is not a whole number from 1 to 51 is ignored, and when nothing usable is left the variable is removed so an old value cannot linger.
  **Set Quality With Node Offset** (Encoder, one in each frame-rate path, directly after Set Video Encoder, replacing Set Source-Relative Bitrate) adds the offset of the node the job is running on to that baseline and writes the result,
  kept between 1 and 51, over the quality Set Video Encoder wrote (`-global_quality` for QSV, `-crf` for the software `lib*` encoders, `-qp` for the rest; added if none is there). Its input *Quality offset
  per node* lists `node=offset` pairs separated by new lines, commas or semicolons (the Encoder ships `drakebay-gpu=0` and `samara-encoder=-2` for sources under 30 fps and `-6` for sources above); names are matched without regard to case, a node that is not listed (or whose name cannot be read) gets 0, a later pair for the same node wins, and
  an entry that is not `name=whole number` is ignored and named in the job log. A lower number means better quality and a bigger file, so a node that writes fewer bits for the same number gets a negative offset.
  When `tdarrQuality` is not set (which is the case in the shipped flows, where the Controller has no Set Encode Quality), the baseline is the number Set Video Encoder wrote, so the
  offset still applies. A video stream still set to copy is skipped. Why: on one 1080p50 source (the Brazil race, 6142 kbps video), plain ICQ 18 grew the file to 233-301% of the original; ICQ 31 on ojochal
  (Meteor Lake) gave 4389 kbps at VMAF mean 96.34 / min 68.80, and drakebay (Panther Lake) at ICQ 28 gave 4478 kbps at mean 96.06 / min 71.35, while ojochal at ICQ 28 gave 6821 kbps. Both nodes drop
  about 14% of the bitrate per step, so a constant offset of 3 matched them on that source. One source and one pair of nodes: the numbers 31 and -3 are starting values, not calibrated, and whether the
  offset stays the same at other qualities or content has not been tested. Checked in a sandbox with Tdarr's helpers stubbed, not yet seen in a real Tdarr job. Set Source-Relative Bitrate is still shipped but is no longer in the Encoder template.
- **Set Quality With Tier Offset (in the Encoder).** Adds an offset for the library's quality tier to the quality number already on the encode command, so it stacks on
  Set Quality With Node Offset: place it after Set Video Encoder and Set Quality With Node Offset, before Tag Encode Settings. The tier is the library variable `qualityTier`
  (`args.userVariables.library.qualityTier`); the input *Quality offset per tier* lists `tier=offset` pairs separated by new lines, commas or semicolons (default
  `best=0`, `better=+1`, `balanced=+2`, `smallest=+4`, each on its own line). Names are matched without regard to case; a tier that is not listed, or no `qualityTier`, gets 0; a later pair
  for the same tier wins; an entry that is not `name=whole number` is ignored and named in the job log. The result is kept between 1 and 51. It changes the `-global_quality`, `-crf` or `-qp`
  already on each video stream Set Video Encoder is transcoding (streams set to copy are skipped); it does not read `tdarrQuality`, and a stream with no usable quality flag is left alone and
  logged. A higher number means a smaller file and lower quality. It never fails the flow (one output). Added by PR #71 and released in 0.9.0; the Encoder template uses it after the node offsets and before Set Re-Encode Offset and Tag Encode Settings (default tier offsets), and it has not yet been
  seen in a real Tdarr job.
- **Keep Awake (in the Encoder).** Keeps the node from sleeping while a job runs, used inline as the same plugin twice: action `start` early in the flow, action `stop` after the work
  that must not be interrupted. Neither step waits for anything, so it cannot deadlock with other jobs on the node (the stock *Prevent Sleep While Encoding* plugin waits for every other worker on
  the node to finish). Each operating system has its own input: *Windows* `system+display` (default, system and display kept on), `system` (display may turn off) or `none`; *Linux* `none`
  (default) or `systemd-inhibit`; *macOS* `none` (default) or `caffeinate`. With `none` the step returns at once and starts nothing, so one flow can run on every node and only the Windows one
  does any work. `start` writes a lease file in the job's work folder and starts a small detached helper (a hidden PowerShell calling `SetThreadExecutionState` every 5 seconds on Windows;
  `systemd-inhibit` or `caffeinate` around a shell loop elsewhere) that holds the request while the lease exists and, as a safety limit, for at most *Maximum hold (minutes)* (default 480, make it longer
  than your longest job). `stop` deletes the job's lease and the helper ends within about 5 seconds. Every job has its own lease and helper, so jobs on one node never release each other's hold, and the
  node stays awake while any is active. The lease path and node name are kept in the Flow Variables `keepAwakeLease` and `keepAwakeNode`; `stop` leaves a lease that belongs to another node alone.
  A job that fails or is cancelled before `stop` does not release its lease: it ends when the work folder is cleaned up (not verified) or when the maximum hold runs out. If the helper cannot
  start the step logs why and carries on holding nothing; it never fails the flow (one output). Added by PR #70 and released in 0.9.0 for the Windows encode node `samara-encoder`; the Encoder template has a Prevent sleep node in front of the encode and an Allow sleep node after it (and one on each path out); not yet run on a real node.
- **Source bitrate tags.** Set Quality With Node Offset records the source video's average bitrate and, when its peak scan works, the busiest
  window's bitrate (the window length and percentile are that node's own inputs, 2 s and 100 by default) as Flow Variables, for every encoder it sees (not only QSV); Tag Output Metadata writes
  them as `TDARR_SOURCE_VIDEO_KBPS` and `TDARR_SOURCE_PEAK_KBPS`, whole kbps. Neither value changes the encode. They are in the
  encode group, so a later pass keeps them. `TDARR_SOURCE_BPP` (bits per pixel) comes from Check Source Efficiency and is written only when that node is
  enabled; with both its minimums at 0 it never skips a file and only measures. If Check Source Efficiency is enabled it also sets the average-bitrate
  variable, and Set Quality With Node Offset then overwrites it with its own reading.
- **Set Source-Relative Bitrate (not in the shipped Encoder).** The older plugin, left in the image unchanged. It turns hevc_qsv ICQ into QVBR by adding `-b:v` / `-maxrate` / `-bufsize` to sources below its
  input *Cap only below this source bits per pixel* (default 0.07, 0 = always cap), reading the source's bits per pixel from the Flow Variable `tdarrSourceBpp` that Check Source Efficiency sets earlier in the flow, and it
  records the same two source bitrate variables. A flow that still uses it works as before.
- **Cropped and padded encodes, and other size differences, in Run VMAF.** libvmaf and libvmaf_cuda refuse two inputs of different width or height, so before the frame count Run VMAF reads the size (and codec) of both files with ffprobe. Same size: nothing changes. The working file is a *centered crop* of the reference (smaller in width and/or height, and each side's margin, (reference - working file) / 2, is a whole, even number of pixels): the **reference** is cropped to the working file's size and both are scored. The working file is the reference *padded* (larger in width and/or height, for example an encode padded back to a full 3840x2160 canvas, with the same whole, even margin rule): the **working file** is cropped back to the reference's size, so the pad is not part of the score. On the GPU path the file to be cropped goes through its `<codec>_cuvid` decoder with the decoder's `-crop`; on the CPU path (or for a codec without a cuvid entry in the plugin's table, which the job log says) through the `crop` filter. Nothing is scaled, and only the sizes are compared, so a resized encode whose size happens to fit the crop or pad arithmetic would be scored against the wrong region. A pair that was adjusted is marked: the Flow Variable `vmafGeom` is `geom=refcrop:L,T,R,B` (the reference was cropped) or `geom=padcrop:L,T,R,B` (the working file was cropped), margins left, top, right, bottom, and Tag Output Metadata and Tag VMAF Score append it to `TDARR_VMAF_SCORE` after the other fields (for example `mean=95.12;min=81.3;p1=90.4;below60=0;below70=2;below75=5;geom=padcrop:4,264,4,264`); a pair that needed no adjustment has no `geom`. Anything else (one file wider and the other taller, an odd or uneven margin) is **not scored**: `vmafUnscored` is set to `UNSCORED: geometry mismatch`, the score variables are cleared, and the two tag plugins write that text as `TDARR_VMAF_SCORE`. The input *Output for an unscored file* (`unscoredOutput`, 1 or 2, default 1) picks the output the file leaves through. The default is 1 because output 2 means "encode again at a lower quality" in the Encoder, which cannot fix a size difference; with 1 an unscored file carries on as if the quality check had passed, so **a mismatched encode is tagged, not quality-checked** (intended, the job does not fail). If either size cannot be read, a warning is logged and scoring goes ahead as before. Tested with stand-in binaries and real ffprobe on small clips; a full GPU score with a cropped or padded file, and `hevc_cuvid -crop` on 10-bit Dolby Vision files, are not verified. **Exact margins from tags.** When the working file carries the global tags `TDARR_CROP=L,T,R,B` (pixels cut off the source, which is the reference Run VMAF scores against) and/or `TDARR_PAD=L,T,R,B` (pixels then added to the cropped picture, for example a Dolby Vision pad; `0,0,0,0` for none), Run VMAF uses them instead of the centered-from-sizes rule: the working file equals the reference minus `TDARR_CROP` plus `TDARR_PAD`. They are read from the working file with Tdarr's ffmpeg (`-f ffmetadata`), or from the probe data Tdarr holds if that cannot run; a missing one of the two counts as `0,0,0,0`. The reference is cropped by `TDARR_CROP` and the working file by `TDARR_PAD` (both when both are non-zero; on the GPU path each goes through its own `<codec>_cuvid -crop` input, and if either codec has no entry in the plugin's table the whole pair is scored on the CPU path), and the two inner pictures are scored. Uneven margins are fine as long as each is even (140/120 is accepted, 5/5 is not). A tag that is not four whole numbers (an empty one too), an odd margin, margins that leave no picture, or inner sizes that differ is **not scored** and **does not fall back to the centered rule**: `vmafUnscored` is `UNSCORED: tag/geometry mismatch`, handled like the other unscored case. The marker gets more fields: when both files are cropped the second is written `geom2=padcrop:L,T,R,B` (so `geom=` keeps one meaning), and `geomsrc=tag` or `geomsrc=centered` follows; `geomsrc=tag` is written whenever the tags were used, including `0,0,0,0` with nothing cropped, so a tagged encode always shows the tags were read (examples: `...;geom=padcrop:4,264,4,264;geomsrc=tag`, `...;geom=refcrop:0,120,0,120;geom2=padcrop:0,120,0,120;geomsrc=tag`, `...;geomsrc=tag`). Whether the tags are still on the working file when it reaches Run VMAF depends on the steps before it: a remux that drops global tags falls back to the centered rule. Cropping both inputs on the GPU in one run, and uneven margins on `hevc_cuvid -crop`, are not verified on hardware.
- **Frame-count check before VMAF.** Run VMAF pairs frame N of the original with frame N of the encode, so files with different frame
  counts cannot be scored meaningfully. Before taking the GPU lock it counts the video packets of both files with `ffprobe -count_packets`
  (the sibling of Tdarr's ffmpeg, then `tdarr-ffprobe`, then `ffprobe`) and fails the job, naming both counts, when they differ at all. If the
  count cannot be made (no ffprobe, a timeout), it logs a warning and scores as before. The count reads each file once without decoding it.
- **Quality checks and a failure output in Run VMAF.** Run VMAF Quality Check holds three figures of the per-frame scores to minimums: the mean (`minMean`, default 93),
  the lowest frame (`minFrameScore`, default 50) and the 1st percentile (`minP1`, default 70); 0 turns the min or p1 check off. Output 1 means every check passed; output 2 means
  at least one failed, and the job log lists each failed check with its score and minimum. The scores are set as Flow Variables either way. A failed check no longer throws,
  so the Encoder template sends output 2 of each of its four Run VMAF nodes to a Compare File Size To Source node, whose output 1 routes back to the same encoder node and encodes again (through Set Working File) and whose output 2 restores the original (Mark step: Restored original, then the Muxer's final-merge entry). Anything that stops a score
  from being produced (ffmpeg fails, no log, different frame counts, missing files, a minimum that is not a number) still throws. The min and p1 defaults are uncalibrated starting
  values: on the scores recorded so far they would fail the two Boroughs encodes made with the 70% bitrate target (min 14-19, p1 55-65) and the F1 runs on min (38-49). A live Encoder
  flow that was not replaced from the new template has nothing wired to output 2, and what Tdarr does with a job that leaves through an unwired output is not verified. Checked in a
  sandbox with a stand-in for ffmpeg-vmaf-cuda; not yet seen in a real Tdarr job.
- **Frames below a score, counted in Run VMAF.** The new `countBelow` input (shown as Count frames below, default `60,70,75`) lists VMAF scores, as numbers above 0 up to 100 separated by
  commas, at most 8. After each score the plugin counts the frames of the per-frame log that scored strictly below it and appends the counts to the existing job log line
  (`VMAF score: mean=.. min=.. harmonic_mean=.. p1=.. n=.. below60=.. below70=.. below75=..`, in ascending order), sets the Flow Variable `user.vmafBelow` to the same figures
  joined with `;` (for example `below60=203;below70=981;below75=2712`), and Tag Output Metadata adds that text to the end of `TDARR_VMAF_SCORE`
  (`mean=..;min=..;p1=..;below60=..;below70=..;below75=..`). The counts are only reported: they never change which output the file leaves through. An empty input counts nothing, and the
  log line and the tag keep their old form. A value that is not a number in that range fails the job, like the minimums. A tag written by an earlier version has no counts, and
  the per-frame file is still removed after scoring, so earlier runs cannot be counted afterwards. Checked in a sandbox with stand-ins for the CLI helper and ffmpeg-vmaf-cuda and a
  made-up per-frame log; Tag Output Metadata's one-line change was checked as a string only, not with `mkvpropedit`; not yet seen in a real Tdarr job.
- **Worst stretches in Run VMAF.** The per-frame scores say how many frames are low but not where, so Run VMAF can also report the lowest-scoring stretches of the file (issue #123).
  The new `worstSeconds` input (shown as Worst stretches: window length (seconds), default `5`, a number above 0 up to 300) and `worstCount` input (Worst stretches: how many, default `3`,
  a whole number from 0 to 10, `0` = off) set it up. From the per-frame scores the plugin takes the rolling mean over windows of that length, picks the lowest windows that do not overlap
  (a window that starts within one window length of an already picked one is skipped) and reports each as `HH:MM:SS/mean/min`, worst first: the start time in the file, the window's mean
  and its lowest frame, one decimal each (for example `worst=00:23:41/61.2/48.3,00:41:05/64.0/60.1`). The start time is counted from the frame number and the frame rate, whole seconds
  rounded down, so it is exact for a constant frame rate and drifts for a variable one. The text goes to the job log (`worst stretches (windows of 5 s = 120 scored frames, ...)`), to the
  Flow Variable `user.vmafWorst` (the whole `worst=...` text, cleared for an unscored file like the other VMAF variables), and Tag Output Metadata and Tag VMAF Score put it right after the
  below counts in `TDARR_VMAF_SCORE` (`mean=..;min=..;p1=..;below60=..;below70=..;below75=..;worst=..;every=..;geom=..`). Reported only: it never changes which output the file leaves
  through. It always lists the requested number of windows, so a file with one real dip also lists healthy windows (there is no score threshold). With `frameStep` above 1 (CPU path) a window
  holds `round(seconds x fps / N)` scored frames and the times account for the step; the GPU path scores every frame. A file shorter than one window gets one window over all of it; a value that
  is not in range fails the job, like the other inputs. A Run VMAF node already saved in a flow has no value for the two new inputs; the plugin fills missing inputs from its defaults, so such a
  node is expected to start writing `worst=` after a `tdarr` restart (not seen in Tdarr; set `worstCount` to 0 on a node to turn it off). Checked in a sandbox with a stand-in per-frame log
  (hand cases, 200 random arrays against a naive version, 360,000 frames in about 130 ms) and both tag plugins writing and reading back the tag with real `mkvpropedit`; no real libvmaf score and
  not yet seen in a real Tdarr job.
- **Run VMAF scores on the GPU or the CPU, whichever the node has.** Run VMAF looks for the file in its input *GPU device file* (default
  `/dev/nvidiactl`, which a container with the NVIDIA runtime has) and picks the path for that run, logging which and why. With it: the GPU path as
  before (NVDEC decode, `scale_cuda`, `libvmaf_cuda`, one run at a time under the lock file). Without it: the CPU path (software decode, the `format`
  filter, the plain `libvmaf` filter, no lock), so a node without a GPU such as drakebay or ojochal can run the Encoder's VMAF step too. Both write
  the same per-frame log and everything after scoring (the mean, min, p1, the counts, the output) is the same. The CPU path is about seven times
  slower (47 fps on 6 threads at 1080p, one clip, against the GPU), so its threads are limited by the input *CPU path: percent of the node CPUs*
  (default 50, a whole number from 1 to 100, rounded to whole threads and at least 1, so a 6-CPU node uses 3 and a 16-CPU node uses 8); it takes no lock,
  so two runs can overlap, and the share is what keeps one from taking the whole node.
  A GPU node whose CUDA run fails fails the job; it does not quietly score on the CPU. Both paths need `ffmpeg-vmaf-cuda` from the
  `tdarr-vmaf-cuda` overlay **at version 0.2.0 or later** on nodes without a GPU (earlier builds do not start without an NVIDIA driver). Whether
  `/dev/nvidiactl` is present in the Tdarr containers on naples (and absent on drakebay and ojochal) has not been checked; the job log line
  `Run VMAF: scoring on the GPU (...)` or `scoring on the CPU (...)` says what the plugin saw. Software AV1 decoding is not in the binary, so an AV1 file
  cannot be scored on the CPU path (and the GPU path needs a card that decodes AV1). Checked in a sandbox with stand-ins for the CLI helper and ffmpeg,
  not yet seen in a real Tdarr job or against a real ffmpeg-vmaf-cuda on either path.
- **Run VMAF can score every Nth frame on the CPU path.** The new input *CPU path: score every Nth frame* (`frameStep`, default 1 = every frame, a whole
  number from 1 to 10) passes `n_subsample=N` to libvmaf. Measured on 60 s of one 1080p episode with 16 threads on drakebay (both files are still
  decoded in full, so the saving is smaller than the frame count suggests): every 2nd frame took 56% of the CPU time and 64% of the wall time (9.4x
  real time against 6.0x), every 4th 35% and 52% (11.6x); the mean moved by 0.003 and 0.013, min was the same, p1 was 0.10 and 0.24 lower. The
  catch is that a bad frame that is not scored is not seen (a run of N or more bad frames is always seen), so min and p1 are less reliable.
  `n=` in the log is the number of frames scored; the *frames below* counts are the counts among them times N, an estimate for the whole file
  that compares with a GPU node's; the job log says so, and `TDARR_VMAF_SCORE` gets `;every=N` at the end when N is above 1 (the Flow Variable
  `user.vmafStep`). The GPU path always scores every frame and logs a note if the input is above 1. With the default 1 nothing changes. Checked
  in a sandbox with a stand-in for ffmpeg-vmaf-cuda (the filter, the counts, the log and the variables), and the figures above on one real clip;
  not yet seen in a real Tdarr job. Hardware decode (VAAPI/QSV) was also measured and not pursued: it saves about 6 CPU-seconds per 60 s clip per
  file, about 4.5% of the 137 CPU-seconds one full-frame scoring takes.
- **Updating a live flow from a template.** Each template carries the flow's own `_id` (the `goToFlow` nodes in the other flows
  point at flows by id), so importing it from Add Flow > Local prompts Replace and keeps the id (observed by the owner,
  2026-11-09). A template without an `_id` (the 0.2.0 ones) made a new flow with a random id next to the live one, and the old
  flows kept pointing at each other (observed 2026-11-08). While a flow is bound to libraries, importing it from the Local tab does
  not replace it in place: it lands as a new flow with a random id (observed with the Controller, 2026-11-09/10). Unbind the
  libraries first, Replace, then rebind them. A flow no library uses (the Encoder and the Muxer)
  is replaced in place, as long as its `_id` is the one in the template.
- **Language tags in the Controller's stream cleanup.** (This was the separate Stream Cleanup flow until it was merged into the Controller.) The flow keeps English audio only. Require English Audio checks ffprobe's `tags.language`
  for an exact match with its `languages` input (`eng,en` in the template: a track tagged `eng` or a raw `en` both count). If no audio
  track matches, the file goes to Repair Language Tags: output 1 (tags repaired) continues to Begin Command, output 2 (nothing to
  repair) goes to Fail Flow. Repair Language Tags changes a Matroska file only in place with `mkvpropedit` (no remux), only tracks with
  no language, and only in one of two cases. (1) The container was last written by ffmpeg (muxing or writing application starts with
  `Lavf`, the signature of the old `-map_metadata -1` remux) and it has an untagged audio track: every untagged audio and subtitle track
  is set to `eng`. (2) The file has exactly one audio track, that track has no language, and the first video track has the same
  language (`eng`, a raw `en`, or a BCP 47 tag such as `en` or `en-US` on its own): that audio track, and only that one, is set to
  `eng`. Case 2 does not look at the writing application. A video tagged with another language, or untagged, never causes a change.
  The tag written is the legacy three-letter one on purpose: a track tagged only through `language-ietf` shows no language in ffprobe,
  so Require English Audio would not see it. Each change is read back with `mkvmerge --identify`.
- **Tests.** [`ci.yml`](.github/workflows/ci.yml) builds the image and runs [`smoke-test.sh`](tdarr-flow-plugins/smoke-test.sh):
  exactly the expected files, byte-identical to the repo, `node --check`, the s6 files, and the start-up script's copy rule
  (install / unchanged / replace-and-log / put back / retire / twice is a no-op / owner and mode) in a container. CI has no Tdarr server,
  so that Tdarr loads the plugins and that the service runs before the server starts are checked by hand (below).
- **Check by hand after the first release.** (1) Add `DOCKER_MODS` to a scratch Tdarr server container with its own empty server
  folder, never the live `/opt/tdarr/server`; check the files appear with the right owner and mode and Tdarr lists the plugins.
  (2) Add it to the live server container, restart it, and run one real file through the Controller flow.

amd64 only. Published by dispatching
[`release-tdarr-flow-plugins.yml`](.github/workflows/release-tdarr-flow-plugins.yml) (it does not follow an upstream release);
merging a pull request publishes nothing. Versions are `0.x` until the checks above have been done. The first publish may need
the Docker Hub token's repository scope widened for the new image name.

## What is different from the LinuxServer image

One file: `Radarr.Core.dll` / `Sonarr.Core.dll` / `Lidarr.Core.dll` (Sportarr: `Sportarr.dll`), rebuilt from the upstream source tag with small
patches ([`radarr/patches`](radarr/patches), [`sonarr/patches`](sonarr/patches), [`lidarr/patches`](lidarr/patches),
applied in file-name order) plus one new source file
([`common/ScheduledTaskIntervalOverrides.cs`](common/ScheduledTaskIntervalOverrides.cs)). Everything else in the image
is LinuxServer's, unchanged.

1. **`01-task-interval-overrides.patch`** adds `IAppFolderInfo` to `TaskManager`'s constructor, loads the overrides at
   start and applies them to the default task list, and re-applies them when Settings is saved.
2. **`02-skip-metadata-extras.patch`** makes the step that runs after a cover re-download return immediately when no
   metadata consumer (Kodi/Emby, Roksbox, WDTV and so on) is enabled. With no consumer there is nothing to write, and
   the step would only read the database and check the media folder. Cover download and resizing are unchanged. The
   one thing lost is that step's cleanup of database rows for metadata files that no longer exist; the library-scan
   paths still do that. With any consumer enabled the behaviour is upstream's.
3. **`03-scheduled-trigger.patch`** lets an API call ask for the Scheduled trigger (see above). It changes
   `CommandQueueManager.Push` to keep a requested `scheduled` trigger, and publishes the effective task intervals
   from `TaskManager`. In Lidarr it also removes the controller line that forced the trigger to Manual.
4. **Lidarr only: `04-no-file-delete-for-metadata-removals.patch`** stops a metadata refresh from announcing file
   deletions that did not happen. When a refresh drops an album or artist that has no files, upstream deletes the
   database row with `deleteFiles = true`, so `AlbumDeletedEvent` says files were deleted and the Plex connection
   answers each one with a library scan of the artist folder (25 scans in 3 seconds on one scheduled Refresh Artist).
   The patch passes `false` in `RefreshAlbumService` and `RefreshArtistService`. These paths only run for entries with
   no files, so nothing is lost; a delete you do yourself in the UI is unchanged. Radarr and Sonarr mark such items
   as deleted rather than removing them, so they have no equivalent patch.
5. **Sonarr and Radarr only: `04-preimport-validator.patch`** (with `common/PreImportValidator.cs`) makes
   `CompletedDownloadService.Check()` ask a configured PreImportValidator before a download becomes `ImportPending`,
   and adds a `MarkAsFailed(trackedDownload, message)` overload so a failed check shows its reason in history --
   see [Import hold](#import-hold) above.
6. **Sportarr only: `sportarr/patches/01-preimport-validator.patch`** (with `sportarr/PreImportValidator.cs`) is the
   same idea for Sportarr's own import monitor (`sportarr/patches/02-quality-tag-forwarding.patch` adds the league's tags;
   `sportarr/patches/03-seed-goal-removal-fix.patch` lets a finished, stopped torrent on an indexer with no seed goal
   configured in Sportarr be removed, instead of staying in the client forever: seed limits are enforced by the torrent
   client, which only reports the torrent stopped once its own limits are met). The Sportarr image is built differently: `sportarr/sportarr` is not a LinuxServer image and Sportarr
   compiles into a single `Sportarr.dll`, so that one assembly is rebuilt with upstream's own publish command and
   copied over the official image.
7. **Sonarr and Radarr only: `05-quality-tag-forwarding.patch`** adds `ITagService` to `CompletedDownloadService`'s
   constructor and resolves every tag label on the series/movie, sending the whole list to the PreImportValidator as
   `"tags"` -- see the quality-tag routing notes under [Import hold](#import-hold) and
   [Import validator](#import-validator-tdarr-download-validator) above.

## How the images are built

- [`release.yml`](.github/workflows/release.yml) runs every 6 hours (and on demand). It finds the newest stable
  upstream release and the exact LinuxServer build of it, and if `bdelima/<app>:<version>-ls<N>` is not on Docker
  Hub yet it builds the image, runs [`tests/start-test.sh`](tests/start-test.sh), and pushes it. A new
  LinuxServer rebuild of the same upstream version publishes too. Otherwise it does nothing.
- The start-test runs the real image three times (no file, a file overriding several tasks including
  settings-derived ones, a file with bad lines) and asserts the intervals through the app's API.
- [`ci.yml`](.github/workflows/ci.yml) builds and tests both images on every pull request, without pushing.
- If upstream changes the lines the patch touches, the build **fails** at `git apply --check` instead of shipping
  an image without the override. That is the signal to update the patch.

The build needs `.NET SDK 8` for Radarr and Lidarr, `6` for Sonarr and `10` for Sportarr (their projects target `net8.0`,
`net6.0` and, since Sportarr v4.1.12, a `global.json` that asks for SDK 10.0.100); the Dockerfiles use the matching SDK images.

## License and source

These images contain modified GPL-3.0 software, so this repository is licensed **GPL-3.0** (see
[`LICENSE`](LICENSE)). The corresponding source of an image is the upstream tag in its
`dev.pumapants.upstream-tag` label plus this repository at the commit in its `org.opencontainers.image.revision`
label. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

Unofficial and not affiliated with or endorsed by the Radarr, Sonarr, Lidarr or LinuxServer.io projects.
