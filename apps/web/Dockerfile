# Imagen de la APP: compila con Vite y la sirve con nginx, que además reenvía /api a la API.
#   docker build -f apps/web/Dockerfile -t residencial-web .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @residencial/web --include-workspace-root=false
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN npm run build -w @residencial/web

FROM nginx:1.27-alpine
COPY apps/web/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
