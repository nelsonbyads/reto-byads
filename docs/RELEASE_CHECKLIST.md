# DadoFit RC1 - Release Checklist

## Database
- [ ] `npx supabase migration list` revisado.
- [ ] `npx supabase db push` aplicado si habia pendientes.
- [ ] `node scripts/check-supabase.mjs` = OK.
- [ ] Schema reporta V13.2.1 o posterior.

## Automated checks
- [ ] `npm test` pasa completo.
- [ ] `npm run build` termina sin errores.
- [ ] Warning de chunk >500 KB documentado como deuda, no blocker.

## Functional smoke
- [ ] Login cloud.
- [ ] Personal workspace.
- [ ] Gymbros.
- [ ] Squads.
- [ ] 1v1.
- [ ] Gym workspace.
- [ ] Organization challenges.
- [ ] Gym vs Gym.
- [ ] Brand workspace.
- [ ] Campaigns.
- [ ] Sponsored Challenges.
- [ ] Goal type distancia (ej. Trotar 20 km).
- [ ] Evidencia Sponsored.
- [ ] Rechazo y reenvio de evidencia.
- [ ] Aprobacion Sponsored.
- [ ] DC/XP se otorgan una sola vez.
- [ ] Notifications.

## Docker
- [ ] Build limpio con `.env.local`.
- [ ] `dadofit-web` Up/healthy.
- [ ] `http://localhost:8781` abre.
- [ ] Refresh de rutas internas sin 404.
- [ ] Media carga.
- [ ] Supabase funciona dentro del build Docker.

## Repository
- [ ] README actualizado.
- [ ] `.env.local` NO trackeado.
- [ ] No se subieron secretos.
- [ ] `data/`, `images/`, `videos/`, `LICENSE`, `NOTICE.md` conservados.
- [ ] `git status` revisado.
- [ ] Commit RC1 creado.
- [ ] Push a `origin/main` completado.
- [ ] `git status` final limpio.

## Recommended final commit

```bash
git add .
git commit -m "feat: complete DadoFit RC1 social gyms brands and sponsored challenges"
git push origin main
```
