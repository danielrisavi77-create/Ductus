# Production image of the web application (DAN-298, attack plan #1687). Built
# from the repository root with web.Dockerfile.dockerignore; CI builds it and
# never pushes it. The login provider and every secret come from the
# deployment at run time, never from the image, and the production build
# refuses the local login (D-09).
ARG WEB_BASE_IMAGE=mirror.gcr.io/library/node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

FROM ${WEB_BASE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# `prepare` installs git hooks; the image has no repository.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
ENV DUCTUS_NEXT_OUTPUT=standalone
RUN pnpm build

FROM ${WEB_BASE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Files stay owned by root and read-only to the process; only the cache is its own.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN mkdir -p .next/cache && chown 1000:1000 .next/cache
USER 1000:1000
EXPOSE 3000
CMD ["node", "server.js"]
