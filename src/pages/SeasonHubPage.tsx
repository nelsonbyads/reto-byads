import { Building2, CalendarDays, Check, Clock3, RefreshCw, Shield, Sparkles, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { ChallengeCenterNav } from '../components/ChallengeCenterNav';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';

type RankRow = { id: string; name: string; points: number; completed?: number };
type Season = { id: string; name: string; status: string; starts_at: string; ends_at: string; season_type: string; leaderboard: RankRow[] };
type SponsoredEntry = { organization_id: string; organization_name: string; status: string; points: number };
type SponsoredSeason = { id: string; name: string; description?: string | null; status: string; starts_at: string; ends_at: string; sponsor_name: string; entries: SponsoredEntry[]; leaderboard: RankRow[] };
type GymInvite = SponsoredSeason & { entry_status: string; my_points: number };
type SeasonHistory = Pick<Season, 'id' | 'name' | 'status' | 'starts_at' | 'ends_at' | 'season_type'>;
type HubData = { squad: Season | null; gym: Season | null; sponsored_gym: SponsoredSeason[]; history: SeasonHistory[] };

const EMPTY: HubData = { squad: null, gym: null, sponsored_gym: [], history: [] };
const fmt = (value: number) => new Intl.NumberFormat('es-CO').format(Number(value || 0));
const date = (value: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));

function statusLabel(status: string) {
  if (status === 'active') return 'En curso';
  if (status === 'upcoming') return 'Próxima';
  if (status === 'completed') return 'Finalizada';
  if (status === 'cancelled') return 'Cancelada';
  return status;
}

