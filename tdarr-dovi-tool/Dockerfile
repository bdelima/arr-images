# syntax=docker/dockerfile:1
#
# tdarr-dovi-tool: a DOCKER_MODS overlay for a Tdarr node (see the README, "DoVi/HDR10+ toolkit"). Adds dovi_tool and
# hdr10plus_tool at /usr/local/bin/, for the DoVi/HDR converter flow's Local Flow Plugins to shell out to. Neither tool
# replaces or touches anything Tdarr or its ffmpeg ships.
# Build context: the repository root.
#
#   docker build -f tdarr-dovi-tool/Dockerfile --build-arg VERSION=$(cat tdarr-dovi-tool/VERSION) .
#
# Unlike tdarr-vmaf-cuda, nothing is compiled here. quietvoid publishes prebuilt, fully static (musl, static-pie)
# binaries with no runtime shared-library dependencies, so this only downloads the pinned linux/amd64 release tarballs
# (amd64 only, like tdarr-vmaf-cuda: every Tdarr node here is x86_64), checks their SHA-256, checks that each binary runs
# and reports the pinned version, and copies the two binaries into a `FROM scratch` layer.

FROM debian:12-slim AS fetchstage

# Pinned so a build is reproducible, and so the corresponding source of what is published is exactly these releases.
# To bump one: check https://github.com/quietvoid/dovi_tool/releases and
# https://github.com/quietvoid/hdr10plus_tool/releases, then update the tag and both SHA-256 values below
# (`sha256sum` of the two x86_64 release tarballs). The two tools move independently.
ARG DOVI_TOOL_REF=2.3.4
ARG HDR10PLUS_TOOL_REF=1.7.2
ARG DOVI_TOOL_SHA256=1844258e13c26607b32224bf1fa82b595d3b35949f5467405fda560daad32b3f
ARG HDR10PLUS_TOOL_SHA256=06385f37a639d61ba21d4be3150c863846933bc3b58110e094d8fc8f1c2249f2

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN mkdir -p /root-layer/usr/local/bin

# quietvoid's release assets are named by Rust target triple; amd64 is x86_64-unknown-linux-musl. Each tarball holds just
# the one binary.
RUN triple=x86_64-unknown-linux-musl \
    && curl -fsSL -o dovi_tool.tar.gz \
         "https://github.com/quietvoid/dovi_tool/releases/download/${DOVI_TOOL_REF}/dovi_tool-${DOVI_TOOL_REF}-${triple}.tar.gz" \
    && echo "${DOVI_TOOL_SHA256}  dovi_tool.tar.gz" | sha256sum -c - \
    && tar -xzf dovi_tool.tar.gz \
    && install -m 0755 dovi_tool /root-layer/usr/local/bin/dovi_tool \
    && curl -fsSL -o hdr10plus_tool.tar.gz \
         "https://github.com/quietvoid/hdr10plus_tool/releases/download/${HDR10PLUS_TOOL_REF}/hdr10plus_tool-${HDR10PLUS_TOOL_REF}-${triple}.tar.gz" \
    && echo "${HDR10PLUS_TOOL_SHA256}  hdr10plus_tool.tar.gz" | sha256sum -c - \
    && tar -xzf hdr10plus_tool.tar.gz \
    && install -m 0755 hdr10plus_tool /root-layer/usr/local/bin/hdr10plus_tool

# Fail the build rather than ship a binary that does not run or is not the pinned version.
RUN [ "$(/root-layer/usr/local/bin/dovi_tool --version)" = "dovi_tool ${DOVI_TOOL_REF}" ] \
    && [ "$(/root-layer/usr/local/bin/hdr10plus_tool --version)" = "hdr10plus_tool ${HDR10PLUS_TOOL_REF}" ]

# Licences and the exact releases shipped with the binaries (both MIT).
ARG VERSION=unknown
ARG REVISION=unknown
RUN doc=/root-layer/usr/share/doc/tdarr-dovi-tool && mkdir -p "$doc" \
    && curl -fsSL -o "$doc/LICENSE.dovi_tool" "https://raw.githubusercontent.com/quietvoid/dovi_tool/${DOVI_TOOL_REF}/LICENSE" \
    && curl -fsSL -o "$doc/LICENSE.hdr10plus_tool" "https://raw.githubusercontent.com/quietvoid/hdr10plus_tool/${HDR10PLUS_TOOL_REF}/LICENSE" \
    && { echo "tdarr-dovi-tool $VERSION (source: https://github.com/bdelima/arr-images, revision $REVISION)"; \
         echo "dovi_tool $DOVI_TOOL_REF (https://github.com/quietvoid/dovi_tool/releases/tag/$DOVI_TOOL_REF), prebuilt amd64, MIT"; \
         echo "hdr10plus_tool $HDR10PLUS_TOOL_REF (https://github.com/quietvoid/hdr10plus_tool/releases/tag/$HDR10PLUS_TOOL_REF), prebuilt amd64, MIT"; \
       } > "$doc/BUILD-INFO"

FROM scratch
ARG VERSION=unknown
ARG REVISION=unknown
COPY --from=fetchstage /root-layer/ /

LABEL org.opencontainers.image.title="tdarr-dovi-tool" \
      org.opencontainers.image.description="DOCKER_MODS overlay: adds dovi_tool and hdr10plus_tool to a Tdarr node for the DoVi/HDR10+ converter flow" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="MIT"
