# arr-images

Unofficial Radarr, Sonarr and Lidarr container images where **every scheduled-task interval can be overridden** from a
plain properties file in `/config`.

Upstream hard-codes most of these intervals (they are compiled into `TaskManager.Handle(ApplicationStartedEvent)`
and overwritten from the code on every start, so editing the database does not stick). That is a problem on a
file server whose disks spin down: library-wide tasks such as *Refresh Movies* walk every movie folder on their
own timer and wake every drive. These images fix that, and nothing else.

| Image | Based on |
|---|---|
| `bdelima/radarr` | [`lscr.io/linuxserver/radarr`](https://github.com/linuxserver/docker-radarr) |
| `bdelima/sonarr` | [`lscr.io/linuxserver/sonarr`](https://github.com/linuxserver/docker-sonarr) |
| `bdelima/lidarr` | [`lscr.io/linuxserver/lidarr`](https://github.com/linuxserver/docker-lidarr) |

Tags: `latest`, `<upstream version>` (for example `6.4.4.10685`) and `<upstream version>-ls<N>` (for example
`6.4.4.10685-ls323`, the exact LinuxServer build it was made from). `amd64` and `arm64`.

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

## What is different from the LinuxServer image

One file: `Radarr.Core.dll` / `Sonarr.Core.dll` / `Lidarr.Core.dll`, rebuilt from the upstream source tag with small
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

The build needs `.NET SDK 8` for Radarr and Lidarr and `6` for Sonarr (their Core projects target `net8.0` and
`net6.0`); the Dockerfiles use the matching SDK images.

## License and source

These images contain modified GPL-3.0 software, so this repository is licensed **GPL-3.0** (see
[`LICENSE`](LICENSE)). The corresponding source of an image is the upstream tag in its
`dev.pumapants.upstream-tag` label plus this repository at the commit in its `org.opencontainers.image.revision`
label. See [`ATTRIBUTION.md`](ATTRIBUTION.md).

Unofficial and not affiliated with or endorsed by the Radarr, Sonarr, Lidarr or LinuxServer.io projects.
