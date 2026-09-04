# DadoFit V14 — SuperAdmin Backoffice

## 1. Instalar
Extrae este ZIP sobre la raíz del proyecto.

## 2. Migración
```bash
npx supabase migration list
npx supabase db push
node scripts/check-supabase.mjs
```
Esperado: `Schema: v14-platform-superadmin-backoffice`.

## 3. Designar el primer SuperAdmin
Abre `docs/V14-SUPERADMIN-BOOTSTRAP.sql`, cambia el correo y ejecútalo en Supabase SQL Editor.

> El viejo `admin@dadofit.local` NO se convierte en SuperAdmin cloud. El Backoffice exige una identidad Supabase real.

## 4. Gate técnico
```bash
npm test
npm run build
npm run dev
```

## 5. Prueba click por click
1. Inicia sesión con la cuenta designada SuperAdmin.
2. Abre `http://localhost:5175/admin`.
3. Dashboard: deben aparecer KPIs globales.
4. Usuarios: busca `bro1`, suspende y reactiva. Al suspender, esa cuenta queda bloqueada en rutas protegidas.
5. Marcas: cambia una Marca a `pending_verification` y luego a `verified`.
6. Solicitudes: abre `http://localhost:5175/contact` en incógnito, crea una solicitud de tipo `Quiero pautar`, vuelve a `/admin/requests` y cámbiala de Nuevo → En revisión → Cerrado.
7. Publicidad: crea una campaña con una URL de imagen y destino, asígnala a `workout-right-top`, actívala y abre `/app` en un desktop ancho. El placement debe mostrar la creatividad real en vez del placeholder.
8. Auditoría: valida que las acciones anteriores aparezcan en `Auditoría` y que también exista histórico global de revisiones de evidencias.

## Seguridad V14
- `Admin` de una Marca/Gym no implica SuperAdmin.
- El acceso a `/admin` consulta `platform_admins` en backend.
- Las acciones sensibles usan RPC `SECURITY DEFINER` y registran `admin_audit_log`.
- Un usuario normal no puede cambiar su propio `platform_status`.
- Una pauta solo se activa si tiene al menos un placement.
- Dos campañas activas no pueden solaparse temporalmente en el mismo placement.
