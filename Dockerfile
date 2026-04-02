# --- Build ARGs for gateway metadata extraction ---
ARG GATEWAY_IMAGE=ghcr.io/aquaclawai/openclaw
ARG GATEWAY_TAG=2026.3.28

# --- Edition build arg (ce = Community Edition, ee = Enterprise Edition) ---
ARG EDITION=ce

# --- Stage: Extract provider/model/channel metadata from gateway image ---
FROM ${GATEWAY_IMAGE}:${GATEWAY_TAG} AS gateway-meta
USER root
COPY scripts/extract-openclaw-metadata.mjs /tmp/extract-openclaw-metadata.mjs
RUN node /tmp/extract-openclaw-metadata.mjs --output /tmp/openclaw-metadata.json

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts

FROM deps AS build-server
ARG EDITION=ce
WORKDIR /app
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY apps/server/ apps/server/
RUN npx tsc -b packages/shared/tsconfig.json && npx tsc -b apps/server/tsconfig.json
RUN if [ "$EDITION" = "ce" ]; then rm -rf apps/server/dist/ee; fi

FROM deps AS build-web
ARG EDITION=ce
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
WORKDIR /app
COPY tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN npx tsc -b packages/shared/tsconfig.json && \
    if [ "$EDITION" = "ce" ]; then npm run build:ce -w @aquarium/web; else npm run build:ee -w @aquarium/web; fi

FROM node:22-bookworm-slim AS production
ARG EDITION=ce
ENV EDITION=$EDITION
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build-server /app/apps/server/dist apps/server/dist
COPY --from=build-server /app/packages/shared/dist packages/shared/dist
COPY --from=build-web /app/apps/web/dist apps/web/dist
COPY --from=gateway-meta /tmp/openclaw-metadata.json apps/server/data/openclaw-metadata.json

RUN if [ "$EDITION" = "ce" ]; then rm -rf apps/web/dist/ee 2>/dev/null; fi
RUN if [ "$EDITION" = "ce" ]; then rm -rf apps/server/dist/ee 2>/dev/null; fi

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "if [ \"$EDITION\" = 'ce' ]; then exec node apps/server/dist/index.ce.js; else exec node apps/server/dist/index.js; fi"]
