# Attribution

This repository's own files (the patch, `tdarr-download-validator/`, `common/ScheduledTaskIntervalOverrides.cs`, the Dockerfiles, scripts and
workflows) are licensed under the **GNU General Public License v3.0** (see `LICENSE`). They modify and build on the
GPL-3.0 projects below, and the images built from this repository redistribute modified builds of them, so GPL-3.0
applies. Everything below keeps its own license and copyright; nothing here relicenses it.

## Radarr

- **Project:** [Radarr/Radarr](https://github.com/Radarr/Radarr)
- **License:** GPL-3.0
- **How it's used:** the source tag named in each image's `dev.pumapants.upstream-tag` label is cloned at build time
  and `Radarr.Core.dll` is rebuilt from it with the patches in `radarr/patches/` applied and
  `common/ScheduledTaskIntervalOverrides.cs` and `common/PreImportValidator.cs` added. **This is a modified version
  of Radarr.** The modification is limited to `TaskManager.cs` (reads `scheduled-tasks.properties` and applies it to
  the scheduled task intervals), `MetadataService.cs` (skips an image step when no metadata consumer is enabled),
  `CommandQueueManager.cs` (honors a requested Scheduled trigger), `CompletedDownloadService.cs` and
  `FailedDownloadService.cs` (ask a configured pre-import validator before importing) and the added source files; all
  are public in this repository.

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

## Sportarr

- **Project:** [Sportarr/Sportarr](https://github.com/Sportarr/Sportarr)
- **License:** GPL-3.0
- **How it's used:** the source tag named in the image's `dev.pumapants.upstream-tag` label is cloned at build time
  and `Sportarr.dll` is rebuilt from it with the patches in `sportarr/patches/` applied and `sportarr/PreImportValidator.cs`
  added, then copied over the official
  `sportarr/sportarr` image. **This is a modified version of Sportarr.** The modification is limited to
  `EnhancedDownloadMonitorService.cs` (asks a configured pre-import validator, passing along the league's tags, before importing a completed download),
  `CompletedDownloadCleanup.cs` (a stopped, finished torrent on an indexer with no seed goal is removable instead of always kept)
  and the added source file; both are public
  in this repository. The rest of the image (web UI, ffmpeg and drivers, entrypoint) is the official image's, unchanged.

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
  images (SDK 8.0 for Radarr, Lidarr and Sportarr, 6.0 for Sonarr)
- **License:** MIT (the .NET SDK and its components carry their own licenses)
- **How it's used:** build stage only. Nothing from it is in the published images except the compiled managed
  assembly.

## Docker Hub: sportarr/sportarr

- **Project:** [Sportarr/Sportarr](https://github.com/Sportarr/Sportarr), image `sportarr/sportarr`
- **License:** GPL-3.0 (the project's; the image also carries third-party packages under their own licenses)
- **How it's used:** the final image stage is `sportarr/sportarr:<version>`, unchanged except for the replaced
  assembly. The base tag is recorded in the `dev.pumapants.base-tag` label.

## Tdarr

- **Project:** [HaveAGitGat/Tdarr](https://github.com/HaveAGitGat/Tdarr)
- **License:** Tdarr is proprietary freeware (not open source); no Tdarr code or binaries are included here.
- **How it's used:** `tdarr-download-validator` only talks to a user-run Tdarr server over its HTTP API
  (`/api/v2/cruddb`, `/api/v2/scan-files`). Written from the behaviour observed on the author's own instance.

## tdarr-vmaf-cuda: third-party material in the image

`bdelima/tdarr-vmaf-cuda` is the one image here that ships third-party *binaries* built from other projects' source,
not an upstream image with a replaced assembly. It is a `FROM scratch` overlay; what is in it:

- **FFmpeg** -- [FFmpeg/FFmpeg](https://github.com/FFmpeg/FFmpeg), pinned tag in the Dockerfile (`FFMPEG_REF`). LGPL
  or GPL per component; the build uses `--enable-gpl` and `--enable-nonfree` (the latter is required by
  `--enable-cuda-nvcc`, which compiles the CUDA filters with NVIDIA's compiler). FFmpeg's own documentation says a
  binary built with `--enable-nonfree` is not redistributable, so treat this image as built for the maintainer's own
  use; it is not offered as a general-purpose build. The GPL licence text ships in the image
  (`/usr/share/doc/tdarr-vmaf-cuda/COPYING.ffmpeg-GPLv3`).
- **libvmaf** -- [Netflix/vmaf](https://github.com/Netflix/vmaf), pinned tag (`VMAF_REF`). BSD-2-Clause-Patent (verify
  against `/usr/share/doc/tdarr-vmaf-cuda/LICENSE.libvmaf`, copied from the pinned revision). The model file
  `vmaf_v0.6.1.json` comes from the same repository and licence.
- **nv-codec-headers** -- [FFmpeg/nv-codec-headers](https://github.com/FFmpeg/nv-codec-headers), pinned tag
  (`NV_CODEC_HEADERS_REF`). MIT; headers only, built into the binaries (no separate library).
- **NVIDIA CUDA Toolkit** -- proprietary, governed by NVIDIA's CUDA EULA (copied to
  `/usr/share/doc/tdarr-vmaf-cuda/EULA.cuda-toolkit.txt`), **not open source**. The build image is
  `nvidia/cuda:12.4.1-devel-ubuntu22.04`. Only what the EULA lists as redistributable is carried (the CUDA runtime
  library, if the binaries link it), for use with NVIDIA hardware; `nvcc` and the headers stay in the build stage. The
  NVIDIA driver libraries (`libcuda`, `libnvcuvid`, ...) are not in the image; the host supplies them through the
  NVIDIA container toolkit.

Corresponding source for the GPL parts: the exact revisions are recorded inside the image in
`/usr/share/doc/tdarr-vmaf-cuda/BUILD-INFO`, the build recipe is `tdarr-vmaf-cuda/Dockerfile` in this repository at the
commit in the image's `org.opencontainers.image.revision` label.

## tdarr-dovi-tool: third-party material in the image

`bdelima/tdarr-dovi-tool` ships two prebuilt third-party binaries, unmodified, at their official release versions. It is
a `FROM scratch` overlay; nothing is compiled by this repository.

- **dovi_tool** -- [quietvoid/dovi_tool](https://github.com/quietvoid/dovi_tool), pinned release (`DOVI_TOOL_REF` in the
  Dockerfile). MIT (verify against `/usr/share/doc/tdarr-dovi-tool/LICENSE.dovi_tool`, copied from the pinned tag).
- **hdr10plus_tool** -- [quietvoid/hdr10plus_tool](https://github.com/quietvoid/hdr10plus_tool), pinned release
  (`HDR10PLUS_TOOL_REF`). MIT (verify against `/usr/share/doc/tdarr-dovi-tool/LICENSE.hdr10plus_tool`).

The release tarballs are downloaded from the projects' GitHub Releases and checked against SHA-256 values pinned in the
Dockerfile. Corresponding source: the release tag of each tool, recorded inside the image in
`/usr/share/doc/tdarr-dovi-tool/BUILD-INFO`, plus this repository at the commit in the image's
`org.opencontainers.image.revision` label.

## Corresponding source

For any published image: the upstream tag in its `dev.pumapants.upstream-tag` label, plus this repository at the
commit in its `org.opencontainers.image.revision` label.

## Trademarks

"Radarr", "Sonarr", "Lidarr", "Sportarr" and "LinuxServer.io" belong to their respective owners. This is an unofficial project, not
affiliated with or endorsed by them.

## tdarr-flow-plugins: material in the image

`bdelima/tdarr-flow-plugins` ships twelve Tdarr Local Flow Plugins and six flow template files written by the repository owner
(this repository's own code, GPL-3.0-only like the rest). They are written against the plugin API and helpers of
[HaveAGitGat/Tdarr_Plugins](https://github.com/HaveAGitGat/Tdarr_Plugins) (GPL-3.0) and modeled on its stock plugins such as
`runMkvPropEdit` and `ffmpegCommandSetVideoEncoder`. The plugins only `require()` Tdarr's helpers at run time; no Tdarr code or
binaries are bundled, so the statement under "Tdarr" above stays true. The image carries the repository `LICENSE` and a
`BUILD-INFO` with the version, revision and a checksum per file in `/usr/share/doc/tdarr-flow-plugins/`. Whether any single
file counts as derived from Tdarr_Plugins is for the author to judge; the whole repository is GPL-3.0, which covers either answer.
