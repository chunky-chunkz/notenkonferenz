FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=apps/web --workspace=packages/shared

# Build shared
FROM deps AS build-shared
COPY packages/shared packages/shared
COPY tsconfig.json .
RUN npm run build --workspace=packages/shared

# Build web
FROM build-shared AS build
COPY apps/web apps/web
RUN npm run build --workspace=apps/web

# Serve with nginx
FROM nginx:alpine AS runner
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
