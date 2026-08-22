FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./

# Instalamos dependencias sin ejecutar el script "prepare".
# El dataset se preparará correctamente durante npm run build,
# después de copiar el proyecto completo.
RUN npm ci --ignore-scripts

COPY . .

RUN npm run build


FROM nginx:1.27-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]