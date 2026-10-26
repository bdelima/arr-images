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

## What is different from the LinuxServer image

One file: `Radarr.Core.dll` / `Sonarr.Core.dll`, rebuilt from the upstream source tag with a small patch
([`radarr/patches`](radarr/patches), [`sonarr/patches`](sonarr/patches), [`lidarr/patches`](lidarr/patches)) plus one new source file
([`common/ScheduledTaskIntervalOverrides.cs`](common/ScheduledTaskIntervalOverrides.cs)). The patch adds
`IAppFolderInfo` to `TaskManager`'s constructor, loads the overrides at start and applies them to the default task
list, and re-applies them when Settings is saved. Everything else in the image is LinuxServer's, unchanged.

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
