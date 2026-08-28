# DadoFit V13 - Brands, Sponsors & Branded Challenges

## Objetivo

Validar en una sola ronda el flujo completo Marca -> Campaña -> Branded Challenge -> Gymbro -> Evidencia -> Revisión -> Recompensa.

## 1. Migración y salud

```bash
npx supabase migration list
npx supabase db push
node scripts/check-supabase.mjs
```

Esperado:

```text
Schema: v13-brands-sponsors-branded-challenges
```

## 2. Regresión automática

```bash
npm test
npm run build
```

Esperado:
- los 14 tests históricos siguen pasando;
- 6 tests nuevos de reglas Sponsored pasan;
- TypeScript compila;
- dataset de 1324 ejercicios se prepara;
- imágenes y videos se copian.

## 3. Marca

1. Iniciar sesión con un usuario que tenga un workspace Marca existente.
2. Cambiar a ese workspace.
3. Abrir `/brand-campaigns`.
4. Confirmar que el dashboard carga Equipo, Campañas, Branded Challenges, Participantes y Aprobados.
5. Crear una campaña en borrador con 25 DC / 50 XP.
6. Activarla.
7. Publicar un reto, por ejemplo `20 x Burpees`, 72 h, 100 cupos.

Nota: V13 verifica automáticamente los workspaces Marca que ya existían al aplicar la migración para mantener la continuidad de la beta. Las Marcas creadas después de V13 vuelven a entrar como `pending_verification`.

## 4. Gymbro / Personal

En otra sesión:

1. Usar workspace `Mi perfil`.
2. Abrir `/sponsored-challenges`.
3. Ver la campaña publicada.
4. Unirse al reto.
5. Adjuntar foto o video.
6. Enviar evidencia a la Marca.

## 5. Revisión

Volver a la sesión de Marca:

1. Abrir `/brand-campaigns`.
2. Ver `Por revisar`.
3. Abrir la evidencia.
4. Probar `Pedir otra evidencia` si se desea.
5. Aprobar.

Esperado en la cuenta del Gymbro:

```text
+25 DadoCoins
+50 XP
```

La notificación debe llevar al usuario al workspace Personal y a `/sponsored-challenges`.

## 6. Seguridad / RBAC

Validar:

- Owner de Marca: crea, activa, publica y revisa.
- Admin de Marca: crea, activa, publica y revisa.
- Coach de Marca: no administra campañas.
- Member de Marca: no administra campañas.
- Un miembro activo de la Marca patrocinadora no puede unirse al reto de su propia Marca.
- Una Marca no verificada puede preparar borradores, pero no activar/publicar.

## 7. Anti-farming

Regla V13:

```text
mismo participante + mismo reto -> recompensa máximo una vez
mismo usuario -> máximo 3 recompensas Sponsored en una ventana de 24 h
```

Cuando el límite se activa:

```text
reto aprobado        SI
reto completado      SI
DadoCoins             0
XP                    0
reward_block_reason   sponsored_daily_limit
```

## 8. Docker

Solo después de aprobar la prueba integrada:

```bash
docker compose --env-file .env.local down --remove-orphans
docker compose --env-file .env.local build --no-cache
docker compose --env-file .env.local up -d
docker compose --env-file .env.local ps
```

Smoke test en `http://localhost:8781`:

- Personal -> Sponsored Challenges
- Marca -> Campaigns
- crear/publicar
- evidencia
- revisión
- notificaciones
