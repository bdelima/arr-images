#!/usr/bin/env bash
# Resolve what to build for one app: the newest stable upstream release, and the exact LinuxServer.io build of it.
#
#   scripts/resolve-upstream.sh radarr|sonarr|lidarr
#
# Prints key=value lines (appended to $GITHUB_OUTPUT when that is set):
#   status        ok | no-base   (no-base: LinuxServer has not built this upstream version yet; nothing to do)
#   upstream_tag  e.g. v6.4.4.10685
#   version       e.g. 6.4.4.10685
#   base_tag      e.g. 6.4.4.10685-ls323   (the exact LinuxServer build, pinned)
#
# Needs: gh (authenticated via GH_TOKEN), docker.
set -euo pipefail

app="${1:?usage: resolve-upstream.sh radarr|sonarr|lidarr}"
case "$app" in
  radarr) upstream="Radarr/Radarr" ;;
  sonarr) upstream="Sonarr/Sonarr" ;;
  lidarr) upstream="Lidarr/Lidarr" ;;
  *) echo "unknown app: $app" >&2; exit 2 ;;
esac

# releases/latest = newest published release that is neither a draft nor a pre-release.
tag="$(gh api "repos/${upstream}/releases/latest" --jq .tag_name)"
version="${tag#v}"
[[ "$version" =~ ^[0-9]+(\.[0-9]+){2,3}$ ]] || { echo "unexpected upstream tag: $tag" >&2; exit 1; }

out() { echo "$1=$2"; [ -z "${GITHUB_OUTPUT:-}" ] || echo "$1=$2" >> "$GITHUB_OUTPUT"; }
out upstream_tag "$tag"
out version "$version"

# LinuxServer publishes version-<version> as a moving tag and <version>-ls<N> as the immutable build. Read which build
# <version> currently is, so what we overlay (and what we tag) is exact.
image="lscr.io/linuxserver/${app}:version-${version}"
if ! docker pull --quiet "$image" >/dev/null 2>&1; then
  echo "LinuxServer has no ${app}:version-${version} image yet" >&2
  out status no-base
  exit 0
fi

base="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$image")"
if [[ ! "$base" =~ ^${version//./\\.}-ls[0-9]+$ ]]; then
  # Older builds only carry the "build_version" label: "Linuxserver.io version:- 6.4.4.10685-ls323 Build-date:- ..."
  base="$(docker image inspect --format '{{ index .Config.Labels "build_version" }}' "$image" | sed -n 's/.*version:- *\([^ ]*\).*/\1/p')"
fi
[[ "$base" =~ ^${version//./\\.}-ls[0-9]+$ ]] || { echo "could not read the -lsN build of $image (got: '$base')" >&2; exit 1; }

out base_tag "$base"
out status ok
