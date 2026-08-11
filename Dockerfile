FROM node:22.14.0-alpine AS base
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/apps/api/src/main.js"]
