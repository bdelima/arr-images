# syntax=docker/dockerfile:1
#
# tdarr-vmaf-cuda: a DOCKER_MODS overlay for a Tdarr node (see the README, "tdarr-vmaf-cuda"). It adds an ffmpeg built
# with CUDA and libvmaf as /usr/local/bin/ffmpeg-vmaf-cuda, next to (not instead of) the ffmpeg Tdarr ships.
# Build context: the repository root.
#
#   docker build -f tdarr-vmaf-cuda/Dockerfile --build-arg VERSION=$(cat tdarr-vmaf-cuda/VERSION) .
#
# Everything the overlay installs is under /usr/local (the binary and a private library directory) and
# /usr/share/doc/tdarr-vmaf-cuda, so it cannot replace anything the Tdarr image already has.

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS buildstage

# Pinned so a build is reproducible, and so the corresponding source of what is published is exactly these revisions.
ARG VMAF_REF=v3.0.0
ARG NV_CODEC_HEADERS_REF=n12.2.72.0
ARG FFMPEG_REF=n7.1
# The GPU generation to compile for: 75 is Turing (RTX 2060 Super). One value, compute capability without the dot.
ARG CUDA_ARCH=75

ENV DEBIAN_FRONTEND=noninteractive
# The build tools come from an Ubuntu mirror that GitHub's runners reach reliably (the same one the runners use for
# themselves). On 2026-11-11 archive.ubuntu.com and security.ubuntu.com stopped resolving from the runners' build
# containers for hours, which failed this stage ("Unable to locate package"). Nothing from this stage is shipped (the final
# image is built FROM scratch), so the choice of mirror does not change the published image. Override with
# --build-arg APT_MIRROR=http://archive.ubuntu.com/ubuntu to use the default archive.
ARG APT_MIRROR=http://azure.archive.ubuntu.com/ubuntu
RUN sed -i -e "s|http://archive.ubuntu.com/ubuntu|${APT_MIRROR}|g" -e "s|http://security.ubuntu.com/ubuntu|${APT_MIRROR}|g" /etc/apt/sources.list \
    && grep -q "${APT_MIRROR}" /etc/apt/sources.list \
    && apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates git nasm ninja-build patchelf pkg-config python3-pip xxd \
    && pip3 install --no-cache-dir meson cmake \
    && rm -rf /var/lib/apt/lists/*

ENV PATH=/usr/local/cuda/bin:$PATH
WORKDIR /src

# libvmaf's CUDA code calls the driver API through libcuda.so.1 (a normal DT_NEEDED, not dlopen), which only exists on a
# GPU host (nvidia-container-toolkit injects it). To link against it here, the devel image's stub library is given the
# soname the linker looks for.
RUN mkdir /opt/cuda-stubs && ln -s /usr/local/cuda/lib64/stubs/libcuda.so /opt/cuda-stubs/libcuda.so.1

# nv-codec-headers: the CUDA driver API loader. libvmaf's CUDA code and ffmpeg both build against it.
RUN git clone https://github.com/FFmpeg/nv-codec-headers.git \
    && git -C nv-codec-headers checkout "$NV_CODEC_HEADERS_REF" \
    && make -C nv-codec-headers install \
    && make -C nv-codec-headers DESTDIR=/root-layer install

# libvmaf, with CUDA. Installed into /usr/local/lib/tdarr-vmaf-cuda (its own directory) in the build, and the same into
# the layer; headers, pkg-config files and the command line tool are left out of the layer.
RUN git clone https://github.com/Netflix/vmaf.git \
    && git -C vmaf checkout "$VMAF_REF" \
    && cd vmaf/libvmaf \
    && meson setup build --prefix=/usr/local --libdir=lib/tdarr-vmaf-cuda --buildtype=release \
         --default-library=shared -Denable_cuda=true -Denable_tests=false -Dbuilt_in_models=true \
    && ninja -C build install \
    && DESTDIR=/root-layer ninja -C build install \
    && mkdir -p /root-layer/usr/local/share/model \
    && cp /src/vmaf/model/vmaf_v0.6.1.json /root-layer/usr/local/share/model/

# ffmpeg. Decoding and scoring only needs the CUDA filters (scale_cuda and friends), NVDEC and libvmaf; libnpp, x264,
# x265 and the rest are left out on purpose, so the overlay carries almost no third-party runtime libraries.
RUN git clone https://github.com/FFmpeg/FFmpeg.git ffmpeg \
    && git -C ffmpeg checkout "$FFMPEG_REF"

# Local patch, not upstream FFmpeg/libvmaf: native yuv420p10le (planar 10-bit 4:2:0) support for libvmaf_cuda scoring.
# Upstream's CUDA VMAF filter only accepts 8-bit yuv420p or 16-bit yuv444p16 (which forces a 4:2:0->4:4:4 chroma
# upsample -- ~4x the bytes/pixel of the 8-bit path, vs. ~2x for this). This widens two format allowlists by one
# entry each and adds the one conversion kernel scale_cuda needs to produce yuv420p10le from NVDEC's native p010le
# output. See tdarr-vmaf-cuda/SPEC-native-10bit.md for the full writeup, including why a plain ">> 6" (not the
# existing conv_10to16 helper) is the correct bit-shift -- P010LE and YUV420P10LE use different bit justification
# for the same 10-bit value, confirmed from libavutil/pixfmt.h's own doc comments.
RUN cd /src/ffmpeg && python3 - <<'PYEOF'
import pathlib

p = pathlib.Path("libavfilter/vf_libvmaf.c")
s = p.read_text()
old = "static const enum AVPixelFormat supported_formats[] = {\n    AV_PIX_FMT_YUV420P,\n    AV_PIX_FMT_YUV444P16,\n};"
new = "static const enum AVPixelFormat supported_formats[] = {\n    AV_PIX_FMT_YUV420P,\n    AV_PIX_FMT_YUV420P10LE,\n    AV_PIX_FMT_YUV444P16,\n};"
assert s.count(old) == 1, "vf_libvmaf.c: anchor not found or not unique -- FFMPEG_REF probably moved, update this patch"
p.write_text(s.replace(old, new))

p = pathlib.Path("libavfilter/vf_scale_cuda.c")
s = p.read_text()
old = "    AV_PIX_FMT_YUV444P16,\n    AV_PIX_FMT_0RGB32,"
new = "    AV_PIX_FMT_YUV444P16,\n    AV_PIX_FMT_YUV420P10LE,\n    AV_PIX_FMT_0RGB32,"
assert s.count(old) == 1, "vf_scale_cuda.c: anchor not found or not unique -- FFMPEG_REF probably moved, update this patch"
p.write_text(s.replace(old, new))

# The CUDA hwframes context has its own allowlist: without this, scale_cuda's output frames for yuv420p10le fail at
# runtime ("Pixel format 'yuv420p10le' is not supported"). Only YUV420P needs special alignment handling there (for
# nvenc), so nothing else in that file changes.
p = pathlib.Path("libavutil/hwcontext_cuda.c")
s = p.read_text()
old = "    AV_PIX_FMT_YUV444P16,\n    AV_PIX_FMT_0RGB32,"
new = "    AV_PIX_FMT_YUV444P16,\n    AV_PIX_FMT_YUV420P10LE,\n    AV_PIX_FMT_0RGB32,"
assert s.count(old) == 1, "hwcontext_cuda.c: anchor not found or not unique -- FFMPEG_REF probably moved, update this patch"
p.write_text(s.replace(old, new))

p = pathlib.Path("libavfilter/vf_scale_cuda.cu")
s = p.read_text()

struct_anchor = '''struct Convert_p010le_yuv444p16le
{
    static const int in_bit_depth = 10;
    typedef ushort in_T;
    typedef ushort2 in_T_uv;
    typedef ushort out_T;
    typedef ushort out_T_uv;

    DEF_F(Convert, out_T)
    {
        DEFAULT_DST(0) = conv_10to16(SUB_F(y, 0));
    }

    DEF_F(Convert_uv, out_T_uv)
    {
        in_T_uv res = SUB_F(uv, 1);
        DEFAULT_DST(1) = conv_10to16(res.x);
        DEFAULT_DST(2) = conv_10to16(res.y);
    }
};'''
assert s.count(struct_anchor) == 1, "vf_scale_cuda.cu: Convert_p010le_yuv444p16le anchor not found or not unique -- FFMPEG_REF probably moved, update this patch"

new_struct = '''

// Added locally: p010le -> yuv420p10le. P010LE stores its 10-bit sample
// left-justified in the high bits of a 16-bit word (zeros in the low 6
// bits); YUV420P10LE stores it right-justified in the low 10 bits. A plain
// ">> 6" is the correct conversion -- NOT conv_10to16, which targets the
// different (left-justified) P016LE/YUV444P16LE convention.
struct Convert_p010le_yuv420p10le
{
    static const int in_bit_depth = 10;
    typedef ushort in_T;
    typedef ushort2 in_T_uv;
    typedef ushort out_T;
    typedef ushort out_T_uv;

    DEF_F(Convert, out_T)
    {
        DEFAULT_DST(0) = SUB_F(y, 0) >> 6;
    }

    DEF_F(Convert_uv, out_T_uv)
    {
        in_T_uv res = SUB_F(uv, 1);
        DEFAULT_DST(1) = res.x >> 6;
        DEFAULT_DST(2) = res.y >> 6;
    }
};'''
s = s.replace(struct_anchor, struct_anchor + new_struct)

kernel_anchor = "BICUBIC_KERNELS(yuv444p16le)"
assert s.count(kernel_anchor) == 1, "vf_scale_cuda.cu: BICUBIC_KERNELS(yuv444p16le) anchor not found or not unique -- FFMPEG_REF probably moved, update this patch"
s = s.replace(kernel_anchor, kernel_anchor + "\nBICUBIC_KERNEL_RAW(p010le_yuv420p10le)")

p.write_text(s)
print("Patched vf_libvmaf.c, vf_scale_cuda.c, vf_scale_cuda.cu, hwcontext_cuda.c for native yuv420p10le CUDA VMAF scoring.")
PYEOF

# On a configure failure the log is printed, so a broken build can be diagnosed from the CI output alone.
RUN cd /src/ffmpeg \
    && { PKG_CONFIG_PATH=/usr/local/lib/tdarr-vmaf-cuda/pkgconfig ./configure \
           --prefix=/usr/local \
           --enable-gpl --enable-nonfree \
           --enable-ffnvcodec --enable-cuda-nvcc --enable-cuvid --enable-nvdec --enable-nvenc \
           --enable-libvmaf \
           --nvccflags="-gencode arch=compute_${CUDA_ARCH},code=sm_${CUDA_ARCH} -O2" \
           --extra-cflags="-I/usr/local/cuda/include" \
           --extra-ldflags="-L/usr/local/cuda/lib64 -L/usr/local/lib/tdarr-vmaf-cuda -Wl,-rpath-link,/opt/cuda-stubs" \
           --disable-doc --disable-ffplay --disable-ffprobe \
         || { tail -n 60 ffbuild/config.log; exit 1; }; }
RUN cd /src/ffmpeg \
    && make -j"$(nproc)" \
    && make DESTDIR=/root-layer install

# Only the binary, under a name no Tdarr plugin calls.
RUN mv /root-layer/usr/local/bin/ffmpeg /root-layer/usr/local/bin/ffmpeg-vmaf-cuda \
    && rm -rf /root-layer/usr/local/include /root-layer/usr/local/share/ffmpeg /root-layer/usr/local/share/man \
              /root-layer/usr/local/lib/tdarr-vmaf-cuda/pkgconfig /root-layer/usr/local/lib/tdarr-vmaf-cuda/*.a \
              /root-layer/usr/local/lib/pkgconfig /root-layer/usr/local/lib/libav* /root-layer/usr/local/lib/libsw* \
              /root-layer/usr/local/bin/vmaf \
    && find /root-layer/usr/local -mindepth 1 -maxdepth 1 -type d -empty -delete

# Whatever else the binary needs (CUDA runtime libraries and the like) goes next to libvmaf, with an RPATH to it.
COPY tdarr-vmaf-cuda/collect-libs.sh /usr/local/bin/collect-libs.sh
RUN LD_LIBRARY_PATH=/root-layer/usr/local/lib/tdarr-vmaf-cuda \
    sh /usr/local/bin/collect-libs.sh /root-layer usr/local/lib/tdarr-vmaf-cuda /root-layer/usr/local/bin/ffmpeg-vmaf-cuda

# Licences and the exact revisions built, shipped with the binaries (the build is GPL: ffmpeg with --enable-gpl).
ARG VERSION=unknown
ARG REVISION=unknown
RUN doc=/root-layer/usr/share/doc/tdarr-vmaf-cuda && mkdir -p "$doc" \
    && cp /src/ffmpeg/COPYING.GPLv3 "$doc/COPYING.ffmpeg-GPLv3" \
    && cp /src/vmaf/LICENSE "$doc/LICENSE.libvmaf" \
    && { lic=$(find /src/nv-codec-headers -maxdepth 1 \( -iname 'LICENSE*' -o -iname 'COPYING*' \) | head -n 1); \
         if [ -n "$lic" ]; then cp "$lic" "$doc/LICENSE.nv-codec-headers"; \
         else sed -n '1,/\*\//p' /src/nv-codec-headers/include/ffnvcodec/dynlink_loader.h > "$doc/LICENSE.nv-codec-headers"; fi; } \
    && { eula=$(find /usr/local/cuda/ -maxdepth 2 -iname 'EULA*' | head -n 1); \
         if [ -n "$eula" ]; then cp "$eula" "$doc/EULA.cuda-toolkit.txt"; \
         else echo "NVIDIA CUDA Toolkit EULA: https://docs.nvidia.com/cuda/eula/" > "$doc/EULA.cuda-toolkit.txt"; fi; } \
    && { echo "tdarr-vmaf-cuda $VERSION (source: https://github.com/bdelima/arr-images, revision $REVISION)"; \
         echo "libvmaf $VMAF_REF ($(git -C /src/vmaf rev-parse HEAD))"; \
         echo "nv-codec-headers $NV_CODEC_HEADERS_REF ($(git -C /src/nv-codec-headers rev-parse HEAD))"; \
         echo "FFmpeg $FFMPEG_REF ($(git -C /src/ffmpeg rev-parse HEAD)) + local patch: native yuv420p10le CUDA VMAF scoring (see SPEC-native-10bit.md)"; \
         echo "CUDA architecture sm_$CUDA_ARCH; base image nvidia/cuda:12.4.1-devel-ubuntu22.04"; } > "$doc/BUILD-INFO"

# The devel image's libcuda stub, for the CI smoke test only (a plain Ubuntu has no libcuda.so.1, and the binary will not
# start without one). Never part of the overlay: `docker build --target cuda-stub --output type=local,dest=<dir> .`
FROM scratch AS cuda-stub
COPY --from=buildstage /opt/cuda-stubs/libcuda.so.1 /libcuda.so.1

FROM scratch
ARG VERSION=unknown
ARG REVISION=unknown
COPY --from=buildstage /root-layer/ /

LABEL org.opencontainers.image.title="tdarr-vmaf-cuda" \
      org.opencontainers.image.description="DOCKER_MODS overlay: adds a CUDA + libvmaf ffmpeg build to a Tdarr node for VMAF quality scoring" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
