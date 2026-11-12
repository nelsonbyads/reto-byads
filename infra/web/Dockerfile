FROM node:22.23.4-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install without running "prepare" before the dataset is copied.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

# Unprivileged variant: runs as uid 101 on port 8080, so the container needs no
# capabilities and works with a read-only root filesystem (+ tmpfs /tmp).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine AS runtime
# Pick up Alpine security fixes published after the base image was built.
USER root
RUN apk upgrade --no-cache
USER 101
COPY infra/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY infra/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
