# syntax=docker/dockerfile:1.7
# ---------- build ----------
FROM node:22-alpine AS build
RUN npm install -g pnpm@12.5.1
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/contracts/package.json packages/contracts/
COPY packages/executor/package.json packages/executor/
COPY packages/importers/package.json packages/importers/
COPY packages/exporters/package.json packages/exporters/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter "./packages/*" --filter @cartero/server run build \
 && pnpm --filter @cartero/web exec vite build \
 && pnpm --filter @cartero/server deploy --prod --legacy /out

# ---------- runtime ----------
FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web \
    FILES_DIR=/data/files
COPY --from=build /out ./
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3000
VOLUME /data
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
