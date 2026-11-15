#!/bin/sh
# Contributed by Defender; may be used under the arr-images repo licence.
#
# xxd shim for the libvmaf build stage (install as /usr/local/bin/xxd, earlier in PATH than /usr/bin/xxd).
# libvmaf v3.0.0 embeds each nvcc --ptx output with `xxd --include`, which writes the array WITHOUT a terminating NUL, but
# cuModuleLoadData() needs a NUL-terminated PTX string. It only works when the byte after the array is 0; the compiler pads arrays to
# 32 bytes, so it breaks when the PTX length is an exact multiple of 32 (adm_dwt2.ptx: 57,443 bytes with nvcc 12.4.1 = fine,
# 57,376 bytes with nvcc 12.8.1 = 32 x 1793 -> CUDA_ERROR_INVALID_PTX "ptxas fatal: Unexpected non-ASCII character ... line 1723").
# For `xxd --include <x>.ptx <out>` this runs the real xxd and appends ",0x00" to the array (the _len variable is unchanged), failing if
# that did not happen. Everything else goes to the real xxd unchanged. (Ubuntu 22.04 xxd has no -n, hence the sed on the output.)
if [ "$1" = "--include" ] && [ "$#" -eq 3 ]; then
  case "$2" in
    *.ptx)
      /usr/bin/xxd --include "$2" "$3" || exit $?
      sed -i '0,/^};$/s//  ,0x00\n};/' "$3"
      grep -q '^  ,0x00$' "$3" || { echo "xxd shim: could not append the terminating NUL to $3" >&2; exit 1; }
      exit 0
      ;;
  esac
fi
exec /usr/bin/xxd "$@"
