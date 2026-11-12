-- DadoFit V9.0 - Storage foundation
-- Avatars are public. Challenge evidence remains private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'challenge-evidence',
  'challenge-evidence',
  false,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own_folder
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_update_own_folder
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_delete_own_folder
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy challenge_evidence_insert_own_folder
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'challenge-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy challenge_evidence_read_own_folder
on storage.objects for select
to authenticated
using (
  bucket_id = 'challenge-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy challenge_evidence_delete_own_folder
on storage.objects for delete
to authenticated
using (
  bucket_id = 'challenge-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);
