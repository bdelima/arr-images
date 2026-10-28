# Attribution

This repository's own files (the patch, `common/ScheduledTaskIntervalOverrides.cs`, the Dockerfiles, scripts and
workflows) are licensed under the **GNU General Public License v3.0** (see `LICENSE`). They modify and build on the
GPL-3.0 projects below, and the images built from this repository redistribute modified builds of them, so GPL-3.0
applies. Everything below keeps its own license and copyright; nothing here relicenses it.

## Radarr

- **Project:** [Radarr/Radarr](https://github.com/Radarr/Radarr)
- **License:** GPL-3.0
- **How it's used:** the source tag named in each image's `dev.pumapants.upstream-tag` label is cloned at build time
  and `Radarr.Core.dll` is rebuilt from it with the patches in `radarr/patches/` applied and
  `common/ScheduledTaskIntervalOverrides.cs` added. **This is a modified version of Radarr.** The modification is
  limited to `TaskManager.cs` (reads `scheduled-tasks.properties` and applies it to the scheduled task intervals),
  `MetadataService.cs` (skips an image step when no metadata consumer is enabled), `CommandQueueManager.cs` (honors a
  requested Scheduled trigger) and the added source file; all are public in this repository.

## Sonarr

- **Project:** [Sonarr/Sonarr](https://github.com/Sonarr/Sonarr)
- **License:** GPL-3.0
- **How it's used:** same as Radarr, with the patches in `sonarr/patches/`. **This is a modified
  version of Sonarr.**

## Lidarr

- **Project:** [Lidarr/Lidarr](https://github.com/Lidarr/Lidarr)
- **License:** GPL-3.0
- **How it's used:** same as Radarr, with the patches in `lidarr/patches/`, which also change Lidarr's
  `CommandController.cs` (so `Lidarr.Api.V1.dll` is rebuilt too). **This is a modified
  version of Lidarr.**

## LinuxServer.io images

- **Projects:** [linuxserver/docker-radarr](https://github.com/linuxserver/docker-radarr),
  [linuxserver/docker-sonarr](https://github.com/linuxserver/docker-sonarr),
  [linuxserver/docker-lidarr](https://github.com/linuxserver/docker-lidarr)
- **License:** GPL-3.0
- **How it's used:** the final image stage is `lscr.io/linuxserver/<app>:<version>-ls<N>`, unchanged except for the
  one replaced assembly. The base build is recorded in the `dev.pumapants.base-tag` label. LinuxServer's own
  packages and their licenses are carried by that image.

## .NET SDK images

- **Project:** [dotnet/dotnet-docker](https://github.com/dotnet/dotnet-docker), the `mcr.microsoft.com/dotnet/sdk`
  images (SDK 8.0 for Radarr and Lidarr, 6.0 for Sonarr)
- **License:** MIT (the .NET SDK and its components carry their own licenses)
- **How it's used:** build stage only. Nothing from it is in the published images except the compiled managed
  assembly.

## Corresponding source

For any published image: the upstream tag in its `dev.pumapants.upstream-tag` label, plus this repository at the
commit in its `org.opencontainers.image.revision` label.

## Trademarks

"Radarr", "Sonarr", "Lidarr" and "LinuxServer.io" belong to their respective owners. This is an unofficial project, not
affiliated with or endorsed by them.
