# Fake OIDC provider for local development and CI only (D-09). Never deployed.
ARG OIDC_BASE_IMAGE=node:24.21.0-alpine
FROM ${OIDC_BASE_IMAGE}
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
