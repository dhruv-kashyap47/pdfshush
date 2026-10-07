# PDFShush API + worker image.
#
# One image, two roles: `api` runs the HTTP service, `worker` runs the same
# bundle's worker host. That keeps the two processes provably identical -- the
# only difference is which entry point starts.
#
# Build context is the repository root (pnpm workspace), so the image can
# install from the lockfile.

# ---------------------------------------------------------------- deps stage
FROM node:24-alpine AS deps
WORKDIR /repo

RUN corepack enable

# Manifests first: this layer is cached until dependencies actually change.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/pdf-core/package.json packages/pdf-core/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --filter @pdfshush/api...

# -------------------------------------------------------------- build stage
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/pdf-core packages/pdf-core
COPY apps/api apps/api
RUN pnpm --filter @pdfshush/api build

# ------------------------------------------------------------ runtime stage
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies, plus the two pdf-core packages the API uses at
# runtime (they are bundled into dist/, but their own runtime deps must resolve).
COPY --from=build /repo /repo
RUN corepack enable && \
    cd /repo/apps/api && pnpm install --prod --frozen-lockfile --filter @pdfshush/api... && \
    cp -r /repo/apps/api/dist /app/dist && \
    cp /repo/apps/api/package.json /app/package.json

# Unprivileged user: the service never needs root, and a compromised process
# should not own the work directory.
RUN addgroup -S pdfshush && adduser -S pdfshush -G pdfshush && \
    mkdir -p /data/work && chown -R pdfshush:pdfshush /data/work /app
USER pdfshush

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]