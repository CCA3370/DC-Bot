# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS dependencies

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY tsconfig.json tsconfig.server.json tsconfig.client.json vite.config.ts ./
COPY src ./src
RUN pnpm build

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 dc-bot \
  && useradd --system --uid 10001 --gid dc-bot --home-dir /app --shell /usr/sbin/nologin dc-bot \
  && mkdir -p /app/data /app/media-cache \
  && chown -R dc-bot:dc-bot /app

COPY --from=production-dependencies --chown=dc-bot:dc-bot /app/node_modules ./node_modules
COPY --from=build --chown=dc-bot:dc-bot /app/dist ./dist
COPY --chown=dc-bot:dc-bot package.json ./

USER dc-bot
EXPOSE 8787

CMD ["node", "dist/server/index.js"]
