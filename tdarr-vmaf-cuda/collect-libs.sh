#!/bin/sh
# Copies the shared libraries the overlay's binaries need (other than the base system's and the NVIDIA driver's) into
# the overlay's private library directory, and points every binary and library there with an RPATH, so nothing
# depends on LD_LIBRARY_PATH or on what the Tdarr node image happens to ship.
#
#   collect-libs.sh <layer root> <private lib dir, relative to the layer root> <binary>...
set -eu

layer=$1
libdir=$2
shift 2

dest=$layer/$libdir
mkdir -p "$dest"

# provided by the Tdarr node image's Ubuntu base, or injected by nvidia-container-toolkit from the host driver
skip='/(ld-linux|libc|libm|libdl|libpthread|librt|libutil|libresolv|libgcc_s|libstdc\+\+|libz)\.so|/libcuda\.so|/libnvidia-|/libnvcuvid\.so'

LD_LIBRARY_PATH=$dest
export LD_LIBRARY_PATH

for bin in "$@"; do
  ldd "$bin" | awk '/=> \// { print $3 }' | grep -Ev "$skip" | while read -r lib; do
    case $lib in
      "$dest"/*) ;;
      *) cp -L "$lib" "$dest"/ ;;
    esac
  done
done

# the libraries just copied may need others (and so on, until nothing new turns up)
for _ in 1 2 3 4; do
  for lib in "$dest"/*.so*; do
    ldd "$lib" | awk '/=> \// { print $3 }' | grep -Ev "$skip" | while read -r dep; do
      case $dep in
        "$dest"/*) ;;
        *) cp -L "$dep" "$dest"/ ;;
      esac
    done
  done
done

for f in "$@" "$dest"/*.so*; do
  patchelf --set-rpath "/$libdir" "$f"
done
