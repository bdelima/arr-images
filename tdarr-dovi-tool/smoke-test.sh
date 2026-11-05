#!/usr/bin/env bash
# (ci filter probe: comment-only change)
# What can be checked without real DoVi/HDR10+ media: the overlay's files are where they should be, both binaries start
# on a plain Debian with nothing but the overlay mounted (they are static, so no library is needed), each reports the
# exact version this build pinned, and each --help lists the subcommands the DoVi/HDR flow depends on
# (extract-rpu/inject-rpu/demux/mux for dovi_tool; extract/inject for hdr10plus_tool).
#
# What this cannot check: an extract -> re-encode -> inject round trip on a real Profile 4/5/7/8 or HDR10+ file, or
# playback on a device. No sample file exists in CI; do that by hand on the Tdarr node once a flow uses the image.
#
#   tdarr-dovi-tool/smoke-test.sh <overlay image>
set -euo pipefail

image=${1:?usage: smoke-test.sh <overlay image>}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cid=$(docker create "$image" /bin/true)
docker cp "$cid:/usr/local/bin/dovi_tool" "$work/dovi_tool"
docker cp "$cid:/usr/local/bin/hdr10plus_tool" "$work/hdr10plus_tool"
docker cp "$cid:/usr/share/doc/tdarr-dovi-tool" "$work/doc"
docker rm "$cid" >/dev/null
chmod +x "$work/dovi_tool" "$work/hdr10plus_tool"

fail() { echo "FAIL: $*" >&2; exit 1; }

for f in dovi_tool hdr10plus_tool doc/BUILD-INFO doc/LICENSE.dovi_tool doc/LICENSE.hdr10plus_tool; do
  [ -s "$work/$f" ] || fail "missing from the image: $f"
done
grep -q 'MIT License' "$work/doc/LICENSE.dovi_tool" || fail "LICENSE.dovi_tool is not the MIT License"
grep -q 'MIT License' "$work/doc/LICENSE.hdr10plus_tool" || fail "LICENSE.hdr10plus_tool is not the MIT License"
echo "   ok   files"
cat "$work/doc/BUILD-INFO"

# BUILD-INFO's "<tool> <version> (...)" lines start with exactly what --version prints, so the pinned version is read
# back out of the image instead of being passed in twice and risking the two drifting apart.
dovi_expected=$(awk '/^dovi_tool /{print $1, $2; exit}' "$work/doc/BUILD-INFO")
hdr10plus_expected=$(awk '/^hdr10plus_tool /{print $1, $2; exit}' "$work/doc/BUILD-INFO")
[ -n "$dovi_expected" ] && [ -n "$hdr10plus_expected" ] || fail "could not read the pinned versions back out of BUILD-INFO"

# A plain Debian with only the two binaries mounted, on purpose: they are static, so this must work with nothing else
# present; if either needed a library, this is where it would show.
run() { docker run --rm -v "$work:/under-test:ro" debian:12-slim "/under-test/$1" "${@:2}"; }

ver=$(run dovi_tool --version)
[ "$ver" = "$dovi_expected" ] || fail "dovi_tool reports '$ver', expected '$dovi_expected'"
echo "   ok   dovi_tool runs standalone on a plain debian:12-slim: $ver"

ver=$(run hdr10plus_tool --version)
[ "$ver" = "$hdr10plus_expected" ] || fail "hdr10plus_tool reports '$ver', expected '$hdr10plus_expected'"
echo "   ok   hdr10plus_tool runs standalone on a plain debian:12-slim: $ver"

help=$(run dovi_tool --help)
for cmd in extract-rpu inject-rpu demux mux; do
  echo "$help" | grep -qw -- "$cmd" || fail "dovi_tool --help is missing the '$cmd' subcommand"
done
echo "   ok   dovi_tool has extract-rpu/inject-rpu/demux/mux"

help=$(run hdr10plus_tool --help)
for cmd in extract inject; do
  echo "$help" | grep -qw -- "$cmd" || fail "hdr10plus_tool --help is missing the '$cmd' subcommand"
done
echo "   ok   hdr10plus_tool has extract/inject"

echo "PASS: tdarr-dovi-tool smoke test"
