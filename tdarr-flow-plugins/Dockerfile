# syntax=docker/dockerfile:1
#
# tdarr-flow-plugins: a DOCKER_MODS overlay for the Tdarr SERVER container (see the README, "Tdarr flow plugins"). It
# carries fifteen Local Flow Plugins and the flow template files, and a start-up script that copies them into the server's
# plugin folder every time the container starts. Nothing is compiled or downloaded; the files in
# tdarr-flow-plugins/root are the source of truth and are shipped as they are, with one exception: the build appends each
# flow template's own version to its name ("Controller" becomes "Controller (v12)"). That version is the number of commits
# that touched the template file (tdarr-flow-plugins/template-versions.sh), so it moves only when that template changes and
# a release does not rename templates that did not.
# Build context: the repository root.
#
#   docker build -f tdarr-flow-plugins/Dockerfile --build-arg VERSION=$(cat tdarr-flow-plugins/VERSION) \
#     --build-arg TEMPLATE_VERSIONS="$(tdarr-flow-plugins/template-versions.sh)" .
#
# The plugin files are staged under /defaults/tdarr-plugins (a host bind mount of /app/server would hide anything put at
# the real path) and copied by the s6 oneshot init-mod-tdarr-flow-plugins. The image installs only under /defaults,
# /etc/s6-overlay/s6-rc.d and /usr/share/doc/tdarr-flow-plugins, so it cannot replace anything Tdarr ships.

FROM debian:12-slim AS buildstage
COPY tdarr-flow-plugins/root/ /root-layer/
COPY LICENSE /root-layer/usr/share/doc/tdarr-flow-plugins/LICENSE

ARG VERSION=unknown
ARG REVISION=unknown
ARG TEMPLATE_VERSIONS=
RUN set -eu; \
    # the s6 service files must be plain LF text and the run script executable, whatever the checkout did to them
    for f in $(find /root-layer/etc -type f -size +0); do sed -i 's/\r$//' "$f"; done; \
    chmod 0755 /root-layer/etc/s6-overlay/s6-rc.d/init-mod-tdarr-flow-plugins/run; \
    # stamp each flow template's own version (from TEMPLATE_VERSIONS, "controller.js=12 converter.js=9 ...") into its name. A
    # template's own name is the one line indented exactly four spaces ("name": ...); every template must have exactly one,
    # an entry in TEMPLATE_VERSIONS, and must end up carrying " (v<n>)", or the build stops
    case "$VERSION" in ''|*[!0-9A-Za-z._-]*) echo "VERSION must be letters, digits, dot, underscore or dash, got: '$VERSION'" >&2; exit 1;; esac; \
    case "$TEMPLATE_VERSIONS" in ''|*[!0-9A-Za-z._\ =-]*) echo "TEMPLATE_VERSIONS is empty or malformed (use tdarr-flow-plugins/template-versions.sh): '$TEMPLATE_VERSIONS'" >&2; exit 1;; esac; \
    for f in /root-layer/defaults/tdarr-plugins/LocalFlowTemplates/video/*.js; do \
      b=$(basename "$f"); \
      n=$(printf '%s\n' $TEMPLATE_VERSIONS | sed -n "s/^$b=\([0-9][0-9]*\)\$/\1/p"); \
      [ -n "$n" ] || { echo "$f: no version for $b in TEMPLATE_VERSIONS" >&2; exit 1; }; \
      [ "$(grep -c '^    "name": "' "$f")" = 1 ] || { echo "$f: expected exactly one flow-level name line" >&2; exit 1; }; \
      sed -i "s/^    \"name\": \"\(.*\)\",\$/    \"name\": \"\1 (v$n)\",/" "$f"; \
      grep -qF " (v$n)\"," "$f" || { echo "$f: the version was not stamped into the flow name" >&2; exit 1; }; \
    done; \
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
      org.opencontainers.image.description="DOCKER_MODS overlay: puts fifteen Tdarr Local Flow Plugins and the flow templates into a Tdarr server's plugin folder at every start" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only"
