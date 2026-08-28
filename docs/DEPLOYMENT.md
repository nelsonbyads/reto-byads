# DadoFit - Deployment Guide RC1

## Desarrollo

```bash
npm install
npm run dev
```

URL: `http://localhost:5175`

## Variables

Crear `.env.local`:

```env
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
```

No usar Service Role Key en el frontend.

## Supabase

```bash
npx supabase migration list
npx supabase db push
node scripts/check-supabase.mjs
```

Todas las migraciones del repo deben estar aplicadas en el proyecto de destino.

## Validacion previa

```bash
npm test
npm run build
```

No desplegar si alguno falla.

## Docker local de produccion

El `Dockerfile` usa Node 22 en el builder y Nginx en runtime. Las variables Vite entran como build args desde Docker Compose.

```bash
docker compose --env-file .env.local down --remove-orphans
docker compose --env-file .env.local build --no-cache
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

URL: `http://localhost:8781`

## Smoke test Docker

- Login.
- Abrir `/app`.
- Cambiar Personal -> Gym -> Brand cuando el usuario tenga esos workspaces.
- Abrir `/sponsored-challenges`.
- Abrir `/brand-campaigns` desde Brand.
- Refrescar una ruta interna y comprobar que Nginx sirve la SPA sin 404.
- Comprobar que media y evidencias cargan.

## Logs

```bash
docker compose --env-file .env.local logs --tail=100 dadofit-web
```

Tiempo real:

```bash
docker compose --env-file .env.local logs -f dadofit-web
```

## Rollback rapido local

Si el nuevo build falla, volver al ultimo commit estable, reconstruir Docker y no modificar migraciones ya aplicadas manualmente. Para cambios SQL, crear siempre una migracion correctiva nueva.
