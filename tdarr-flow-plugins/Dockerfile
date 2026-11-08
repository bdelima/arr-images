# syntax=docker/dockerfile:1
#
# tdarr-flow-plugins: a DOCKER_MODS overlay for the Tdarr SERVER container (see the README, "Tdarr flow plugins"). It
# carries four Local Flow Plugins and the flow template files, and a start-up script that copies them into the server's
# plugin folder every time the container starts. Nothing is compiled or downloaded; the files in
# tdarr-flow-plugins/root are the source of truth and are shipped as they are.
# Build context: the repository root.
#
#   docker build -f tdarr-flow-plugins/Dockerfile --build-arg VERSION=$(cat tdarr-flow-plugins/VERSION) .
#
# The plugin files are staged under /defaults/tdarr-plugins (a host bind mount of /app/server would hide anything put at
# the real path) and copied by the s6 oneshot init-mod-tdarr-flow-plugins. The image installs only under /defaults,
# /etc/s6-overlay/s6-rc.d and /usr/share/doc/tdarr-flow-plugins, so it cannot replace anything Tdarr ships.

FROM debian:12-slim AS buildstage
COPY tdarr-flow-plugins/root/ /root-layer/
COPY LICENSE /root-layer/usr/share/doc/tdarr-flow-plugins/LICENSE

ARG VERSION=unknown
ARG REVISION=unknown
RUN set -eu; \
    # the s6 service files must be plain LF text and the run script executable, whatever the checkout did to them
    for f in $(find /root-layer/etc -type f -size +0); do sed -i 's/\r$//' "$f"; done; \
    chmod 0755 /root-layer/etc/s6-overlay/s6-rc.d/init-mod-tdarr-flow-plugins/run; \
    { echo "tdarr-flow-plugins $VERSION (source: https://github.com/bdelima/arr-images, revision $REVISION)"; \
      echo "plugins: $(cd /root-layer/defaults/tdarr-plugins/LocalFlowPlugins && find . -name index.js | sort | tr '\n' ' ')"; \
      echo "templates: $(cd /root-layer/defaults/tdarr-plugins/LocalFlowTemplates && find . -name '*.js' | sort | tr '\n' ' ')"; \
      echo "files (sha256):"; \
      (cd /root-layer/defaults/tdarr-plugins && find . -type f | sort | xargs sha256sum); \
    } > /root-layer/usr/share/doc/tdarr-flow-plugins/BUILD-INFO

FROM scratch
ARG VERSION=unknown
ARG REVISION=unknown
COPY --from=buildstage /root-layer/ /

LABEL org.opencontainers.image.title="tdarr-flow-plugins" \
      org.opencontainers.image.description="DOCKER_MODS overlay: puts four Tdarr Local Flow Plugins and the flow templates into a Tdarr server's plugin folder at every start" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only"