function Leaderboard({ rows, unit }: { rows: RankRow[]; unit: 'TP' | 'GP' }) {
  if (!rows.length) return <div className="season-empty-v157">Aún no hay puntos registrados en esta temporada.</div>;
  return <div className="season-ranking-v157">{rows.slice(0, 10).map((row, index) => <article key={row.id}><span className="season-rank-v157">#{index + 1}</span><div><strong>{row.name}</strong><small>{row.completed ? `${fmt(row.completed)} aportes puntuados` : unit === 'GP' ? 'Gym' : 'Squad'}</small></div><b>{fmt(row.points)} {unit}</b></article>)}</div>;
}

function SeasonCard({ season, unit, icon }: { season: Season | null; unit: 'TP' | 'GP'; icon: 'squad' | 'gym' }) {
  return <section className="profile-card-v9 season-card-v157">
    <header><div className="season-icon-v157">{icon === 'squad' ? <Shield size={22}/> : <Building2 size={22}/>}</div><div><span className="eyebrow">{unit === 'TP' ? 'TEMPORADA SQUAD' : 'TEMPORADA GYM'}</span><h2>{season?.name ?? 'Sin temporada activa'}</h2>{season && <p>{date(season.starts_at)} → {date(season.ends_at)}</p>}</div>{season && <span className={`season-status-v157 ${season.status}`}>{statusLabel(season.status)}</span>}</header>
    {season ? <Leaderboard rows={season.leaderboard ?? []} unit={unit}/> : <div className="season-empty-v157">SuperAdmin todavía no ha configurado una temporada.</div>}
  </section>;
}

export function SeasonHubPage() {
  const { activeWorkspace } = useWorkspace();
  const [hub, setHub] = useState<HubData>(EMPTY);
  const [invites, setInvites] = useState<GymInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  const gym = activeWorkspace.kind === 'gym';
  const canRespond = gym && (activeWorkspace.role === 'owner' || activeWorkspace.role === 'admin');

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError('');
    const hubResult = await supabase.rpc('get_season_hub');
    if (hubResult.error) { setError(hubResult.error.message); setLoading(false); return; }
    setHub((hubResult.data ?? EMPTY) as HubData);
    if (gym && activeWorkspace.organizationId) {
      const inviteResult = await supabase.rpc('get_my_sponsored_gym_invitations', { p_organization_id: activeWorkspace.organizationId });
      if (inviteResult.error) setError(inviteResult.error.message);
      else setInvites((inviteResult.data ?? []) as GymInvite[]);
    } else setInvites([]);
    setLoading(false);
  }, [activeWorkspace.organizationId, gym]);

  useEffect(() => { void load(); }, [load]);

  const pending = useMemo(() => invites.filter((item) => item.entry_status === 'invited'), [invites]);

  const respond = async (item: GymInvite, accept: boolean) => {
    if (!supabase || !activeWorkspace.organizationId || !canRespond) return;
    setActing(item.id); setError('');
    const { error: rpcError } = await supabase.rpc('respond_sponsored_gym_competition', { p_season_id: item.id, p_organization_id: activeWorkspace.organizationId, p_accept: accept });
    setActing('');
    if (rpcError) { setError(rpcError.message); return; }
    await load();
  };

  return <div className="profile-shell-v9 season-shell-v157"><AppHeader/>{!gym && <div className="challenge-center-shell-v1577"><ChallengeCenterNav/></div>}<main className={`profile-page-v9 season-page-v157${!gym ? ' challenge-center-main-v1577' : ''}`}>
    <section className="season-hero-v157"><div><span className="eyebrow">COMPETENCIA DADOFIT</span><h1>{gym ? `Temporadas de ${activeWorkspace.label}` : 'Temporadas, rankings y competencias'}</h1><p>Los TP pertenecen a Squads. Los GP pertenecen a Gyms. Cerrar una temporada conserva todo el histórico: no se borra el ledger.</p></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15}/>{loading ? 'Cargando…' : 'Actualizar'}</button></section>
    {error && <div className="auth-error">{error}</div>}

    {gym && pending.length > 0 && <section className="season-invites-v157"><div className="season-section-title-v157"><div><span className="eyebrow">INVITACIONES</span><h2>Competencias patrocinadas pendientes</h2></div><b>{pending.length}</b></div>{pending.map((item) => <article key={item.id}><div><Sparkles size={20}/><span><strong>{item.name}</strong><small>{item.sponsor_name} · {date(item.starts_at)} → {date(item.ends_at)}</small>{item.description && <p>{item.description}</p>}</span></div>{canRespond ? <footer><button type="button" className="decline" onClick={() => void respond(item, false)} disabled={acting === item.id}><X size={14}/> Rechazar</button><button type="button" onClick={() => void respond(item, true)} disabled={acting === item.id}><Check size={14}/> Aceptar</button></footer> : <small>Owner/Admin debe responder la invitación.</small>}</article>)}</section>}

    <section className="season-grid-v157"><SeasonCard season={hub.squad} unit="TP" icon="squad"/><SeasonCard season={hub.gym} unit="GP" icon="gym"/></section>

    {hub.history.length > 0 && <section className="profile-card-v9 season-history-v157"><div className="season-section-title-v157"><div><span className="eyebrow">HISTÓRICO</span><h2>Temporadas cerradas</h2><p>Los puntos anteriores se conservan; una nueva temporada no borra el ledger.</p></div><CalendarDays size={21}/></div><div>{hub.history.map((item) => <article key={item.id}><span className="season-history-icon-v157">{item.season_type === 'gym' ? <Building2 size={16}/> : <Shield size={16}/>}</span><div><strong>{item.name}</strong><small>{item.season_type === 'gym' ? 'Gym · GP' : 'Squad · TP'} · {date(item.starts_at)} → {date(item.ends_at)}</small></div><span className="season-status-v157 completed">Finalizada</span></article>)}</div></section>}

    <section className="profile-card-v9 sponsored-seasons-v157"><div className="season-section-title-v157"><div><span className="eyebrow">SPONSORED GYM COMPETITIONS</span><h2>Competencias patrocinadas</h2><p>El ranking usa los GP obtenidos durante la ventana de cada activación.</p></div><Sparkles size={22}/></div>{hub.sponsored_gym.length === 0 ? <div className="season-empty-v157">Todavía no hay competencias patrocinadas publicadas.</div> : <div className="sponsored-season-list-v157">{hub.sponsored_gym.map((item) => <article key={item.id}><header><div><strong>{item.name}</strong><span>{item.sponsor_name}</span></div><span className={`season-status-v157 ${item.status}`}>{statusLabel(item.status)}</span></header>{item.description && <p>{item.description}</p>}<div className="sponsored-season-meta-v157"><span><CalendarDays size={14}/>{date(item.starts_at)} → {date(item.ends_at)}</span><span><Trophy size={14}/>{item.entries?.filter((entry) => entry.status === 'active').length ?? 0} Gyms activos</span><span><Clock3 size={14}/>Puntúa con GP del periodo</span></div><Leaderboard rows={item.leaderboard ?? []} unit="GP"/></article>)}</div>}</section>
  </main></div>;
}
