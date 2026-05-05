FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=apps/api --workspace=packages/shared

# Build shared package
FROM deps AS build-shared
COPY packages/shared packages/shared
COPY tsconfig.json .
RUN npm run build --workspace=packages/shared

# Build api
FROM build-shared AS build
COPY apps/api apps/api
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

# Production
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json

RUN mkdir -p /app/uploads /app/media

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
