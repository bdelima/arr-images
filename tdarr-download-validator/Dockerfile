# syntax=docker/dockerfile:1
#
# tdarr-download-validator: the PreImportValidator service for the arr images (see the README, "Import validator").
# Standard-library Python only, so there is nothing to install. Build context: the repository root.
#
#   docker build -f tdarr-download-validator/Dockerfile --build-arg VERSION=$(cat tdarr-download-validator/VERSION) .
FROM python:3.12-slim

ARG VERSION=unknown
ARG REVISION=unknown

RUN useradd --system --no-create-home --uid 10001 validator
COPY tdarr-download-validator/validator.py /app/validator.py

USER validator
ENV PORT=8080 PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'], timeout=4)"]
CMD ["python", "/app/validator.py"]

LABEL org.opencontainers.image.title="tdarr-download-validator" \
      org.opencontainers.image.description="Tells Sonarr, Radarr and Sportarr whether Tdarr has finished with a completed download, and starts Tdarr on it" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.url="https://github.com/bdelima/arr-images" \
      org.opencontainers.image.licenses="GPL-3.0-only"
