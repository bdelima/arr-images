#!/usr/bin/env bash
# What can be checked without a GPU: the overlay's files are where they should be, the binary starts on a plain Ubuntu
# 22.04 (the Tdarr node image's base) with nothing but the overlay mounted and no NVIDIA driver, links everything it
# needs, was built with CUDA and libvmaf, and libvmaf (CPU) scores a clip against itself.
#
# Nothing is injected: a node without an NVIDIA driver has no libcuda.so.1, and the binary must start there anyway. libvmaf
# is linked against the libcuda-lazy.so shim (see the Dockerfile), which loads the real driver only when a CUDA filter
# first runs. Nothing here can run a CUDA kernel; that is checked by hand on a node with a GPU.
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

for f in usr-local/bin/ffmpeg-vmaf-cuda usr-local/share/model/vmaf_v0.6.1.json usr-local/lib/tdarr-vmaf-cuda/libcuda-lazy.so \
         doc/BUILD-INFO doc/COPYING.ffmpeg-GPLv3 doc/LICENSE.libvmaf doc/LICENSE.Implib.so doc/LICENSE.nv-codec-headers doc/EULA.cuda-toolkit.txt; do
  [ -s "$work/$f" ] || fail "missing from the image: $f"
done
[ ! -e "$work/usr-local/bin/ffmpeg" ] || fail "the overlay must not ship /usr/local/bin/ffmpeg"
[ ! -e "$work/usr-local/bin/ffprobe" ] || fail "the overlay must not ship /usr/local/bin/ffprobe"
echo "   ok   files"
cat "$work/doc/BUILD-INFO"

run() { docker run --rm -v "$work/usr-local:/usr/local:ro" ubuntu:22.04 "$@"; }

ldd_out=$(run ldd /usr/local/bin/ffmpeg-vmaf-cuda)
echo "$ldd_out"
if grep -q 'not found' <<< "$ldd_out"; then fail "ffmpeg-vmaf-cuda has unresolved libraries"; fi
# the real driver library must not be a start-up dependency (the shim, libcuda-lazy.so, is not it)
if grep -Eq 'libcuda\.so' <<< "$ldd_out"; then fail "ffmpeg-vmaf-cuda needs libcuda.so at start-up, so it would not start without an NVIDIA driver"; fi
echo "   ok   every library resolves on a plain ubuntu:22.04 with no NVIDIA driver, and libcuda.so is not needed"

# the shim stands in for libcuda: it exports the driver functions libvmaf calls, and is what libvmaf is linked to
run sh -c 'ldd /usr/local/lib/tdarr-vmaf-cuda/libvmaf.so | grep -q libcuda-lazy.so' || fail "libvmaf.so is not linked to the libcuda-lazy.so shim"
exports=$(readelf --dyn-syms -W "$work/usr-local/lib/tdarr-vmaf-cuda/libcuda-lazy.so")
for sym in cuInit cuMemAlloc_v2 cuStreamCreateWithPriority cuCtxPushCurrent; do
  grep -qw -- "$sym" <<< "$exports" || fail "the libcuda-lazy.so shim does not export $sym"
done
echo "   ok   libvmaf links the libcuda-lazy.so shim, which exports the driver functions"

banner=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -version)
for flag in --enable-libvmaf --enable-cuda-nvcc --enable-ffnvcodec --enable-cuvid --enable-nvdec; do
  grep -q -- "$flag" <<< "$banner" || fail "the build is missing $flag"
done
echo "   ok   built with CUDA and libvmaf"

filters=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -filters)
for filter in libvmaf libvmaf_cuda scale_cuda; do
  grep -qw -- "$filter" <<< "$filters" || fail "filter $filter is not available"
done
echo "   ok   libvmaf, libvmaf_cuda and scale_cuda filters are there"

score=$(run /usr/local/bin/ffmpeg-vmaf-cuda -hide_banner -nostdin \
  -f lavfi -i "testsrc=size=320x240:rate=10:duration=2" -f lavfi -i "testsrc=size=320x240:rate=10:duration=2" \
  -lavfi libvmaf -f null - 2>&1 | tee /dev/stderr | sed -n 's/.*VMAF score: *//p')
# identical clips score near 100 (a synthetic test pattern lands a little under it), a broken libvmaf or model nowhere near
if [ -n "$score" ] && awk -v s="$score" 'BEGIN { exit !(s >= 95 && s <= 100.0001) }'; then
  echo "   ok   libvmaf scored a clip against itself: $score"
else
  fail "libvmaf scored identical clips as '$score' (expected 95-100)"
fi

echo "PASS: tdarr-vmaf-cuda smoke test"
