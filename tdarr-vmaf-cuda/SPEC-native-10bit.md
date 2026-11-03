# tdarr-vmaf-cuda: native yuv420p10le CUDA VMAF scoring

Status: **merged and shipped, tdarr-vmaf-cuda 0.1.1 ([PR #16](https://github.com/bdelima/arr-images/pull/16), 2026-11-03).** Verified by actually running the patch script against the real pinned source and diffing the result -- twice: the original 3-file draft, then again after the code-review finding below added a 4th file -- and by CI's real FFmpeg/nvcc compile (the `vmaf-cuda` job), which is green. **Not yet verified:** real VMAF-score correctness on an actual 10-bit/HDR file on the GPU -- CI has no GPU, so a green run confirms the build compiles, not that it scores correctly at runtime. See the test plan below before relying on scores from this path.

## Problem

The Validator flow's CUDA VMAF step currently forces both inputs to 8-bit
`yuv420p` before scoring (`scale_cuda=format=yuv420p`), even when the
original source is 10-bit/HDR. That means every HDR/Dolby Vision file that
reaches this step today is scored at reduced precision relative to its
real bit depth.

## What's actually possible on CUDA, and why "10-bit" isn't free

FFmpeg's `libvmaf_cuda` filter (`libavfilter/vf_libvmaf.c`) hard-gates its
input to exactly two pixel formats via `format_is_supported()`:

```c
static const enum AVPixelFormat supported_formats[] = {
    AV_PIX_FMT_YUV420P,
    AV_PIX_FMT_YUV444P16,
};
```

Upstream has never wired in a 10-bit option. The two existing choices are
8-bit 4:2:0 (today) or 16-bit 4:4:4 (no code change required, but forces a
4:2:0->4:4:4 chroma upsample as a side effect -- roughly 4x the bytes/pixel
of the 8-bit path, vs. ~2x for genuine 10-bit 4:2:0).

**libvmaf's own CUDA kernels do not need any change.** Checked at the
pinned `v3.0.0` tag: `motion_score.cu`, `integer_vif_cuda.c`, and
`integer_adm_cuda.c` all dispatch only on "bpc == 8" vs. a generic
not-8-bit path that takes the real `bpc` value and derives its shift math
from it directly (e.g. `shift_var_y = src.bpc;` in `motion_score.cu`).
10-bit was never excluded there.

**The real gap is in `scale_cuda`, not `libvmaf_cuda`.** NVDEC decodes
10-bit HEVC to `p010le` -- semiplanar (one Y plane, one interleaved UV
plane). `libvmaf_cuda`'s `VmafPicture` layout is always fully planar, so
something has to convert between the two before scoring. That conversion
is `scale_cuda`'s job, and `scale_cuda` has its own, separate allowlist
(`libavfilter/vf_scale_cuda.c`) with no 10-bit planar entry at all --
only `P010`/`P016` (semiplanar) and `YUV420P`/`YUV444P`/`YUV444P16`
(planar). `vf_scale_cuda.cu`'s kernels are 36 hand-written per-format-pair
structs, not a generic template, so the missing `p010le -> yuv420p10le`
pair has to be added as a new struct, not a flag.

## The bit-layout trap

`libavutil/pixfmt.h`'s own doc comments:

```c
AV_PIX_FMT_P010LE,      ///< like NV12, with 10bpp per component, data in the high bits, zeros in the low bits, little-endian
AV_PIX_FMT_YUV420P10LE, ///< planar YUV 4:2:0, 15bpp, (1 Cr & Cb sample per 2x2 Y samples), little-endian
```

Only `P010LE` carries the "high bits, zeros in the low bits" qualifier --
its 10-bit sample is **left**-justified in a 16-bit word. `YUV420P10LE`
carries no such qualifier, meaning FFmpeg's unqualified default: the
sample is **right**-justified in the low 10 bits. These are different
layouts for nominally the same depth. The existing `conv_10to16` helper in
`vf_scale_cuda.cu` targets the *other* (left-justified) conversion
(`P010LE -> P016LE`/`YUV444P16LE`) -- reusing it here would compile, run,
and silently produce wrong (left-shifted) pixel values rather than an
error. The correct operation is a plain `>> 6`.

## The patch

Four files (the fourth, `libavutil/hwcontext_cuda.c`, was added in code review -- see
"Code review finding" below), pinned refs unchanged (`FFMPEG_REF=n7.1`, `VMAF_REF=v3.0.0`,
no version bump required on either):

1. **`libavfilter/vf_libvmaf.c`** -- add `AV_PIX_FMT_YUV420P10LE` to the
   2-entry `supported_formats[]` allowlist.
2. **`libavfilter/vf_scale_cuda.c`** -- add `AV_PIX_FMT_YUV420P10LE` to its
   own `supported_formats[]` allowlist.
3. **`libavfilter/vf_scale_cuda.cu`** -- add one new
   `Convert_p010le_yuv420p10le` struct, modeled directly on the existing
   `Convert_p010le_yuv444p16le` (same input types, same `SUB_F` calls),
   but using `>> 6` instead of `conv_10to16` and writing 3 separate planar
   outputs instead of one interleaved pair; plus one
   `BICUBIC_KERNEL_RAW(p010le_yuv420p10le)` invocation line, placed right
   after the existing `BICUBIC_KERNELS(yuv444p16le)` line.

   Traced the macro chain by hand to confirm `BICUBIC_KERNEL_RAW(C)` is
   self-sufficient: it token-pastes directly against `Convert_##C`, with
   no separate registry, counter, or switch statement anywhere else that
   needs updating. `vf_scale_cuda.c`'s `cudascale_load_functions` builds
   the runtime lookup string as `"Subsample_%s_%s_%s"` with
   (`interp`, `in_fmt_name`, `out_fmt_name`) -- confirmed to match the
   macro's token-pasted symbol name exactly.

   Implemented in the Dockerfile as a `python3` heredoc `RUN` step,
   inserted between the existing `git -C ffmpeg checkout "$FFMPEG_REF"`
   step and the `./configure` step. Each of the three edits does an exact
   string replace with an `assert count == 1` guard, so if a future
   `FFMPEG_REF` bump changes the surrounding code, the build fails loudly
   at that `RUN` step instead of silently reverting to the old 2-entry
   gate or applying somewhere unintended.

## What's verified vs. not

**Verified** (by running the actual patch script, unmodified, against the
real `n7.1`-tagged source of all three files and diffing the result):
- All three string-replace anchors are unique and match exactly once in
  the real pinned source.
- The resulting diffs are minimal and land exactly where intended (one
  allowlist line each, one new struct placed immediately after its model
  struct, one kernel-invocation line placed immediately after the
  existing bicubic block for `yuv444p16le`).
- Brace balance and symbol uniqueness sanity checks pass on the patched
  file (152 open / 152 close braces; `Convert_p010le_yuv420p10le` appears
  exactly once).
- CI's `vmaf-cuda` job (the real FFmpeg/nvcc compile, all four patched files) is green on the merged `main`.

**Not verified** (no GPU in CI or in the sandbox that designed this):
- That the generated `Subsample_Bicubic_p010le_yuv420p10le` /
  `..._uv` kernels produce correct pixel values at runtime (the bit-shift
  direction is grounded in FFmpeg's own documentation, not just inferred).
- That `vmaf_v0.6.1` VMAF scores on this path are sane/comparable to the
  existing 8-bit scores on the same content.
- Real throughput on the RTX 2060 Super. Expected roughly 2x today's
  8-bit cost (no chroma upsample, just wider samples), vs. the ~4x cost of
  the already-available 16-bit/4:4:4 path -- not benchmarked.

## Test plan once built

Build normally (`docker build -f tdarr-vmaf-cuda/Dockerfile ...`), then on
a GPU host, against a **genuine 10-bit/HDR source file** (the new kernel
only accepts `p010le` input -- an 8-bit H.264 test file won't exercise it
at all):

```
ffmpeg-vmaf-cuda -hwaccel cuda -hwaccel_output_format cuda -i "$FILE" \
                  -hwaccel cuda -hwaccel_output_format cuda -i "$FILE" \
  -an -filter_complex \
  "[0:v]scale_cuda=format=yuv420p10le[ref];[1:v]scale_cuda=format=yuv420p10le[dist];[dist][ref]libvmaf_cuda" \
  -f null -
```

Compare the resulting VMAF score for a self-comparison (expect ~100,
same as the existing 8-bit self-comparison test) and, ideally, against a
known-good CPU `libvmaf` run on the same 10-bit file to sanity-check the
GPU path isn't silently scoring something subtly wrong.

## Open decisions for whoever ships this

- Whether to adopt this at all, given the already-working, zero-code-change
  16-bit/4:4:4 alternative exists today (just a `scale_cuda=format=...`
  change, no rebuild) -- this patch buys roughly 2x instead of 4x the
  8-bit cost, at the price of maintaining a source patch against FFmpeg
  that needs re-verifying on every future `FFMPEG_REF` bump. **Resolved by merging PR #16:** adopted.
- Whether to extend the same patch to the other interpolation modes
  (`NEAREST_KERNEL_RAW`/`BILINEAR_KERNEL_RAW`/`LANCZOS_KERNEL_RAW`) -- not
  done here, since the existing VMAF script only ever uses `scale_cuda`'s
  default (Bicubic) mode. Still open.

## Code review finding: the CUDA hwframes allowlist

Reading the FFmpeg n7.1 source (not only the three files above) found a third allowlist: `libavutil/hwcontext_cuda.c`
`supported_formats[]`, checked by `cuda_frames_init()`. `scale_cuda` allocates its output as a CUDA hwframes context
with `sw_format = yuv420p10le`; without the entry, `av_hwframe_ctx_init` fails with "Pixel format 'yuv420p10le' is not
supported" (ENOSYS) and the filter graph never starts. The three-file patch would have compiled and then failed on the
first real run. The Dockerfile patch now adds the entry (one line; the YUV420P special alignment case there is for
nvenc and does not apply to yuv420p10le). Still compile-only verified: no GPU in CI.

Also confirmed in review: the patch covers only `scale_cuda`'s default bicubic mode, so `interp_algo=nearest|bilinear|
lanczos` with `format=yuv420p10le` fails with "Unsupported conversion" (see the open decisions below).
