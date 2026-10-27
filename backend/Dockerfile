FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS dependencies
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
