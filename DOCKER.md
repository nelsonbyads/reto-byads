# DadoFit Docker

La imagen usa un build multi-stage:

1. Node 22.23.4 Alpine instala dependencias y ejecuta `npm run build`.
2. Nginx sirve `dist/` en producción.
3. React Router usa fallback a `index.html`.
4. `/images` y `/videos` se cachean durante 30 días.

Node solo existe en la etapa de compilación; la imagen final no contiene Node ni PHP.

## Levantar

```bash
docker compose up -d --build
```

Abrir:

```text
http://localhost:8781
```

## Ver logs

```bash
docker compose logs -f dadofit-web
```

## Detener

```bash
docker compose down
```

## Rebuild limpio

```bash
docker compose build --no-cache
docker compose up -d
```
