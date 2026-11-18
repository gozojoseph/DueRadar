# DueRadar production image: one build serves the API, the built PWA, and the
# same code runs the reminder worker with a different start command.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@9.15.4
WORKDIR /app

# ---------------------------------------------------------------------------
# Build the Vite PWA. Dependencies are installed from the lockfile only.
# ---------------------------------------------------------------------------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/detection/package.json packages/detection/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/push/package.json packages/push/package.json
COPY packages/scheduling/package.json packages/scheduling/package.json
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm --filter @dueradar/web build

# ---------------------------------------------------------------------------
# Runtime: production dependencies only, TypeScript executed by tsx.
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NODE_OPTIONS=--enable-source-maps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/detection/package.json packages/detection/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/providers/package.json packages/providers/package.json
COPY packages/push/package.json packages/push/package.json
COPY packages/scheduling/package.json packages/scheduling/package.json
RUN pnpm install --prod --frozen-lockfile

COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY --from=build /app/apps/web/dist apps/web/dist

ENV SERVE_WEB=true
ENV WEB_DIST=/app/apps/web/dist

USER node
EXPOSE 10000

# Render sets PORT. The API starts migrations before listening.
CMD ["pnpm", "--filter", "@dueradar/api", "start"]
