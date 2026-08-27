import { Building2, Check, Swords, Trophy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';
import type { AppExercise, DiceLevel } from '../types/exercise';

interface Props { exercise: AppExercise; reps: number; diceLevel: DiceLevel; }
interface GymRow { id: string; name: string; organization_type: string; country_code: string | null; }
interface MembershipRow { organization_id: string; status: string; }

export function OrganizationBattleButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [rivalGyms, setRivalGyms] = useState<GymRow[]>([]);
  const [rivalId, setRivalId] = useState('');
  const [sentBattleId, setSentBattleId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const title = useMemo(() => `${reps}× ${exercise.name}`, [exercise.name, reps]);
  const canManage = user?.provider === 'supabase' && activeWorkspace.kind === 'gym' && Boolean(activeWorkspace.organizationId) && ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');

  useEffect(() => {
    if (!open || !canManage || !user || !supabase || !activeWorkspace.organizationId) return;
    const client = supabase;
    let active = true;
    const load = async () => {
      setLoading(true); setError('');
      const [membershipsResult, rivalsResult] = await Promise.all([
        client.from('organization_members').select('organization_id, status').eq('user_id', user.id).eq('status', 'active'),
        client.from('organizations').select('id, name, organization_type, country_code').eq('organization_type', 'gym').order('name'),
      ]);
      if (!active) return;
      const queryError = membershipsResult.error ?? rivalsResult.error;
      if (queryError) { setError(queryError.message); setLoading(false); return; }
      const unavailableIds = new Set(((membershipsResult.data ?? []) as MembershipRow[]).map((item) => item.organization_id));
      unavailableIds.add(activeWorkspace.organizationId!);
      const rivals = ((rivalsResult.data ?? []) as GymRow[]).filter((item) => !unavailableIds.has(item.id));
      setRivalGyms(rivals);
      setRivalId((current) => rivals.some((item) => item.id === current) ? current : rivals[0]?.id ?? '');
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [activeWorkspace.organizationId, canManage, open, user]);

  const close = () => { if (!sending) { setOpen(false); setError(''); setSentBattleId(null); } };
  const createBattle = async () => {
    if (!supabase || !activeWorkspace.organizationId || !rivalId || !canManage) return;
    setSending(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('create_organization_battle', {
      p_challenger_organization_id: activeWorkspace.organizationId,
      p_challenged_organization_id: rivalId,
      p_exercise_id: exercise.id,
      p_exercise_name: exercise.name,
      p_reps: reps,
      p_dice_level: diceLevel,
    });
    setSending(false);
    if (rpcError) { setError(rpcError.message); return; }
    setSentBattleId(String(data ?? ''));
  };

  if (!canManage) return null;

  return <>
    <button className="gym-battle-trigger-v121" type="button" onClick={() => setOpen(true)}><Trophy size={18}/> Gym vs Gym</button>
    {open && <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="challenge-modal-v10 gym-battle-modal-v121" role="dialog" aria-modal="true"><button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>
      {sentBattleId ? <div className="challenge-success-v10"><div className="challenge-success-icon-v10"><Check size={28}/></div><span className="eyebrow">BATALLA ENVIADA</span><h2>El Gym rival tiene 24 horas para responder.</h2><p>{title}</p><div className="gym-battle-reward-v121"><span>Por participante aprobado</span><strong>Hasta +25 DC · +50 XP · +100 Sponsor Points</strong></div><div className="challenge-modal-actions-v10"><Link to="/gym-battles">Ver batalla</Link><button type="button" onClick={close}>Cerrar</button></div></div> : <><div className="challenge-modal-heading-v10"><span className="eyebrow">GYM VS GYM</span><h2>{activeWorkspace.label} reta desde su workspace</h2><p>{title}</p></div><div className="challenge-summary-v10"><div><span>Mi Gym</span><strong>{activeWorkspace.label}</strong></div><div><span>Ejercicio</span><strong>{exercise.name}</strong></div><div><span>Respuesta rival</span><strong>24 h</strong></div><div><span>Batalla</span><strong>72 h</strong></div></div>{error && <div className="auth-error">{error}</div>}{loading ? <div className="challenge-modal-empty-v10">Cargando Gyms…</div> : rivalGyms.length === 0 ? <div className="challenge-modal-empty-v10"><Building2 size={28}/><strong>No hay otro Gym disponible.</strong><p>El rival no puede ser otro Gym al que tú también pertenezcas.</p></div> : <div className="gym-battle-picker-v121"><label>Gym rival<select value={rivalId} onChange={(event) => setRivalId(event.target.value)}>{rivalGyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}{gym.country_code ? ` · ${gym.country_code}` : ''}</option>)}</select></label><button className="gym-battle-send-v121" type="button" onClick={() => { void createBattle(); }} disabled={sending || !rivalId}><Swords size={17}/>{sending ? 'Enviando…' : 'Retar Gym'}</button></div>}<p className="organization-policy-note-v12">El Gym challenger queda fijado por el workspace activo; no puedes operar en nombre de otra organización desde aquí.</p></>}
    </section></div>}
  </>;
}
