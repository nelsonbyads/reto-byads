-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor después de aplicar la migración V14.
-- Reemplaza el correo por la cuenta cloud que usarás como SuperAdmin.

select id, email, created_at
from auth.users
order by created_at desc;

insert into public.platform_admins (user_id, role, active)
select id, 'superadmin', true
from auth.users
where lower(email) = lower('TU_CORREO_SUPERADMIN@DOMINIO.COM')
on conflict (user_id) do update
set role = 'superadmin', active = true;

select pa.user_id, u.email, pa.role, pa.active, pa.created_at
from public.platform_admins pa
join auth.users u on u.id = pa.user_id;
