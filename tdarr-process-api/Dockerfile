# syntax=docker/dockerfile:1
#
# tdarr-process-api: a blocking "process this file and tell me when it is done" service on top of Tdarr (see the README,
# "Process API"). Standard-library Python only, so there is nothing to install. Build context: the repository root.
#
#   docker build -f tdarr-process-api/Dockerfile --build-arg VERSION=$(cat tdarr-process-api/VERSION) .
FROM python:3.12-slim

ARG VERSION=unknown
ARG REVISION=unknown

RUN useradd --system --no-create-home --uid 10001 processapi
COPY tdarr-process-api/process_api.py /app/process_api.py

USER processapi
# the version is baked into the environment so that /health can report it
ENV PORT=8080 PYTHONUNBUFFERED=1 TDARR_PROCESS_API_VERSION=${VERSION}
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'], timeout=4)"]
CMD ["python", "/app/process_api.py"]

LABEL org.opencontainers.image.title="tdarr-process-api" \
      org.opencontainers.image.description="Blocking process-and-wait API for Tdarr: send one file path, get ok or error when Tdarr has finished with it" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only"
