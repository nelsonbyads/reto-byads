# DadoFit V15.7 - Pre-Release / Feature Freeze Checklist

## Database
- [ ] `npx supabase migration list` revisado.
- [ ] `20260904234500_pre_release_seasons_competitions.sql` aparece Local + Remote.
- [ ] `npx supabase db push` aplicado si habia pendientes.
- [ ] `node scripts/check-supabase.mjs` = OK.
- [ ] `select public.get_dadofit_schema_version();` = `v15.7-pre-release-feature-pack`.

## Automated checks
- [ ] `npm test` pasa completo.
- [ ] `npm run build` termina sin errores.
- [ ] Warning de chunk >500 KB documentado como deuda si aparece; no bloquear solo por tamaño.

## A. Unified Challenges
- [ ] Personal → Retos muestra tabs `1 vs 1 / Del Gym / Squads / Patrocinados / Temporadas`.
- [ ] `Del Gym` abre los retos de organización del Gymbro.
- [ ] `Squads` conserva creación/invitaciones/batallas.
- [ ] `Patrocinados` conserva Branded Challenges.
- [ ] Header Personal sigue compacto: `Entrenar / Retos / Premios / Más`.

## B. TP / GP Seasons
- [ ] `/seasons` abre en Personal.
- [ ] Temporada Squad muestra ranking TP.
- [ ] Temporada Gym muestra ranking GP.
- [ ] Gym Dashboard enlaza a `Temporadas & rankings`.
- [ ] SuperAdmin → `Temporadas` lista y crea ventanas Squad/Gym.
- [ ] Crear dos temporadas solapadas del mismo tipo es rechazado.
- [ ] Nuevo reto Squad queda asociado a temporada Squad.
- [ ] Nuevo reto Gym / Gym vs Gym queda asociado a temporada Gym.
- [ ] Cerrar temporada NO borra `score_events`.
- [ ] Histórico de temporadas cerradas sigue visible.

## C. Sponsored Gym Competitions
- [ ] Brand verificada → Dashboard → `Competencias Gym`.
- [ ] Owner/Admin puede crear competencia con mínimo 2 Gyms verificados.
- [ ] Menos de 2 Gyms es rechazado.
- [ ] Gym Owner/Admin recibe notificación.
- [ ] La notificación abre el workspace Gym y `/seasons`.
- [ ] Owner/Admin Gym puede aceptar o rechazar.
- [ ] Coach/Member no puede responder aunque fuerce RPC.
- [ ] Brand recibe notificación de respuesta.
- [ ] Brand ve estado de cada Gym invitado.
- [ ] Leaderboard patrocinado usa GP generado dentro de la ventana de la competencia.
- [ ] El GP patrocinado no elimina ni mueve el GP de la temporada Gym global.

## D. Rewards / QR / Analytics
- [ ] Crear oferta Gym.
- [ ] Publicar oferta y recibir notificación como miembro activo.
- [ ] Oferta aparece solo dentro de vigencia.
- [ ] Gymbro canjea y se descuentan DC transaccionalmente.
- [ ] Mis canjes muestra referencia DF.
- [ ] Reward presencial/físico genera QR.
- [ ] Owner/Admin valida QR y confirma entrega.
- [ ] Estado cambia `ISSUED → REDEEMED`.
- [ ] QR ya usado no vuelve a entregar.
- [ ] Rewards Analytics actualiza canjes, DC y pendientes.
- [ ] SuperAdmin Rewards Analytics carga.

## E. Economy / anti-farming
- [ ] 1v1: DC + XP.
- [ ] Squad: DC + XP + TP.
- [ ] Gym: DC + XP + GP.
- [ ] Gym vs Gym: DC + XP + GP.
- [ ] Sponsored Challenge: DC + XP.
- [ ] Aprobación bloqueada muestra `0 DC / 0 XP / 0 TP/GP`.
- [ ] La UI no presenta recompensa potencial como payout otorgado.
- [ ] `sponsor_points` puede seguir existiendo internamente, pero UI de Gym muestra GP.

## F. RBAC / security
- [ ] Owner/Admin Gym: gestión completa Rewards y respuesta a competencias.
- [ ] Coach Gym: operación permitida existente, sin administración Rewards/competencias patrocinadas.
- [ ] Member Gym: participación sin administración.
- [ ] Owner/Admin Brand: crea competencia patrocinada.
- [ ] Usuario sin rol no puede ejecutar RPCs privilegiadas.
- [ ] SuperAdmin exclusivo en `/admin`.

## G. Responsive / Ads
- [ ] Desktop ancho: header Personal no se superpone.
- [ ] Laptop: header compacto conserva accesibilidad.
- [ ] Mobile: Challenge Center hace scroll horizontal sin romper layout.
- [ ] Desktop amplio: rails publicitarios.
- [ ] Laptop: dock comercial inferior.
- [ ] Mobile: banner/fallback.

## Docker
- [ ] Build limpio con `.env.local`.
- [ ] `dadofit-web` Up/healthy.
- [ ] `http://localhost:8781` abre.
- [ ] Refresh de rutas internas sin 404.
- [ ] Media carga.
- [ ] Supabase funciona dentro del build Docker.

## Repository / Feature Freeze
- [ ] `AGENT.md`, `README.md`, Blueprint y checklist actualizados.
- [ ] `.env.local` NO trackeado.
- [ ] No se subieron secretos.
- [ ] `data/`, `images/`, `videos/`, `LICENSE`, `NOTICE.md` conservados.
- [ ] No quedan bugs blocker/critical del QA V15.7.
- [ ] FEATURE FREEZE declarado.
- [ ] `git status` revisado.
- [ ] Commit pre-release creado.
- [ ] Push a `origin/main` completado.
- [ ] `git status` final limpio.

## Commit recomendado cuando QA quede aprobado

```bash
git add .
git commit -m "feat: complete DadoFit pre-release seasons competitions and unified challenges"
git push origin main
```
