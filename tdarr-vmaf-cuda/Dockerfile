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
RUN apt-get update && apt-get install -y --no-install-recommends \
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
         echo "FFmpeg $FFMPEG_REF ($(git -C /src/ffmpeg rev-parse HEAD))"; \
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
