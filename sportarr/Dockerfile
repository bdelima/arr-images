# syntax=docker/dockerfile:1
#
# Sportarr with an import hold: a `.tdarr-hold` marker in a download's output folder keeps that one download from
# being imported until the marker is removed (see the README, "Import hold").
#
# An overlay on the official sportarr/sportarr image: the only change is a rebuilt Sportarr.dll, compiled from the
# upstream source tag with the patches in sportarr/patches/ (applied in file-name order). Everything else in the
# image (the web UI, ffmpeg and the media drivers, the entrypoint) is upstream's, unchanged. Build context: the
# repository root.
#
#   docker build -f sportarr/Dockerfile \
#     --build-arg UPSTREAM_TAG=v4.1.11.1121 --build-arg BASE_TAG=4.1.11.1121 --build-arg VERSION=4.1.11.1121 .
#
# CI (see .github/workflows) resolves the build args. For Sportarr BASE_TAG is the Docker Hub tag of the release,
# which is the version itself (Sportarr has no -lsN builds).

ARG UPSTREAM_TAG
ARG BASE_TAG

# ---- fetch the upstream source ----
FROM --platform=$BUILDPLATFORM alpine:3 AS source
ARG UPSTREAM_TAG
RUN apk add --no-cache git ca-certificates \
    && git clone --quiet --depth 1 --branch "${UPSTREAM_TAG}" https://github.com/Sportarr/Sportarr.git /src

# ---- build the patched assembly (runs on the build host's own architecture; the output is managed code) ----
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG UPSTREAM_TAG
ARG VERSION

WORKDIR /src
COPY --from=source /src /src

COPY sportarr/patches/ /patches/

# git apply --check first: if upstream changed the patched lines, fail here with a clear message instead of
# building something that silently lacks the hold.
# The publish command is upstream's own Docker publish step (its release workflow), with only the output path
# changed. SkipFrontendBuild=true is what upstream passes too: the web UI is built in a separate Node step that
# this image does not need, because the UI files come from the official image. -p:Version stamps the assembly
# (and the projects it references) with the release version, as upstream's build does, so the rebuilt
# Sportarr.dll references exactly the Sportarr.Data.dll that ships in the official image.
# The output is architecture-neutral managed code (no ReadyToRun), so one build serves amd64 and arm64.
RUN test -n "${VERSION}" || { echo "VERSION build-arg is required (the upstream release version, e.g. 4.1.11.1121)" >&2; exit 1; } \
    && for p in /patches/*.patch; do echo "applying $p"; git apply --check "$p" && git apply "$p" || exit 1; done \
    && dotnet publish src/Sportarr.csproj -c Release -r linux-x64 --self-contained false \
         -p:PublishSingleFile=false -p:SkipFrontendBuild=true -p:Version=${VERSION} -o /out --nologo -v minimal

# ---- the official image with the one assembly replaced ----
FROM sportarr/sportarr:${BASE_TAG}

ARG UPSTREAM_TAG
ARG BASE_TAG
ARG VERSION=unknown
ARG REVISION=unknown

COPY --from=build /out/Sportarr.dll /app/Sportarr.dll
COPY --from=build /out/Sportarr.pd[b] /app/

LABEL org.opencontainers.image.title="sportarr (import hold)" \
      org.opencontainers.image.description="Official Sportarr with a .tdarr-hold marker that holds a download back from import" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.base.name="sportarr/sportarr:${BASE_TAG}" \
      dev.pumapants.upstream-tag="${UPSTREAM_TAG}" \
      dev.pumapants.base-tag="${BASE_TAG}"
