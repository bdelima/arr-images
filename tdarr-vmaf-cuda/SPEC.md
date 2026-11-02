# tdarr-vmaf-cuda — build spec

## What this is

A `DOCKER_MODS` overlay image for Tdarr's node container on naples. It adds a
CUDA-accelerated ffmpeg build (linked against libvmaf) alongside Tdarr's own
bundled ffmpeg, so a Flow step can score a transcoded file against its
original with `libvmaf_cuda` on naples' RTX 2060 Super, without forking or
rebuilding Tdarr's own image.

**Not in scope here:** the Tdarr Flow changes that call this binary (Validator
flow wiring, Node Tag scheme, pass/fail threshold) — those are Tdarr UI
config, applied by hand the same way the rest of the Downloads Flow has been,
and depend on open decisions listed below. This spec covers only the image
this repo needs to build and publish.

## Why a mod image, not a custom Tdarr image

Tdarr's official image (`haveagitgat/tdarr` / `haveagitgat/tdarr_node`) is
built `FROM lsiobase/ubuntu:jammy` — LinuxServer.io's base, which carries
their s6-overlay mod-init system. `DOCKER_MODS` on naples' Tdarr node service
downloads this image's filesystem and overlays it onto `/` at container boot,
before Tdarr's own init runs. That means this repo never has to track or
rebuild Tdarr's upstream image — it ships a small overlay that reapplies on
top of whatever Tdarr version is already running.

## Docker Hub repo

**`bdelima/tdarr-vmaf-cuda`** — confirmed, matches the directory name here.

## What the image contains

- `/usr/local/bin/ffmpeg-vmaf-cuda` — a custom ffmpeg build, **not** at the
  path Tdarr's own plugins call, so it can't interfere with the existing
  QSV/VAAPI steps elsewhere in the Downloads Flow.
- `/usr/local/lib/libvmaf.so*` — libvmaf built with CUDA support.
- `/usr/local/share/model/vmaf_v0.6.1.json` (and any other VMAF model files
  worth shipping) — ffmpeg's `libvmaf_cuda` filter loads a model by path.
- The CUDA runtime libraries ffmpeg links against (`libcudart` etc.). These
  are **not** supplied by the container toolkit at runtime — only the
  driver-level libraries (`libcuda.so.1`, `libnvidia-encode.so.1`, …) get
  auto-injected by `nvidia-container-toolkit` based on the host driver. The
  toolkit's own runtime libraries have to ship in this image.

ffmpeg must be linked with `-Wl,-rpath,/usr/local/lib:/usr/local/cuda/lib64`
(or built fully static against these libs) rather than relying on
`LD_LIBRARY_PATH` being set at the time Tdarr's `runCli` plugin spawns it.
Tdarr → plugin runner → spawned shell is enough process layers that an
inherited env var is a real way for this to silently fail; baking the search
path into the binary itself removes that failure mode.

## Build (multi-stage, mirrors the `root-layer` pattern other mods use)

```
# syntax=docker/dockerfile:1
FROM nvidia/cuda:12.8-devel-ubuntu22.04 AS buildstage

RUN apt-get update && apt-get install -y --no-install-recommends \
      ninja-build cmake nasm pkg-config python3-pip git \
      libx264-dev libx265-dev libnuma-dev libgnutls28-dev ca-certificates \
    && pip3 install meson

# libvmaf, built with CUDA support
RUN git clone --depth 1 https://github.com/Netflix/vmaf.git /src/vmaf
RUN cd /src/vmaf/libvmaf && meson setup build --prefix=/root-layer/usr/local \
      --libdir=/root-layer/usr/local/lib --buildtype=release \
      --default-library=shared -Denable_cuda=true -Denable_tests=false \
    && ninja -C build install
RUN mkdir -p /root-layer/usr/local/share/model \
    && cp /src/vmaf/model/vmaf_v0.6.1.json /root-layer/usr/local/share/model/

# nv-codec-headers (matches ffmpeg's expected CUDA/NVENC API surface)
RUN git clone --depth 1 https://github.com/FFmpeg/nv-codec-headers.git /src/nv-codec-headers
RUN cd /src/nv-codec-headers && make PREFIX=/root-layer/usr/local install

# ffmpeg, linked against the libvmaf just built
RUN git clone --depth 1 https://github.com/FFmpeg/FFmpeg.git /src/ffmpeg
RUN cd /src/ffmpeg && PKG_CONFIG_PATH=/root-layer/usr/local/lib/pkgconfig ./configure \
      --prefix=/root-layer/usr/local \
      --enable-cuda --enable-cuda-nvcc --enable-ffnvcodec \
      --enable-nvdec --enable-nvenc --enable-cuvid --enable-libnpp \
      --enable-libvmaf --enable-gpl --enable-nonfree --enable-gnutls \
      --extra-cflags="-I/usr/local/cuda/include -I/root-layer/usr/local/include" \
      --extra-ldflags="-L/usr/local/cuda/lib64 -L/root-layer/usr/local/lib -Wl,-rpath,/usr/local/lib:/usr/local/cuda/lib64" \
    && make -j"$(nproc)" && make install
RUN mv /root-layer/usr/local/bin/ffmpeg /root-layer/usr/local/bin/ffmpeg-vmaf-cuda \
    && rm -f /root-layer/usr/local/bin/ffplay /root-layer/usr/local/bin/ffprobe

# carry over the CUDA runtime libs the binary needs (not the devel/headers)
RUN mkdir -p /root-layer/usr/local/cuda-runtime-libs \
    && cp /usr/local/cuda/lib64/libcudart.so* /root-layer/usr/local/cuda-runtime-libs/

ARG VERSION=unknown
ARG REVISION=unknown

FROM scratch
COPY --from=buildstage /root-layer/ /

LABEL org.opencontainers.image.title="tdarr-vmaf-cuda" \
      org.opencontainers.image.description="DOCKER_MODS overlay: adds a CUDA+libvmaf ffmpeg build to a Tdarr node for VMAF quality scoring" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images"
```

