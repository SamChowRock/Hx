FROM node:24.19.0-alpine AS base
WORKDIR /app
RUN corepack enable && addgroup -S app && adduser -S app -G app

FROM base AS dependencies
ENV HUSKY=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM dependencies AS migration
COPY prisma ./prisma
COPY prisma.config.ts ./prisma.config.ts
CMD ["pnpm", "prisma:migrate:deploy"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/apps/api/src/main.js"]
