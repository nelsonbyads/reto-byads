# DadoFit - Testing Strategy RC1

## 1. Unit tests

```bash
npm test
```

Cobertura actual orientada a reglas deterministas del frontend, incluyendo filtros, dados/random, Sponsored y goal types.

## 2. TypeScript + production build

```bash
npm run build
```

Este comando es obligatorio porque detecta errores de tipos que pueden no aparecer durante `npm run dev`.

## 3. Smoke test funcional

### Personal
- login;
- lanzar dados;
- evidencia obligatoria;
- Gymbros;
- Squads;
- reto 1v1;
- Sponsored Challenges.

### Gym
- selector de workspace;
- miembros/roles;
- reto de Gym;
- Gym vs Gym.

### Brand
- selector de workspace;
- campaña;
- Branded Challenge;
- participante;
- evidencia;
- aprobar / pedir otra evidencia.

## 4. Caso critico Sponsored

```text
Brand publica reto
-> Gymbro se une
-> carga evidencia
-> envia
-> Brand revisa
-> aprueba
-> participante obtiene DC/XP una sola vez
```

Tambien verificar el ciclo:

```text
rechazar
-> nueva evidencia
-> reenviar
-> aprobar
```

El historial de `challenge_reviews` debe admitir multiples revisiones por participante.

## 5. Regresion minima antes de release

- Auth.
- Personal workspace.
- Gymbros.
- Squads.
- Gym workspace.
- Gym vs Gym.
- Brand workspace.
- Sponsored Challenge.
- Notifications.

## 6. Criterio de salida

RC1 solo se considera apta cuando:

```text
Supabase health OK
+ tests OK
+ build OK
+ smoke Vite OK
+ smoke Docker OK
```
