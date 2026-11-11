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

**Stale records.** A finished Tdarr record is compared with the file on disk (size and modification time from the record's `statSync`). If they differ, the record belongs to an older file at the same path (a re-download of a release): it is removed from Tdarr's file database and the file is scanned like an unseen one. Records with no stored size/time, files not visible to the validator, and records with no decision yet are left as they are. A path is not cleaned again for an hour.

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
| `TDARR_LIBRARY_ID` | dbID of the default library the downloads belong to |
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

The node also needs a working NVIDIA setup (host driver, `nvidia-container-toolkit`, the GPU passed to the container
with the `video` driver capability), which provides the driver-level libraries this image deliberately does not carry.
Unlike Tdarr's own ffmpeg, `ffmpeg-vmaf-cuda` links `libcuda.so.1` directly, so it only starts on a node that has the GPU
attached.

What is in the overlay: the binary, libvmaf and any CUDA runtime library it links in
`/usr/local/lib/tdarr-vmaf-cuda/` (the binary has an RPATH to it, so no `LD_LIBRARY_PATH` is needed), the VMAF model in
`/usr/local/share/model/`, and the licences plus the exact source revisions in `/usr/share/doc/tdarr-vmaf-cuda/`.
Decoding goes through NVDEC and scaling through `scale_cuda`; x264, x265 and libnpp are left out on purpose.

It is built for one GPU generation, set by the `CUDA_ARCH` build argument (default `75`, Turing -- the RTX 2060 Super).
amd64 only. It is published by dispatching [`release-tdarr-vmaf-cuda.yml`](.github/workflows/release-tdarr-vmaf-cuda.yml)
(it does not follow an upstream release) and built and smoke-tested by [`ci.yml`](.github/workflows/ci.yml). CI has no GPU:
it checks that the binary starts on a plain Ubuntu 22.04, links everything, reports `--enable-libvmaf`/`--enable-cuda-nvcc`,
has the `libvmaf_cuda` and `scale_cuda` filters, and that (CPU) libvmaf scores a clip against itself. Scoring on the
GPU is checked by hand on the node after a release. Versions are `0.x` until that has been done on real files.

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
container. It replaces hand-copying files onto the server: at every container start it puts thirteen Local Flow Plugins
(`classifySource`, `setMaxBitrate`, `tagEncodeSettings`, `tagOutputMetadata`, `checkSourceEfficiency`,
`setSourceRelativeBitrate`, `requireEnglishAudio`, `removeUntaggedAudio`, `mkvmergeExecute`, `repairLanguageTags`, `markStep`, `requireTrail`, `runVmaf`) and the flow template files for the Downloads
Flow (Controller, Converter, Validator, Stream Cleanup, Clean-only passthrough) into the server's plugin folder. The files in
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
  plugin folder or a file the image ships; the log says `removed ...`). Today it holds `LocalFlowTemplates/video/languageTagRepair.js`. Files are
  owned by `PUID:PGID` (when set), mode 664, new folders 775.
  The script never stops the container from starting; a failure is a log line. A new plugin file needs the server restarted to load, which a container restart does anyway.
- **Not in the image:** the five flows themselves (they live in Tdarr's database; import them with Add Flow > Import JSON Flow
  Template) and any Tdarr settings. A flow already imported from a template stays in Tdarr's database when the template is retired;
  delete it in the Flows tab.
- **Each flow template has its own version, stamped by the build.** The build appends a version to each template's flow name
  ("Controller" becomes "Controller (v9)"), so copies of a flow made from different template versions can be told apart in
  Tdarr. The version is the number of commits that touched that template file
  ([`template-versions.sh`](tdarr-flow-plugins/template-versions.sh), which CI and the release workflow run on the full
  history and pass to the build). It goes up by one each time a template is changed and stays put while it is not, so a release
  does not rename templates that did not change, and nobody has to bump anything. It is a counter, not the release number: the image
  version (`tdarr-flow-plugins/VERSION`) is separate. The template files in the repo keep their plain names. The build and smoke
  test fail if a template has no version stamped. Nothing in Tdarr refers to a flow by name (`goToFlow` takes a flow id and a node id).
