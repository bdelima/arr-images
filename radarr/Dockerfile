# syntax=docker/dockerfile:1
#
# Radarr with every scheduled-task interval overridable from /config/scheduled-tasks.properties.
#
# An overlay on the LinuxServer.io image: the only change is a rebuilt Radarr.Core.dll, compiled from the
# upstream source tag with radarr/patches/task-interval-overrides.patch and common/ScheduledTaskIntervalOverrides.cs
# applied. Everything else in the image is LinuxServer's, unchanged. Build context: the repository root.
#
#   docker build -f radarr/Dockerfile \
#     --build-arg UPSTREAM_TAG=v6.4.4.10685 --build-arg BASE_TAG=6.4.4.10685-ls323 .
#
# CI (see .github/workflows) resolves both build args and pins BASE_TAG to the exact LinuxServer build.

ARG UPSTREAM_TAG
ARG BASE_TAG

# ---- fetch the upstream source (its own stage: the .NET SDK images are old Debian releases whose apt is unreliable) ----
FROM --platform=$BUILDPLATFORM alpine:3 AS source
ARG UPSTREAM_TAG
RUN apk add --no-cache git ca-certificates \
    && git clone --quiet --depth 1 --branch "${UPSTREAM_TAG}" https://github.com/Radarr/Radarr.git /src

# ---- build the patched assembly (runs on the build host's own architecture; the output is managed code) ----
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG UPSTREAM_TAG
ARG VERSION

WORKDIR /src
COPY --from=source /src /src

COPY radarr/patches/ /patches/
COPY common/ScheduledTaskIntervalOverrides.cs src/NzbDrone.Core/Jobs/ScheduledTaskIntervalOverrides.cs

# git apply --check first: if upstream changed the patched lines, fail here with a clear message instead of
# building something that silently lacks the override.
# AssemblyVersion: upstream stamps every release build with its own version number (its build.sh rewrites
# <AssemblyVersion> in src/Directory.Build.props). Without the same stamp the rebuilt assembly would carry the
# 10.0.0.* placeholder while the shipped assemblies reference the exact release version. Passing it as a
# global property stamps every project in this build, so the rebuilt assembly's references match too.
# global.json pins an exact SDK patch version; the image's SDK of the same major version is fine for this library.
# Upstream builds with warnings as errors and StyleCop; that is upstream's own lint, not a build requirement here.
RUN test -n "${VERSION}" || { echo "VERSION build-arg is required (the upstream release version, e.g. 6.4.4.10685)" >&2; exit 1; } \
    && git apply --check /patches/task-interval-overrides.patch \
    && git apply /patches/task-interval-overrides.patch \
    && rm -f global.json \
    && dotnet build src/NzbDrone.Core/Radarr.Core.csproj -c Release -o /out --nologo -v minimal \
         -p:AssemblyVersion=${VERSION} -p:TreatWarningsAsErrors=false -p:EnforceCodeStyleInBuild=false -p:RunAnalyzersDuringBuild=false

# ---- the LinuxServer image with the one assembly replaced ----
FROM lscr.io/linuxserver/radarr:${BASE_TAG}

ARG UPSTREAM_TAG
ARG BASE_TAG
ARG VERSION=unknown
ARG REVISION=unknown

COPY --from=build /out/Radarr.Core.dll /app/radarr/bin/Radarr.Core.dll
COPY --from=build /out/Radarr.Core.pdb /app/radarr/bin/Radarr.Core.pdb

ENV APP_VERSION=${VERSION}

LABEL org.opencontainers.image.title="radarr (scheduled-task intervals overridable)" \
      org.opencontainers.image.description="LinuxServer.io Radarr with every scheduled-task interval overridable from /config/scheduled-tasks.properties" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.base.name="lscr.io/linuxserver/radarr:${BASE_TAG}" \
      dev.pumapants.upstream-tag="${UPSTREAM_TAG}" \
      dev.pumapants.base-tag="${BASE_TAG}"
