# DadoFit - Architecture RC1

## 1. Tipo de aplicacion

DadoFit es una SPA (Single Page Application) construida con React + TypeScript + Vite. React Router maneja el enrutamiento del lado del cliente mediante `BrowserRouter`.

## 2. Capas

```text
Browser
  |
  v
React SPA
  |
  +-- AuthContext
  +-- WorkspaceContext
  +-- Route / Workspace Guards
  +-- Feature Pages
  |
  v
Supabase JS Client
  |
  +-- Auth
  +-- PostgreSQL
  |    +-- RLS
  |    +-- RPCs
  |    +-- SECURITY DEFINER
  |    +-- Reward Engine
  |    +-- Anti-farming
  |
  +-- Storage
       +-- Avatars
       +-- Challenge Evidence
```

## 3. Workspaces

### Personal
- entrenamiento;
- Gymbros;
- retos 1v1;
- Squads;
- Sponsored Challenges como participante;
- XP / DadoCoins.

### Gym
- miembros;
- Owner/Admin/Coach/Member;
- retos institucionales;
- revision de evidencia;
- Gym vs Gym;
- Sponsor Points.

### Brand
- equipo;
- campañas;
- Branded Challenges;
- revision de evidencia Sponsored;
- metricas basicas.

## 4. Economia

DadoFit separa cuatro conceptos:

- XP: progresion no gastable.
- DadoCoins: moneda de fidelizacion cerrada, no crypto.
- Team Points: competencia de Squads.
- Sponsor Points: contribucion/competencia de Organizations/Gyms.

Las recompensas se escriben desde funciones de servidor y deben ser auditables e idempotentes.

## 5. Evidence model

La evidencia de retos sociales se almacena en Supabase Storage y se referencia desde PostgreSQL. Se usan URLs firmadas para acceder a evidencia privada.

Formatos esperados: imagenes y videos compatibles con navegador; limite funcional usado en flujos sociales: 50 MB.

## 6. Anti-farming

Principio del producto:

```text
COMPLETAR UN RETO != TENER DERECHO A RECOMPENSA
```

Un reto puede considerarse completado y no generar recompensa adicional cuando se dispara una regla anti-farming.

Existen reglas separadas para 1v1, Squad battles, Organization/Gym y Sponsored.

## 7. Seguridad

La autorizacion se aplica en dos niveles:

1. Frontend: route guards, workspace guards y visibilidad contextual.
2. Backend: RLS, RPC validation, organization membership, role validation y organization type validation.

El backend es la fuente de verdad para permisos y economia.

## 8. Dataset de ejercicios

El proyecto prepara 1.324 ejercicios desde el dataset fuente y genera `public/data/exercises.min.json`. Cada ejercicio puede incluir nombre, zona corporal, equipo, target, grupo muscular, instrucciones, imagen y media.

Branded Challenges pueden reutilizar el catalogo o usar una actividad personalizada. La meta Sponsored soporta:

- repeticiones;
- tiempo;
- distancia;
- cantidad.
