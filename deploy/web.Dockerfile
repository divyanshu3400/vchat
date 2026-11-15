FROM node:24-slim AS build
WORKDIR /app
COPY web/package.json web/package-lock.json ./
# Next's native compiler is an optional package: stop here if npm skipped it, rather than
# fail later with "Turbopack is not supported on this platform".
RUN npm ci && npm ls @next/swc-linux-x64-gnu > /dev/null
COPY web/ ./
# Baked into the build: canonical URLs, sitemap.xml and robots.txt use it.
ARG NEXT_PUBLIC_SITE_URL
# off | placeholder | live (see web/src/lib/ads.ts)
ARG NEXT_PUBLIC_ADS_MODE=off
# on: block the chat app for visitors whose ad blocker hides our ads (only while ads are on)
ARG NEXT_PUBLIC_ADBLOCK_WALL=off
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_ADS_MODE=$NEXT_PUBLIC_ADS_MODE \
    NEXT_PUBLIC_ADBLOCK_WALL=$NEXT_PUBLIC_ADBLOCK_WALL \
    BACKEND_URL=http://backend:8000 \
    NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_SITE_URL" && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
