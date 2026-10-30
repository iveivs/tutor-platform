FROM node:22.22.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22.22.0-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22.22.0-bookworm-slim AS runner
WORKDIR /app
# lame re-encodes high-bitrate MP3 uploads in the worker (scripts/audio-compress.mjs).
RUN apt-get update && apt-get install -y --no-install-recommends lame && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-maintenance.mjs /app/scripts/web-push.mjs /app/scripts/access-reminders.mjs /app/scripts/platform-stats.mjs /app/scripts/audio-compress.mjs ./scripts/
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
