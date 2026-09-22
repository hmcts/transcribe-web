# syntax=docker/dockerfile:1.7
# REGISTRY_NAME is supplied by the CNP pipeline (az acr build --build-arg);
# the default lets the image build locally and on a developer machine.
ARG REGISTRY_NAME=hmctsprod
FROM ${REGISTRY_NAME}.azurecr.io/base/node:24-alpine AS base

# The HMCTS base image drops to the unprivileged `hmcts` user. corepack, apk
# and the chown/adduser steps below all need root; the final stage drops back
# to an unprivileged user before the app runs.
USER root

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager.
# The cache mount preserves pnpm's content-addressable store across
# builds, so re-installs only re-fetch packages that genuinely changed
# in the lockfile rather than the whole graph.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Declare build arguments
ARG NEXT_PUBLIC_API_URL
ARG ENVIRONMENT
ARG NEXT_PUBLIC_POSTHOG_API_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_MAX_RECORDING_MINUTES=115
ARG VERSION=dev

# Set environment variables from build args
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV ENVIRONMENT=$ENVIRONMENT
ENV NEXT_PUBLIC_POSTHOG_API_KEY=$NEXT_PUBLIC_POSTHOG_API_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_MAX_RECORDING_MINUTES=$NEXT_PUBLIC_MAX_RECORDING_MINUTES
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_VERSION=$VERSION

# Cache .next/cache (webpack/SWC/babel-loader incremental output)
# across builds. The mount only exists during this RUN, so
# .next/standalone and .next/static — which the runner stage copies —
# are still written to the real layer.
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ARG VERSION=dev
ENV NODE_ENV=production
ENV APP_VERSION=$VERSION

RUN apk add --no-cache caddy supervisor

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/start.js ./start.js
COPY supervisord.conf /etc/supervisord.conf
COPY Caddyfile /etc/caddy/Caddyfile
# Allow the app to write to env-config.js at runtime for dynamic environment variable support
RUN touch /app/public/env-config.js && chown nextjs:nodejs /app/public/env-config.js && chmod 644 /app/public/env-config.js

USER nextjs

EXPOSE 3000

# Next.js listens on 3001 (localhost only); Caddy listens on 3000.
# PORT and HOSTNAME are consumed by the standalone server.js.
ENV PORT=3001
ENV HOSTNAME="127.0.0.1"

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
