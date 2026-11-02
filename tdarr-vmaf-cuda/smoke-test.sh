#!/usr/bin/env bash
# What can be checked without a GPU: the overlay's files are where they should be, the binary starts on a plain Ubuntu
# 22.04 (the Tdarr node image's base) with nothing but the overlay mounted, links everything it needs, was built with
# CUDA and libvmaf, and libvmaf (CPU) scores a clip against itself.
#
#   tdarr-vmaf-cuda/smoke-test.sh <overlay image>
set -euo pipefail

image=${1:?usage: smoke-test.sh <overlay image>}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cid=$(docker create "$image" /bin/true)
docker cp "$cid:/usr/local" "$work/usr-local"
docker cp "$cid:/usr/share/doc/tdarr-vmaf-cuda" "$work/doc"
docker rm "$cid" >/dev/null

fail() { echo "FAIL: $*" >&2; exit 1; }

for f in usr-local/bin/ffmpeg-vmaf-cuda usr-local/share/model/vmaf_v0.6.1.json \
         doc/BUILD-INFO doc/COPYING.ffmpeg-GPLv3 doc/LICENSE.libvmaf doc/LICENSE.nv-codec-headers doc/EULA.cuda-toolkit.txt; do
  [ -s "$work/$f" ] || fail "missing from the image: $f"
done
[ ! -e "$work/usr-local/bin/ffmpeg" ] || fail "the overlay must not ship /usr/local/bin/ffmpeg"
[ ! -e "$work/usr-local/bin/ffprobe" ] || fail "the overlay must not ship /usr/local/bin/ffprobe"
echo "   ok   files"
cat "$work/doc/BUILD-INFO"

run() { docker run --rm -v "$work/usr-local:/usr/local:ro" ubuntu:22.04 "$@"; }

ldd_out=$(run ldd /usr/local/bin/ffmpeg-vmaf-cuda)
echo "$ldd_out"
if echo "$ldd_out" | grep -q 'not found'; then fail "ffmpeg-vmaf-cuda has unresolved libraries"; fi
echo "   ok   every library resolves on a plain ubuntu:22.04"

banner=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -version)
for flag in --enable-libvmaf --enable-cuda-nvcc --enable-ffnvcodec --enable-cuvid --enable-nvdec; do
  echo "$banner" | grep -q -- "$flag" || fail "the build is missing $flag"
done
echo "   ok   built with CUDA and libvmaf"

filters=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -filters)
for filter in libvmaf libvmaf_cuda scale_cuda; do
  echo "$filters" | grep -qw -- "$filter" || fail "filter $filter is not available"
done
echo "   ok   libvmaf, libvmaf_cuda and scale_cuda filters are there"

score=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -nostdin \
  -f lavfi -i "testsrc=size=320x240:rate=10:duration=2" -f lavfi -i "testsrc=size=320x240:rate=10:duration=2" \
  -lavfi libvmaf -f null - 2>&1 | tee /dev/stderr | sed -n 's/.*VMAF score: *//p')
case $score in
  100*|99.9*) echo "   ok   libvmaf scored a clip against itself: $score" ;;
  *) fail "libvmaf scored identical clips as '$score' (expected ~100)" ;;
esac

echo "PASS: tdarr-vmaf-cuda smoke test"
