# DadoFit

DadoFit es una SPA de fitness gamificado construida con React, TypeScript y Vite. Combina un catalogo de 1.324 ejercicios con retos sociales, evidencia en foto/video, recompensas, Squads, Gyms, Brands y Branded Challenges.

## Estado de entrega

**Release Candidate: RC1**

Alcance funcional consolidado:

- Entrenamiento individual mediante dados y niveles de intensidad.
- Catalogo normalizado de 1.324 ejercicios con imagen/GIF e instrucciones.
- Evidencia obligatoria en foto/video para cerrar rondas y retos.
- Autenticacion cloud con Supabase Auth.
- Perfil personal, progreso, XP y DadoCoins.
- Gymbros y retos 1v1.
- Squads y Squad vs Squad.
- Organizations / Gyms y roles Owner, Admin, Coach y Member.
- Gym vs Gym con evidencia y revision cruzada.
- Workspaces Personal, Gym y Brand con RBAC.
- Brands, campañas y Branded Challenges.
- Objetivos Sponsored por repeticiones, tiempo, distancia o cantidad.
- Notificaciones.
- Anti-farming e idempotencia de recompensas.
- Docker para build de produccion local.

## Stack tecnologico

### Frontend
- React 18
- TypeScript
- Vite
- React Router DOM (`BrowserRouter`)
- Lucide React
- CSS propio organizado por version/feature

### Backend / BaaS
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Row Level Security (RLS)
- RPCs PostgreSQL y funciones `SECURITY DEFINER`
- Migraciones SQL versionadas

### Calidad y despliegue
- Vitest
- Docker
- Docker Compose
- Nginx
- Git + GitHub

## Arquitectura de identidad y permisos

DadoFit usa **una sola identidad por persona** y varios contextos de operacion:

```text
AUTH USER
   |
   +-- Personal workspace
   |    +-- Entrenamiento
   |    +-- Gymbros
   |    +-- Retos 1v1
   |    +-- Squads
   |    +-- DadoCoins / XP
   |
   +-- Gym workspace
   |    +-- Miembros y roles
   |    +-- Retos del Gym
   |    +-- Gym vs Gym
   |    +-- Sponsor Points
   |
   +-- Brand workspace
        +-- Campanas
        +-- Branded Challenges
        +-- Participantes
        +-- Revision de evidencias
```

Un usuario personal puede crear un Squad. Crear un Gym o una Brand requiere la capacidad empresarial correspondiente.

## Roles de Organization

| Rol | Participar | Invitar miembros | Publicar retos Gym | Revisar evidencia Gym | Gym vs Gym | Campanas Brand |
| --- | --- | --- | --- | --- | --- | --- |
| Owner | Si | Si | Si | Si | Si | Si |
| Admin | Si | Si | Si | Si | Si | Si |
| Coach | Si | No/limitado | Si | Si | Si | No |
| Member | Si | No | No | No | No | No |

> Las validaciones importantes se hacen tambien en PostgreSQL. Ocultar un boton en React no es la unica barrera de seguridad.

## Requisitos

- Node.js 22 recomendado
- npm
- Git
- Docker Desktop para produccion local
- Proyecto Supabase configurado

Comprobar herramientas:

```bash
node -v
npm -v
git --version
docker --version
docker compose version
```

## Instalacion

```bash
git clone https://github.com/nelsonbyads/reto-byads.git
cd reto-byads
npm install
```

La aplicacion vive directamente en la raiz del repositorio. No debe recrearse una carpeta `dice-app/`.

## Variables de entorno

Crear `.env.local` a partir de `.env.example`:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Nunca subir `.env.local` ni claves privadas al repositorio.

## Base de datos Supabase

Comprobar migraciones:

```bash
npx supabase migration list
```

Aplicar migraciones pendientes:

```bash
npx supabase db push
```

Comprobar conectividad/esquema:

```bash
node scripts/check-supabase.mjs
```

Para RC1, el `schema_version` esperado despues de aplicar todos los hotfixes es:

```text
v13.2.1-sponsored-review-history-hotfix
```

## Desarrollo local

```bash
npm run dev
```

URL:

```text
http://localhost:5175
```

Rutas principales:

```text
/app
/profile
/gymbros
/challenges
/squads
/organizations
/organization-challenges
/gym-battles
/workspace
/brand-campaigns
/sponsored-challenges
/notifications
```

## Tests

Antes de cualquier entrega:

```bash
npm test
```

La suite cubre, entre otros:

- filtros;
- seleccion aleatoria / dados;
- reglas Sponsored;
- tipos de objetivo de Branded Challenges.

Todo test debe pasar antes del release.

## Build de produccion

```bash
npm run build
```

El proceso:

```text
prepare dataset
-> tsc -b
-> vite build
-> copia de images/
-> copia de videos/
```

El dataset procesado queda en:

```text
public/data/exercises.min.json
```

El build final queda en:

```text
dist/
```

## Docker

El Dockerfile usa Node 22 para el build y Nginx para runtime.

Construccion limpia recomendada para RC1:

```bash
docker compose --env-file .env.local down --remove-orphans
docker compose --env-file .env.local build --no-cache
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

URL Docker:

```text
http://localhost:8781
```

## Flujo de release

```text
Supabase migrations
      |
      v
npm test
      |
      v
npm run build
      |
      v
Smoke test Vite :5175
      |
      v
Docker build
      |
      v
Smoke test :8781
      |
      v
Git checkpoint + push
```

## Checklist minimo RC1

- [ ] `npx supabase migration list` sin pendientes inesperados.
- [ ] `node scripts/check-supabase.mjs` responde OK.
- [ ] `npm test` sin fallos.
- [ ] `npm run build` sin errores.
- [ ] Login cloud funciona.
- [ ] Workspace Personal funciona.
- [ ] Gymbros y Squads cargan.
- [ ] Workspace Gym funciona.
- [ ] Gym vs Gym carga.
- [ ] Workspace Brand funciona.
- [ ] Branded Challenge se publica, acepta evidencia y puede aprobarse.
- [ ] Recompensa Sponsored no se duplica.
- [ ] Docker queda `Up` / `healthy`.
- [ ] Refresh directo de rutas SPA no devuelve 404.
- [ ] `git status` termina limpio despues del push.

## Documentacion adicional

- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/TESTING.md`
- `docs/RELEASE_CHECKLIST.md`

## Licencia y media

No eliminar:

```text
data/
images/
videos/
LICENSE
NOTICE.md
```

`dist/`, `node_modules/` y `public/data/exercises.min.json` pueden regenerarse cuando corresponda.
