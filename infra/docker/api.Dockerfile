# PDFShush API + worker image.
#
# One image, two roles: `api` runs the HTTP service, `worker` runs the same
# bundle's worker host. That keeps the two processes provably identical -- the
# only difference is which entry point starts.
#
# Build context is the repository root (pnpm workspace), so the image installs
# from the committed lockfile.

# ---------------------------------------------------------------- deps stage
FROM node:24-alpine AS deps
WORKDIR /repo

# Use exactly the pnpm the repo pins, so the image can never disagree with CI.
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate

# Manifests first: this layer stays cached until dependencies actually change.
# Every workspace manifest the lockfile references must be present, even the
# ones we do not build.
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
WORKDIR /repo/apps/api
ENV NODE_ENV=production

COPY --from=build /repo /repo

# The service runs *inside* the workspace layout rather than from a stripped
# /app directory: pnpm's node_modules are symlinks into the workspace store, so
# copying just `dist/` elsewhere leaves every runtime import unresolvable.
# `--prod` keeps the image to production dependencies only.
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate && \
    pnpm config set store-dir /pnpm/store && \
    CI=true pnpm install --prod --frozen-lockfile \
      --config.confirmModulesPurge=false \
      --filter @pdfshush/api...

# Unprivileged: the service never needs root and a compromised process should
# not own the work directory.
RUN addgroup -S pdfshush && adduser -S pdfshush -G pdfshush && \
    mkdir -p /data/work && \
    chown -R pdfshush:pdfshush /data/work /repo/apps/api
USER pdfshush

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=25s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]