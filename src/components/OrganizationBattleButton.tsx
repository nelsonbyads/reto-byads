import { Building2, Check, Swords, Trophy, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import type { AppExercise, DiceLevel } from '../types/exercise';

interface Props {
  exercise: AppExercise;
  reps: number;
  diceLevel: DiceLevel;
}

interface MembershipRow {
  organization_id: string;
  role: 'owner' | 'admin' | 'coach' | 'member';
  status: string;
}

interface GymRow {
  id: string;
  name: string;
  organization_type: string;
  country_code: string | null;
}

export function OrganizationBattleButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [managedGyms, setManagedGyms] = useState<GymRow[]>([]);
  const [rivalGyms, setRivalGyms] = useState<GymRow[]>([]);
  const [challengerId, setChallengerId] = useState('');
  const [rivalId, setRivalId] = useState('');
  const [sentBattleId, setSentBattleId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);
  const title = useMemo(() => `${reps}× ${exercise.name}`, [exercise.name, reps]);

  useEffect(() => {
    if (!open || !cloudReady || !user || !supabase) return;
    const client = supabase;
    let active = true;

    const load = async () => {
      setLoading(true);
      setError('');
      const { data: memberships, error: membershipError } = await client
        .from('organization_members')
        .select('organization_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (!active) return;
      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      const membershipRows = (memberships ?? []) as MembershipRow[];
      const allMembershipIds = membershipRows.map((item) => item.organization_id);
      const managedIds = membershipRows.filter((item) => ['owner', 'admin', 'coach'].includes(item.role)).map((item) => item.organization_id);
      const [ownResult, rivalsResult] = await Promise.all([
        managedIds.length
          ? client.from('organizations').select('id, name, organization_type, country_code').in('id', managedIds).eq('organization_type', 'gym').order('name')
          : Promise.resolve({ data: [] as GymRow[], error: null }),
        client.from('organizations').select('id, name, organization_type, country_code').eq('organization_type', 'gym').order('name'),
      ]);

      if (!active) return;
      const queryError = ownResult.error ?? rivalsResult.error;
      if (queryError) {
        setError(queryError.message);
        setLoading(false);
        return;
      }

      const own = (ownResult.data ?? []) as GymRow[];
      const unavailableIds = new Set(allMembershipIds);
      const rivals = ((rivalsResult.data ?? []) as GymRow[]).filter((item) => !unavailableIds.has(item.id));
      setManagedGyms(own);
      setRivalGyms(rivals);
      setChallengerId((current) => current || own[0]?.id || '');
      setRivalId((current) => current || rivals[0]?.id || '');
      setLoading(false);
    };

    void load();
    return () => { active = false; };
  }, [open, cloudReady, user]);

  const close = () => {
    if (sending) return;
    setOpen(false);
    setError('');
    setSentBattleId(null);
  };

  const createBattle = async () => {
    if (!supabase || !challengerId || !rivalId) return;
    setSending(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('create_organization_battle', {
      p_challenger_organization_id: challengerId,
      p_challenged_organization_id: rivalId,
      p_exercise_id: exercise.id,
      p_exercise_name: exercise.name,
      p_reps: reps,
      p_dice_level: diceLevel,
    });
    setSending(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSentBattleId(String(data ?? ''));
  };

  if (!cloudReady) return null;

  return (
    <>
      <button className="gym-battle-trigger-v121" type="button" onClick={() => setOpen(true)}>
        <Trophy size={18}/>
        Gym vs Gym
      </button>

      {open && (
        <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="challenge-modal-v10 gym-battle-modal-v121" role="dialog" aria-modal="true" aria-labelledby="gym-battle-title">
            <button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>

            {sentBattleId ? (
              <div className="challenge-success-v10">
                <div className="challenge-success-icon-v10"><Check size={28}/></div>
                <span className="eyebrow">BATALLA ENVIADA</span>
                <h2>El Gym rival tiene 24 horas para responder.</h2>
                <p>{title}</p>
                <div className="gym-battle-reward-v121">
                  <span>Por participante aprobado</span>
                  <strong>Hasta +25 DC · +50 XP · +100 Sponsor Points</strong>
                </div>
                <div className="challenge-modal-actions-v10">
                  <Link to="/gym-battles">Ver batalla</Link>
                  <button type="button" onClick={close}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="challenge-modal-heading-v10">
                  <span className="eyebrow">GYM VS GYM</span>
                  <h2 id="gym-battle-title">Convierte esta tirada en una batalla</h2>
                  <p>{title}</p>
                </div>

                <div className="challenge-summary-v10">
                  <div><span>Ejercicio</span><strong>{exercise.name}</strong></div>
                  <div><span>Repeticiones</span><strong>{reps}</strong></div>
                  <div><span>Respuesta rival</span><strong>24 h</strong></div>
                  <div><span>Batalla</span><strong>72 h</strong></div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                {loading ? (
                  <div className="challenge-modal-empty-v10">Cargando Gyms…</div>
                ) : managedGyms.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <Building2 size={28}/>
                    <strong>No administras ningún Gym.</strong>
                    <p>Necesitas ser owner, admin o coach de una organización tipo Gym.</p>
                    <Link to="/organizations">Ir a Organizations</Link>
                  </div>
                ) : rivalGyms.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <Swords size={28}/>
                    <strong>No hay otro Gym disponible todavía.</strong>
                    <p>Crea o invita otro Gym al ecosistema para poder competir.</p>
                  </div>
                ) : (
                  <div className="gym-battle-picker-v121">
                    <label>
                      Mi Gym
                      <select value={challengerId} onChange={(event) => setChallengerId(event.target.value)}>
                        {managedGyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}</option>)}
                      </select>
                    </label>
                    <div className="gym-battle-vs-v121"><Swords size={18}/><span>VS</span></div>
                    <label>
                      Gym rival
                      <select value={rivalId} onChange={(event) => setRivalId(event.target.value)}>
                        {rivalGyms.map((gym) => <option key={gym.id} value={gym.id}>{gym.name}{gym.country_code ? ` · ${gym.country_code}` : ''}</option>)}
                      </select>
                    </label>
                    <button className="gym-battle-send-v121" type="button" onClick={() => { void createBattle(); }} disabled={sending || !challengerId || !rivalId}>
                      <Trophy size={17}/>{sending ? 'Enviando…' : 'Retar Gym'}
                    </button>
                  </div>
                )}

                <p className="organization-policy-note-v12">Los rosters se congelan al aceptar. La evidencia es obligatoria y un manager del Gym rival revisa cada aporte.</p>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
