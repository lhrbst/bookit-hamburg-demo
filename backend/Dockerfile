FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM dependencies AS migrations
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node seeds ./seeds
COPY --chown=node:node scripts/database.mjs ./scripts/database.mjs
USER node
CMD ["node", "scripts/database.mjs", "migrate"]

FROM dependencies AS api
ENV NODE_ENV=production PORT=3001
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
