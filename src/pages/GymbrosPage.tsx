import { ArrowLeft, Check, RefreshCw, Search, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppHeader } from '../components/AppHeader';
import { supabase } from '../lib/supabase';

interface PublicProfile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'blocked';
  created_at: string;
}

interface GymbroRelation extends FriendshipRow {
  profile: PublicProfile | null;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

export function GymbrosPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(user?.provider === 'supabase');
  const [actingId, setActingId] = useState<string | null>(null);
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [relations, setRelations] = useState<GymbroRelation[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const loadRelations = useCallback(async () => {
    if (!user || user.provider !== 'supabase' || !supabase) {
      setLoading(false);
      return;
    }

    const client = supabase;
    setLoading(true);
    setError('');

    const [sentResult, receivedResult] = await Promise.all([
      client
        .from('friendships')
        .select('id, requester_id, addressee_id, status, created_at')
        .eq('requester_id', user.id)
        .order('created_at', { ascending: false }),
      client
        .from('friendships')
        .select('id, requester_id, addressee_id, status, created_at')
        .eq('addressee_id', user.id)
        .order('created_at', { ascending: false }),
    ]);

    const firstError = sentResult.error ?? receivedResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const rows = [...(sentResult.data ?? []), ...(receivedResult.data ?? [])] as FriendshipRow[];
    const counterpartIds = [...new Set(rows.map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];

    let profileMap = new Map<string, PublicProfile>();
    if (counterpartIds.length > 0) {
      const { data: profiles, error: profilesError } = await client
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', counterpartIds);

      if (profilesError) {
        setError(profilesError.message);
        setLoading(false);
        return;
      }

      profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile as PublicProfile]));
    }

    setRelations(rows.map((row) => ({
      ...row,
      profile: profileMap.get(row.requester_id === user.id ? row.addressee_id : row.requester_id) ?? null,
    })));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void loadRelations();
  }, [loadRelations]);

  const accepted = useMemo(() => relations.filter((item) => item.status === 'accepted'), [relations]);
  const incoming = useMemo(
    () => relations.filter((item) => item.status === 'pending' && item.addressee_id === user?.id),
    [relations, user],
  );
  const outgoing = useMemo(
    () => relations.filter((item) => item.status === 'pending' && item.requester_id === user?.id),
    [relations, user],
  );

  const relationByProfile = useMemo(() => {
    const map = new Map<string, GymbroRelation>();
    relations.forEach((relation) => {
      if (relation.profile) map.set(relation.profile.id, relation);
    });
    return map;
  }, [relations]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!user || user.provider !== 'supabase' || !supabase) return;

    const normalized = query.trim().toLowerCase().replace(/^@/, '');
    if (normalized.length < 3) {
      setError('Escribe al menos 3 caracteres del username.');
      return;
    }

    setSearching(true);
    const { data, error: searchError } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .neq('id', user.id)
      .not('username', 'is', null)
      .ilike('username', `%${normalized}%`)
      .order('username', { ascending: true })
      .limit(12);
    setSearching(false);

    if (searchError) {
      setError(searchError.message);
      return;
    }
    setResults((data ?? []) as PublicProfile[]);
  };

  const perform = async (id: string, action: () => Promise<{ error: { message: string; code?: string } | null }>, success: string) => {
    setActingId(id);
    setError('');
    setMessage('');
    const { error: actionError } = await action();
    setActingId(null);
    if (actionError) {
      setError(actionError.code === '23505' ? 'Ya existe una relación o solicitud con este usuario.' : actionError.message);
      return;
    }
    setMessage(success);
    await loadRelations();
  };

  const sendRequest = async (profileId: string) => {
    if (!user || user.provider !== 'supabase' || !supabase) return;
    const client = supabase;
    await perform(profileId, async () => {
      const { error: insertError } = await client.from('friendships').insert({
        requester_id: user.id,
        addressee_id: profileId,
        status: 'pending',
      });
      return { error: insertError };
    }, 'Solicitud enviada.');
  };

  const acceptRequest = async (friendshipId: string) => {
    if (!user || user.provider !== 'supabase' || !supabase) return;
    const client = supabase;
    await perform(friendshipId, async () => {
      const { error: updateError } = await client
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', friendshipId)
        .eq('addressee_id', user.id)
        .eq('status', 'pending');
      return { error: updateError };
    }, 'Ahora son Gymbros.');
  };

  const deleteRelation = async (friendshipId: string, success: string) => {
    if (!supabase) return;
    const client = supabase;
    await perform(friendshipId, async () => {
      const { error: deleteError } = await client.from('friendships').delete().eq('id', friendshipId);
      return { error: deleteError };
    }, success);
  };

  const renderIdentity = (profile: PublicProfile | null) => {
    const name = profile?.display_name?.trim() || profile?.username || 'Gymbro';
    return (
      <div className="gymbro-identity-v9">
        <div className="gymbro-avatar-v9">
          {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{initials(name)}</span>}
        </div>
        <div>
          <strong>{name}</strong>
          <span>{profile?.username ? `@${profile.username}` : 'Sin username'}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="profile-shell-v9">
      <AppHeader />
      <main className="profile-page-v9 gymbros-page-v9">
        <div className="gymbros-topline-v9">
          <Link className="profile-back-v9" to="/app"><ArrowLeft size={16}/> Volver a entrenar</Link>
          {cloudReady && <button className="gymbro-refresh-v9" type="button" onClick={() => { void loadRelations(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button>}
        </div>

        <section className="profile-hero-v9 gymbros-hero-v9">
          <div className="profile-avatar-v9"><UsersRound size={32}/></div>
          <div>
            <span className="eyebrow">RED SOCIAL DADOFIT</span>
            <h1>Gymbros</h1>
            <p>Encuentra personas, acepta solicitudes y arma tu círculo para los próximos retos.</p>
          </div>
          {cloudReady && <div className="gymbro-total-v9"><strong>{accepted.length}</strong><span>Gymbros</span></div>}
        </section>

        {!cloudReady ? (
          <section className="profile-card-v9 profile-cloud-callout-v9">
            <h2>Necesitas una cuenta cloud</h2>
            <p>La red de Gymbros funciona entre usuarios reales de DadoFit y requiere iniciar sesión con Supabase.</p>
            <Link className="profile-primary-v9" to="/register">Crear cuenta DadoFit</Link>
          </section>
        ) : (
          <>
            {(error || message) && <div className="gymbros-feedback-v9">{error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}</div>}

            <section className="profile-card-v9 gymbro-search-card-v9">
              <div>
                <span className="eyebrow">DESCUBRIR</span>
                <h2>Buscar Gymbro</h2>
                <p>Busca por username para enviar una solicitud.</p>
              </div>
              <form className="gymbro-search-v9" onSubmit={search}>
                <div><span>@</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="gymbronel" autoComplete="off" /></div>
                <button type="submit" disabled={searching}><Search size={17}/>{searching ? 'Buscando…' : 'Buscar'}</button>
              </form>

              {results.length > 0 && (
                <div className="gymbro-search-results-v9">
                  {results.map((profile) => {
                    const relation = relationByProfile.get(profile.id);
                    const isIncoming = relation?.status === 'pending' && relation.addressee_id === user?.id;
                    return (
                      <article className="gymbro-row-v9" key={profile.id}>
                        {renderIdentity(profile)}
                        <div className="gymbro-row-actions-v9">
                          {!relation && <button type="button" onClick={() => { void sendRequest(profile.id); }} disabled={actingId === profile.id}><UserPlus size={16}/> Agregar</button>}
                          {relation?.status === 'accepted' && <span className="gymbro-status-v9 accepted"><Check size={14}/> Gymbro</span>}
                          {relation?.status === 'pending' && !isIncoming && <span className="gymbro-status-v9">Solicitud enviada</span>}
                          {isIncoming && <button type="button" onClick={() => { void acceptRequest(relation.id); }} disabled={actingId === relation.id}><Check size={16}/> Aceptar</button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="gymbros-grid-v9">
              <section className="profile-card-v9">
                <span className="eyebrow">SOLICITUDES</span>
                <h2>Te quieren agregar</h2>
                {loading ? <p className="profile-muted-v9">Cargando…</p> : incoming.length === 0 ? <p className="gymbro-empty-v9">No tienes solicitudes pendientes.</p> : (
                  <div className="gymbro-list-v9">
                    {incoming.map((relation) => (
                      <article className="gymbro-row-v9" key={relation.id}>
                        {renderIdentity(relation.profile)}
                        <div className="gymbro-row-actions-v9">
                          <button type="button" onClick={() => { void acceptRequest(relation.id); }} disabled={actingId === relation.id}><Check size={16}/> Aceptar</button>
                          <button className="secondary" type="button" onClick={() => { void deleteRelation(relation.id, 'Solicitud rechazada.'); }} disabled={actingId === relation.id}><X size={16}/> Rechazar</button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}

                {outgoing.length > 0 && (
                  <div className="gymbro-outgoing-v9">
                    <h3>Enviadas</h3>
                    {outgoing.map((relation) => (
                      <article className="gymbro-row-v9" key={relation.id}>
                        {renderIdentity(relation.profile)}
                        <button className="gymbro-text-action-v9" type="button" onClick={() => { void deleteRelation(relation.id, 'Solicitud cancelada.'); }} disabled={actingId === relation.id}>Cancelar</button>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section className="profile-card-v9">
                <span className="eyebrow">TU RED</span>
                <h2>Mis Gymbros</h2>
                {loading ? <p className="profile-muted-v9">Cargando…</p> : accepted.length === 0 ? <div className="gymbro-empty-v9"><UsersRound size={28}/><p>Aún no tienes Gymbros. Busca el username de alguien y envíale tu primera solicitud.</p></div> : (
                  <div className="gymbro-list-v9">
                    {accepted.map((relation) => (
                      <article className="gymbro-row-v9" key={relation.id}>
                        {renderIdentity(relation.profile)}
                        <button className="gymbro-text-action-v9 danger" type="button" onClick={() => { void deleteRelation(relation.id, 'Gymbro eliminado.'); }} disabled={actingId === relation.id}><UserMinus size={15}/> Eliminar</button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
