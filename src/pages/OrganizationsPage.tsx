import { ArrowLeft, Building2, Check, ExternalLink, RefreshCw, ShieldCheck, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface OrganizationRow {
  id: string;
  owner_user_id: string | null;
  name: string;
  slug: string;
  organization_type: 'gym' | 'brand' | 'sponsor' | 'company' | 'other';
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  country_code: string | null;
}

interface MemberRow {
  organization_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'coach' | 'member';
  status: 'invited' | 'active' | 'left' | 'removed';
  joined_at: string;
}

interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface FriendshipRow {
  requester_id: string;
  addressee_id: string;
}

interface OrganizationView {
  organization: OrganizationRow;
  membership: MemberRow;
  members: MemberRow[];
  sponsorPoints: number;
  activeChallenges: number;
}

const TYPE_LABEL: Record<OrganizationRow['organization_type'], string> = {
  gym: 'Gym',
  brand: 'Marca',
  sponsor: 'Sponsor',
  company: 'Empresa',
  other: 'Organización',
};

function initials(profile: ProfileRow | null) {
  const value = profile?.display_name?.trim() || profile?.username || 'DF';
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

export function OrganizationsPage() {
  const { user } = useAuth();
  const [views, setViews] = useState<OrganizationView[]>([]);
  const [invitations, setInvitations] = useState<Array<{ organization: OrganizationRow; membership: MemberRow }>>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [gymbros, setGymbros] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<OrganizationRow['organization_type']>('gym');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('CO');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) {
      setLoading(false);
      return;
    }
    const client = supabase;
    setLoading(true);
    setError('');

    const [membershipResult, sentFriends, receivedFriends] = await Promise.all([
      client.from('organization_members').select('organization_id, user_id, role, status, joined_at').eq('user_id', user.id).in('status', ['active', 'invited']),
      client.from('friendships').select('requester_id, addressee_id').eq('requester_id', user.id).eq('status', 'accepted'),
      client.from('friendships').select('requester_id, addressee_id').eq('addressee_id', user.id).eq('status', 'accepted'),
    ]);

    const firstError = membershipResult.error ?? sentFriends.error ?? receivedFriends.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const ownMemberships = (membershipResult.data ?? []) as MemberRow[];
    const orgIds = [...new Set(ownMemberships.map((item) => item.organization_id))];
    const friendRows = [...(sentFriends.data ?? []), ...(receivedFriends.data ?? [])] as FriendshipRow[];
    const friendIds = [...new Set(friendRows.map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];

    const [orgResult, membersResult, scoresResult, challengesResult, friendProfilesResult] = await Promise.all([
      orgIds.length ? client.from('organizations').select('id, owner_user_id, name, slug, organization_type, description, logo_url, website_url, country_code').in('id', orgIds).order('name') : Promise.resolve({ data: [] as OrganizationRow[], error: null }),
      orgIds.length ? client.from('organization_members').select('organization_id, user_id, role, status, joined_at').in('organization_id', orgIds).in('status', ['active', 'invited']) : Promise.resolve({ data: [] as MemberRow[], error: null }),
      orgIds.length ? client.from('score_events').select('organization_id, sponsor_points').in('organization_id', orgIds) : Promise.resolve({ data: [] as Array<{ organization_id: string | null; sponsor_points: number }>, error: null }),
      orgIds.length ? client.from('challenges').select('id, creator_organization_id, status').in('creator_organization_id', orgIds).eq('challenge_type', 'organization').eq('status', 'active') : Promise.resolve({ data: [] as Array<{ id: string; creator_organization_id: string | null; status: string }>, error: null }),
      friendIds.length ? client.from('profiles').select('id, username, display_name, avatar_url').in('id', friendIds).order('display_name') : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    ]);

    const secondError = orgResult.error ?? membersResult.error ?? scoresResult.error ?? challengesResult.error ?? friendProfilesResult.error;
    if (secondError) {
      setError(secondError.message);
      setLoading(false);
      return;
    }

    const organizations = (orgResult.data ?? []) as OrganizationRow[];
    const allMembers = (membersResult.data ?? []) as MemberRow[];
    const memberProfileIds = [...new Set(allMembers.map((item) => item.user_id))];
    const profileResult = memberProfileIds.length
      ? await client.from('profiles').select('id, username, display_name, avatar_url').in('id', memberProfileIds)
      : { data: [] as ProfileRow[], error: null };

    if (profileResult.error) {
      setError(profileResult.error.message);
      setLoading(false);
      return;
    }

    const profileMap = new Map<string, ProfileRow>();
    for (const item of (profileResult.data ?? []) as ProfileRow[]) profileMap.set(item.id, item);
    for (const item of (friendProfilesResult.data ?? []) as ProfileRow[]) profileMap.set(item.id, item);
    setProfiles(profileMap);
    setGymbros((friendProfilesResult.data ?? []) as ProfileRow[]);

    const scoreMap = new Map<string, number>();
    for (const row of (scoresResult.data ?? []) as Array<{ organization_id: string | null; sponsor_points: number }>) {
      if (!row.organization_id) continue;
      scoreMap.set(row.organization_id, (scoreMap.get(row.organization_id) ?? 0) + Number(row.sponsor_points ?? 0));
    }

    const challengeMap = new Map<string, number>();
    for (const row of (challengesResult.data ?? []) as Array<{ creator_organization_id: string | null }>) {
      if (!row.creator_organization_id) continue;
      challengeMap.set(row.creator_organization_id, (challengeMap.get(row.creator_organization_id) ?? 0) + 1);
    }

    const orgMap = new Map(organizations.map((item) => [item.id, item]));
    const activeViews: OrganizationView[] = [];
    const nextInvitations: Array<{ organization: OrganizationRow; membership: MemberRow }> = [];

    for (const membership of ownMemberships) {
      const organization = orgMap.get(membership.organization_id);
      if (!organization) continue;
      if (membership.status === 'invited') {
        nextInvitations.push({ organization, membership });
        continue;
      }
      activeViews.push({
        organization,
        membership,
        members: allMembers.filter((item) => item.organization_id === organization.id),
        sponsorPoints: scoreMap.get(organization.id) ?? 0,
        activeChallenges: challengeMap.get(organization.id) ?? 0,
      });
    }

    setViews(activeViews);
    setInvitations(nextInvitations);
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  const totalSponsorPoints = useMemo(() => views.reduce((sum, item) => sum + item.sponsorPoints, 0), [views]);

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || !cloudReady) return;
    const client = supabase;
    setCreating(true);
    setError('');
    setMessage('');
    const { error: rpcError } = await client.rpc('create_organization', {
      p_name: name.trim(),
      p_organization_type: type,
      p_description: description.trim() || null,
      p_website_url: website.trim() || null,
      p_country_code: country.trim().toUpperCase() || null,
    });
    setCreating(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setName('');
    setDescription('');
    setWebsite('');
    setMessage('Organización creada. Ya puedes invitar Gymbros.');
    await load();
  };

  const respondInvite = async (organizationId: string, accept: boolean) => {
    if (!supabase) return;
    setActing(`invite:${organizationId}`);
    setError('');
    const { error: rpcError } = await supabase.rpc('respond_organization_invite', { p_organization_id: organizationId, p_accept: accept });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const invite = async (organizationId: string, userId: string) => {
    if (!supabase) return;
    setActing(`add:${organizationId}:${userId}`);
    setError('');
    const { error: rpcError } = await supabase.rpc('invite_organization_member', { p_organization_id: organizationId, p_user_id: userId });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const removeMember = async (organizationId: string, userId: string) => {
    if (!supabase || !window.confirm('¿Retirar a este miembro de la organización?')) return;
    setActing(`remove:${organizationId}:${userId}`);
    const { error: rpcError } = await supabase.rpc('remove_organization_member', { p_organization_id: organizationId, p_user_id: userId });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const leave = async (organizationId: string) => {
    if (!supabase || !window.confirm('¿Salir de esta organización?')) return;
    setActing(`leave:${organizationId}`);
    const { error: rpcError } = await supabase.rpc('leave_organization', { p_organization_id: organizationId });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const setRole = async (organizationId: string, userId: string, role: string) => {
    if (!supabase) return;
    setActing(`role:${organizationId}:${userId}`);
    const { error: rpcError } = await supabase.rpc('set_organization_member_role', { p_organization_id: organizationId, p_user_id: userId, p_role: role });
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  return (
    <div className="profile-shell-v9 organizations-shell-v12">
      <AppHeader/>
      <main className="profile-page-v9 organizations-page-v12">
        <div className="organizations-topline-v12">
          <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
          {cloudReady && <button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button>}
        </div>

        <section className="profile-hero-v9 organizations-hero-v12">
          <div className="profile-avatar-v9"><Building2 size={31}/></div>
          <div><span className="eyebrow">DADOFIT ORGANIZATIONS</span><h1>Gyms & Organizations</h1><p>Crea tu organización, suma miembros y convierte retos aprobados en Sponsor Points.</p></div>
          {cloudReady && <div className="organizations-hero-stats-v12"><span><strong>{views.length}</strong> activas</span><span><strong>{totalSponsorPoints.toLocaleString()}</strong> SP</span></div>}
        </section>

        {!cloudReady ? (
          <section className="profile-card-v9 profile-cloud-callout-v9"><h2>Necesitas una cuenta cloud</h2><p>Las organizaciones requieren un perfil real de DadoFit.</p><Link className="profile-primary-v9" to="/register">Crear cuenta</Link></section>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-success">{message}</div>}

            {invitations.length > 0 && (
              <section className="profile-card-v9 organization-invites-v12">
                <span className="eyebrow">INVITACIONES</span><h2>Te quieren en su equipo</h2>
                {invitations.map(({ organization }) => (
                  <article key={organization.id}>
                    <div><Building2 size={20}/><span><strong>{organization.name}</strong><small>{TYPE_LABEL[organization.organization_type]}</small></span></div>
                    <div><button type="button" className="secondary" onClick={() => { void respondInvite(organization.id, false); }} disabled={Boolean(acting)}><X size={15}/> Rechazar</button><button type="button" onClick={() => { void respondInvite(organization.id, true); }} disabled={Boolean(acting)}><Check size={15}/> Aceptar</button></div>
                  </article>
                ))}
              </section>
            )}

            <section className="organizations-layout-v12">
              <div className="organizations-list-v12">
                <div className="organizations-section-heading-v12"><div><span className="eyebrow">MIS ORGANIZACIONES</span><h2>{loading ? 'Cargando…' : `${views.length} activas`}</h2></div><Link to="/organization-challenges">Ver retos</Link></div>

                {!loading && views.length === 0 ? (
                  <section className="profile-card-v9 organization-empty-v12"><Building2 size={32}/><h3>Aún no perteneces a una organización</h3><p>Crea un Gym, empresa o marca y empieza a construir su comunidad.</p></section>
                ) : views.map((view) => {
                  const isOwner = view.membership.role === 'owner';
                  const canAdmin = ['owner', 'admin'].includes(view.membership.role);
                  const canManageChallenges = ['owner', 'admin', 'coach'].includes(view.membership.role);
                  const memberIds = new Set(view.members.filter((item) => ['active', 'invited'].includes(item.status)).map((item) => item.user_id));
                  const inviteCandidates = gymbros.filter((item) => !memberIds.has(item.id));

                  return (
                    <article key={view.organization.id} className="profile-card-v9 organization-card-v12">
                      <header>
                        <div className="organization-title-v12"><div className="organization-logo-v12">{view.organization.logo_url ? <img src={view.organization.logo_url} alt=""/> : <Building2 size={22}/>}</div><div><span className="eyebrow">{TYPE_LABEL[view.organization.organization_type]}</span><h2>{view.organization.name}</h2><p>{view.organization.description || 'Comunidad DadoFit'}</p></div></div>
                        <span className="organization-role-v12">{view.membership.role}</span>
                      </header>

                      <div className="organization-stats-v12">
                        <div><span>Miembros</span><strong>{view.members.filter((item) => item.status === 'active').length}</strong></div>
                        <div><span>Sponsor Points</span><strong>{view.sponsorPoints.toLocaleString()} SP</strong></div>
                        <div><span>Retos activos</span><strong>{view.activeChallenges}</strong></div>
                      </div>

                      <div className="organization-links-v12">
                        {view.organization.website_url && <a href={view.organization.website_url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Sitio web</a>}
                        {canManageChallenges && <Link to="/app"><ShieldCheck size={14}/> Publicar desde una tirada</Link>}
                        <Link to="/organization-challenges">Retos de la organización</Link>
                      </div>

                      <div className="organization-members-v12">
                        <div className="organization-subheading-v12"><strong>Miembros</strong><span>{view.members.filter((item) => item.status === 'active').length} activos</span></div>
                        {view.members.map((member) => {
                          const profile = profiles.get(member.user_id) ?? null;
                          const isSelf = member.user_id === user?.id;
                          return (
                            <div key={`${view.organization.id}:${member.user_id}`} className="organization-member-row-v12">
                              <div className="organization-member-identity-v12"><span className="organization-member-avatar-v12">{profile?.avatar_url ? <img src={profile.avatar_url} alt=""/> : initials(profile)}</span><span><strong>{profile?.display_name || profile?.username || 'Gymbro'}</strong><small>{profile?.username ? `@${profile.username}` : member.status}</small></span></div>
                              <div className="organization-member-actions-v12">
                                {isOwner && !isSelf && member.status === 'active' ? (
                                  <select value={member.role} onChange={(event) => { void setRole(view.organization.id, member.user_id, event.target.value); }} disabled={Boolean(acting)}>
                                    <option value="member">Miembro</option><option value="coach">Coach</option><option value="admin">Admin</option>
                                  </select>
                                ) : <span className={`member-status-${member.status}`}>{member.role}{member.status === 'invited' ? ' · invitado' : ''}</span>}
                                {canAdmin && !isSelf && member.role !== 'owner' && <button type="button" className="organization-icon-action-v12" onClick={() => { void removeMember(view.organization.id, member.user_id); }} disabled={Boolean(acting)} title="Retirar miembro"><UserMinus size={15}/></button>}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {canAdmin && inviteCandidates.length > 0 && (
                        <div className="organization-invite-gymbros-v12">
                          <div className="organization-subheading-v12"><strong>Invitar Gymbros</strong><span>Solo conexiones aceptadas</span></div>
                          <div>{inviteCandidates.slice(0, 8).map((gymbro) => <button key={gymbro.id} type="button" onClick={() => { void invite(view.organization.id, gymbro.id); }} disabled={Boolean(acting)}><UserPlus size={14}/>{gymbro.display_name || gymbro.username || 'Gymbro'}</button>)}</div>
                        </div>
                      )}

                      {!isOwner && <button type="button" className="organization-leave-v12" onClick={() => { void leave(view.organization.id); }} disabled={Boolean(acting)}>Salir de la organización</button>}
                    </article>
                  );
                })}
              </div>

              <form className="profile-card-v9 organization-create-v12" onSubmit={createOrganization}>
                <span className="eyebrow">NUEVA ORGANIZACIÓN</span><h2>Crear comunidad</h2>
                <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={80} placeholder="Ej: DadoFit Gym Medellín" required/></label>
                <label>Tipo<select value={type} onChange={(event) => setType(event.target.value as OrganizationRow['organization_type'])}><option value="gym">Gym</option><option value="company">Empresa</option><option value="brand">Marca</option><option value="sponsor">Sponsor</option><option value="other">Otra</option></select></label>
                <label>Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={500} placeholder="Qué representa esta comunidad"/></label>
                <label>Website<input value={website} onChange={(event) => setWebsite(event.target.value)} maxLength={300} placeholder="https://..."/></label>
                <label>País<input value={country} onChange={(event) => setCountry(event.target.value.toUpperCase().slice(0, 2))} maxLength={2}/></label>
                <button className="profile-primary-v9" type="submit" disabled={creating}><Building2 size={16}/>{creating ? 'Creando…' : 'Crear organización'}</button>
                <p className="organization-create-note-v12"><UsersRound size={14}/> Tú quedas como owner. Después puedes invitar Gymbros y asignar Coaches o Admins.</p>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