- **Step trail (confirming the order of steps).** A node's job-log lines can arrive late, so log times cannot show the order in which
  steps ran. `markStep` appends one numbered entry (`seq|label|node|worker|UTC time`) to the Flow Variable `tdarrTrail` at the point it
  is placed, and `requireTrail` fails the flow (output 2, wired to Fail Flow) unless the labels it is given are in the trail in that
  order; the order comes from the sequence numbers, not from any clock. The Controller, Converter and Validator templates carry the
  stamps, the Validator's passthrough path ends in a `requireTrail` gate (`validator-hc-queue`, then `validator-hc-done`)
  in front of Tag Output Metadata (the re-encode path also stamps `validator-back-local`, but it never reaches the gate, so that
  label is not required there; the 0.6.0 flow required it and failed every passthrough file), and Tag Output Metadata adds its own closing entry and writes the whole trail into the file's
  `TDARR_TRAIL` tag. Read it back with `tdarr-ffmpeg -i <file> 2>&1 | grep -i TDARR_TRAIL`. The time in an entry is the clock of the
  node that ran the step, so it is comparable between nodes only when their clocks agree.
- **Tags survive a later pass.** Every mkvmerge remux drops the file's global tags, so without help a second pass over an already-encoded
  file would lose the tags its encode run wrote. Tag Output Metadata first reads the `TDARR_` tags of the original library file (from the
  probe data Tdarr holds, `format.tags`; if that has none, from an `ffmpeg -f ffmetadata` read of the file) and merges them with this run's.
  The tags that describe an encode (`TDARR_ENCODE_PARAMS`, `TDARR_QUALITY_TIER`, `TDARR_SOURCE_CLASS`, `TDARR_SOURCE_BPP`,
  `TDARR_SIZE_RATIO`, `TDARR_VMAF_SCORE`, `TDARR_ENCODE_VERSION`, `TDARR_ENCODE_TRAIL`) are rewritten only when this run re-encoded the video
  (the trail has `converter-encode-done`); when it did not, and the original already carries `TDARR_ENCODE_PARAMS` or `TDARR_ENCODE_TRAIL`,
  they are kept as the encode run wrote them. `TDARR_PIPELINE_VERSION` and `TDARR_TRAIL` always describe the run that wrote them, so
  `TDARR_ENCODE_VERSION` and `TDARR_ENCODE_TRAIL` are copies of those two taken at the encode run. Any other `TDARR_` tag on the original is
  carried over unchanged. The job log says how many tags were found, where they came from and which were kept. Checked on real Matroska
  files with `mkvpropedit`, `ffprobe` and `ffmpeg` in a sandbox, with Tdarr's helpers stubbed; not yet seen in a real Tdarr job, and whether
  Tdarr's own probe data carries `format.tags` is not confirmed (the ffmpeg read covers it if it does not).
- **Frame-count check before VMAF.** Run VMAF pairs frame N of the original with frame N of the encode, so files with different frame
  counts cannot be scored meaningfully. Before taking the GPU lock it counts the video packets of both files with `ffprobe -count_packets`
  (the sibling of Tdarr's ffmpeg, then `tdarr-ffprobe`, then `ffprobe`) and fails the job, naming both counts, when they differ at all. If the
  count cannot be made (no ffprobe, a timeout), it logs a warning and scores as before. The count reads each file once without decoding it.
- **Updating a live flow from a template.** Each template carries the flow's own `_id` (the `goToFlow` nodes in the other flows
  point at flows by id), so importing it from Add Flow > Local prompts Replace and keeps the id (observed by the owner,
  2026-11-09). A template without an `_id` (the 0.2.0 ones) made a new flow with a random id next to the live one, and the old
  flows kept pointing at each other (observed 2026-11-08). While a flow is bound to libraries, importing it from the Local tab does
  not replace it in place: it lands as a new flow with a random id (observed with the Controller, 2026-11-09/10). Unbind the
  libraries first, Replace, then rebind them. A flow no library uses (Converter, Validator, Stream Cleanup, Clean-only passthrough)
  is replaced in place.
- **Language tags in Stream Cleanup.** The flow keeps English audio only. Require English Audio checks ffprobe's `tags.language`
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
  (2) Add it to the live server container, restart it, and run one real file through the Converter flow.

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