(This is a working draft, not verified by a real build — GPU-having hardware
to test the CUDA build against isn't available in this session. The code
session should expect to debug actual compile/link errors; the flags and
clone targets above are the documented/known-correct set from upstream
build guides, not a build I've run.)

## Deploying it (naples side, not this repo)

Naples' Tdarr node compose service needs, in addition to the host-level
driver + `nvidia-container-toolkit` + device-reservation changes already
discussed separately:

```yaml
environment:
  - DOCKER_MODS=bdelima/tdarr-vmaf-cuda:latest
```

## Release workflow

Like `tdarr-download-validator`, this isn't tracking an upstream release, so
it should follow the same **on-demand `workflow_dispatch`** pattern
(`release-validator.yml` is the template), not the scheduled upstream-polling
pattern `release.yml` uses for the arr apps. **I'm not adding the workflow
file in this PR** — per the repo's own rule, workflow changes get the code
session's explicit attention — but the shape would be:

- `release-tdarr-vmaf-cuda.yml`, `workflow_dispatch` with a `dry_run` input,
  same `release` Environment, same Docker Hub login step.
- Build and push `linux/amd64` only. The existing arr images build
  `amd64,arm64` — this one can't: there's no CUDA-capable arm64 target in
  this homelab, and an arm64 CUDA build isn't a real thing in this context.
- **No automated smoke test that exercises CUDA.** GitHub-hosted runners
  have no GPU, so CI can build the image and run `ffmpeg-vmaf-cuda -version`
  to confirm the binary exists and reports `--enable-libvmaf`/`--enable-cuda`
  in its configuration banner, but it cannot actually decode anything via
  NVDEC or run `libvmaf_cuda` against real frames. Real validation happens
  by hand on naples after a release, same as the rest of this project's
  testing has been.
- Add `tdarr-vmaf-cuda/**` to `ci.yml`'s path filters, with a build-only job
  (no push, no GPU exercise, same limitation as above).

## ATTRIBUTION.md entries needed

This image bundles more third-party material than anything else in the repo
so far, and one piece of it is worth flagging explicitly rather than quietly
including:

- **FFmpeg** — LGPL/GPL per-component; this build uses `--enable-gpl
  --enable-nonfree`, so the resulting binary as a whole is GPL-licensed (the
  `nonfree` flag is what unlocks linking against NVIDIA's libnpp/CUDA SDK and
  is the same flag jellyfin-ffmpeg itself uses for its NVENC support).
- **Netflix/vmaf (libvmaf)** — BSD-2-Clause-Patent (verify against the repo's
  actual `LICENSE` at the pinned commit, not assumed from memory).
- **nv-codec-headers** — MIT; headers only, no binary code.
- **NVIDIA CUDA Toolkit redistributable runtime libraries** (`libcudart`) —
  proprietary, governed by NVIDIA's CUDA EULA, *not* open source. NVIDIA's
  EULA does explicitly permit redistributing these specific "redistributable"
  libraries as part of an application for use with NVIDIA hardware (this is
  exactly why the official `nvidia/cuda` runtime images exist and are public
  on Docker Hub) — so this isn't the same category as bundling an unlicensed
  or fully proprietary tool, but it's a materially different kind of
  component than everything else in this repo and deserves its own clearly
  separate entry, and you should know it's in there before this gets
  published.

## Open decisions (not mine to make — flagging, not deciding)

1. **VMAF pass/fail threshold.** No data yet; needs real test runs against
   your library once the image exists.
2. **Where in the Validator flow this hooks in, and what Node Tag naples
   gets for it** — a new tag distinct from `local`, `encoder`, and
   `healthcheck-full`, since this needs naples specifically *and* GPU access.
3. **Full-frame scoring vs. subsampling** — the subsampling idea came from
   when CPU-only VMAF looked too slow; with CUDA it may not be needed at all.
4. **Starting VERSION** — suggest `0.1.0` (not yet built/released), but your
   call.

~~5. Exact Docker Hub repo name~~ — settled, see above.
