# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contract/package.json packages/contract/tsconfig.json ./packages/contract/
COPY apps/backend/package.json apps/backend/tsconfig.json ./apps/backend/
COPY apps/telegram/package.json apps/telegram/tsconfig.json ./apps/telegram/
COPY apps/alexa/package.json apps/alexa/tsconfig.json ./apps/alexa/

RUN npm ci

COPY packages/contract/src ./packages/contract/src
COPY apps/backend/src ./apps/backend/src
COPY apps/backend/migrations ./apps/backend/migrations

RUN npm run build -w @relay/contract \
    && npm run build -w @relay/backend \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contract/package.json ./packages/contract/package.json
COPY --from=build /app/packages/contract/dist ./packages/contract/dist
COPY --from=build /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/backend/migrations ./apps/backend/migrations

USER node

EXPOSE 3000

CMD ["node", "apps/backend/dist/server.js"]
