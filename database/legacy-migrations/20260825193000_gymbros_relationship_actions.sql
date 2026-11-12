-- DadoFit V9.2 - Gymbros relationship actions
-- A pending friendship can only be accepted by its addressee.
-- Rejection/cancellation/removal continues to use the existing DELETE policy.

revoke update on table public.friendships from authenticated;
grant update (status) on table public.friendships to authenticated;

drop policy if exists friendships_accept_incoming on public.friendships;
create policy friendships_accept_incoming
on public.friendships for update
to authenticated
using (
  addressee_id = auth.uid()
  and status = 'pending'
)
with check (
  addressee_id = auth.uid()
  and status = 'accepted'
);
