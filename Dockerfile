# VERITAS: API + dashboard + every analyzer in one image, served on one port.
# Built for Hugging Face Spaces (port 7860, runs as uid 1000) but runs anywhere:
#   docker build -t veritas . && docker run -p 7860:7860 --env-file .env -e VERITAS_PASSWORD=... veritas
# Secrets (DATABASE_URL, VERITAS_PASSWORD) come from the environment at run time, never the image.

FROM oven/bun:1.4.2 AS bun

# ---- build: dependencies and the production dashboard build ----
FROM node:24.11.1-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json tsconfig.json veritas.config.ts ./
COPY shared shared
COPY backend backend
COPY frontend frontend
# The dashboard calls the API on its own origin.
ENV NEXT_PUBLIC_VERITAS_API=/ NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd frontend build

# ---- runtime ----
FROM node:24.11.1-bookworm-slim
ARG TARGETARCH
ARG GITLEAKS_VERSION=8.30.1
ARG OSV_SCANNER_VERSION=2.7.1
ARG SEMGREP_VERSION=1.185.0
ARG RUFF_VERSION=0.17.4

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git python3 python3-venv \
 && rm -rf /var/lib/apt/lists/*

# Python tools in their own virtualenv, pinned to the versions VERITAS is tested with.
RUN python3 -m venv /opt/tools \
 && /opt/tools/bin/pip install --no-cache-dir "semgrep==${SEMGREP_VERSION}" "ruff==${RUFF_VERSION}"

# Single-binary tools from their GitHub releases, checked against pinned SHA-256 sums.
RUN set -eu; \
  case "${TARGETARCH:-amd64}" in \
    amd64) gl_arch=x64;   gl_sum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb; \
           osv_sum=fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8 ;; \
    arm64) gl_arch=arm64; gl_sum=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080; \
           osv_sum=983d22fbad9724514e3fcc6acc83b5fa64c5ffa6b0d9f510028f22c1b223ff81 ;; \
    *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/gitleaks.tgz \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz"; \
  echo "${gl_sum}  /tmp/gitleaks.tgz" | sha256sum -c -; \
  tar -xzf /tmp/gitleaks.tgz -C /usr/local/bin gitleaks; \
  curl -fsSL -o /usr/local/bin/osv-scanner \
    "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${TARGETARCH:-amd64}"; \
  echo "${osv_sum}  /usr/local/bin/osv-scanner" | sha256sum -c -; \
  chmod +x /usr/local/bin/osv-scanner; \
  rm /tmp/gitleaks.tgz

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV PATH="/opt/tools/bin:${PATH}"

# Hugging Face runs the container as uid 1000: the "node" user of this base image.
USER node
WORKDIR /home/node/app
COPY --from=build --chown=node:node /app ./
COPY --chown=node:node deploy/start.sh ./deploy/start.sh
RUN mkdir -p code .veritas

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7860 \
    VERITAS_CONFIG_DIR=/home/node/app \
    VERITAS_WEB_UPSTREAM=http://127.0.0.1:3000 \
    SEMGREP_SEND_METRICS=off
EXPOSE 7860
CMD ["bash", "deploy/start.sh"]
