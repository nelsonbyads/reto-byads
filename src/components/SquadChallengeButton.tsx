import { Check, Shield, Swords, UsersRound, X } from 'lucide-react';
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

interface SquadRow {
  id: string;
  name: string;
  slug: string;
  visibility: 'private' | 'public';
  owner_user_id: string;
}

interface MembershipRow {
  group_id: string;
  role: 'owner' | 'admin' | 'member';
  status: string;
}

export function SquadChallengeButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [mySquads, setMySquads] = useState<SquadRow[]>([]);
  const [opponents, setOpponents] = useState<SquadRow[]>([]);
  const [challengerId, setChallengerId] = useState('');
  const [opponentId, setOpponentId] = useState('');
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
      setSentBattleId(null);

      const { data: memberships, error: membershipError } = await client
        .from('group_members')
        .select('group_id, role, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .in('role', ['owner', 'admin']);

      if (!active) return;
      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      const rows = (memberships ?? []) as MembershipRow[];
      const adminIds = rows.map((row) => row.group_id);
      let mine: SquadRow[] = [];

      if (adminIds.length > 0) {
        const { data, error: squadError } = await client
          .from('groups')
          .select('id, name, slug, visibility, owner_user_id')
          .in('id', adminIds)
          .order('name');

        if (!active) return;
        if (squadError) {
          setError(squadError.message);
          setLoading(false);
          return;
        }
        mine = (data ?? []) as SquadRow[];
      }

      const { data: publicGroups, error: publicError } = await client
        .from('groups')
        .select('id, name, slug, visibility, owner_user_id')
        .eq('visibility', 'public')
        .order('name')
        .limit(100);

      if (!active) return;
      if (publicError) {
        setError(publicError.message);
        setLoading(false);
        return;
      }

      const myIds = new Set(adminIds);
      const available = ((publicGroups ?? []) as SquadRow[]).filter((group) => !myIds.has(group.id));
      setMySquads(mine);
      setOpponents(available);
      setChallengerId((current) => current && mine.some((item) => item.id === current) ? current : (mine[0]?.id ?? ''));
      setOpponentId((current) => current && available.some((item) => item.id === current) ? current : (available[0]?.id ?? ''));
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

  const sendBattle = async () => {
    if (!supabase || !user || user.provider !== 'supabase' || !challengerId || !opponentId) return;
    const client = supabase;
    setSending(true);
    setError('');

    const { data, error: rpcError } = await client.rpc('create_group_challenge', {
      p_challenger_group_id: challengerId,
      p_challenged_group_id: opponentId,
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
    setSentBattleId(String(data ?? 'created'));
  };

  if (!cloudReady) return null;

  const challenger = mySquads.find((item) => item.id === challengerId);
  const opponent = opponents.find((item) => item.id === opponentId);

  return (
    <>
      <button className="squad-challenge-trigger-v11" type="button" onClick={() => setOpen(true)}>
        <Shield size={18}/>
        Retar con mi Squad
      </button>

      {open && (
        <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="challenge-modal-v10 squad-challenge-modal-v11" role="dialog" aria-modal="true" aria-labelledby="squad-challenge-title">
            <button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>

            {sentBattleId ? (
              <div className="challenge-success-v10">
                <div className="challenge-success-icon-v10"><Check size={28}/></div>
                <span className="eyebrow">BATALLA ENVIADA</span>
                <h2>{challenger?.name ?? 'Tu Squad'} retó a {opponent?.name ?? 'otro Squad'}.</h2>
                <p>{title}</p>
                <div className="squad-battle-reward-v11">
                  <strong>Por cada miembro aprobado</strong>
                  <span>+25 DC · +50 XP · +100 Team Points</span>
                </div>
                <div className="challenge-modal-actions-v10">
                  <Link to="/squads">Ir a Squads</Link>
                  <button type="button" onClick={close}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="challenge-modal-heading-v10">
                  <span className="eyebrow">SQUAD VS SQUAD</span>
                  <h2 id="squad-challenge-title">Convierte esta tirada en una batalla.</h2>
                  <p>{title}</p>
                </div>

                <div className="challenge-summary-v10">
                  <div><span>Ejercicio</span><strong>{exercise.name}</strong></div>
                  <div><span>Repeticiones</span><strong>{reps}</strong></div>
                  <div><span>Batalla</span><strong>72 h</strong></div>
                  <div><span>Por aprobación</span><strong>100 TP</strong></div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                {loading ? (
                  <div className="challenge-modal-empty-v10">Cargando Squads…</div>
                ) : mySquads.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <UsersRound size={28}/>
                    <strong>Necesitas ser capitán de un Squad.</strong>
                    <p>Crea un Squad o conviértete en administrador para iniciar batallas.</p>
                    <Link to="/squads">Crear mi Squad</Link>
                  </div>
                ) : opponents.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <Swords size={28}/>
                    <strong>No hay otro Squad público disponible.</strong>
                    <p>Cuando exista otro Squad público podrás retarlo desde esta tirada.</p>
                    <Link to="/squads">Ver Squads</Link>
                  </div>
                ) : (
                  <div className="squad-challenge-form-v11">
                    <label>
                      Mi Squad
                      <select value={challengerId} onChange={(event) => setChallengerId(event.target.value)}>
                        {mySquads.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                    </label>
                    <div className="squad-versus-v11"><span>{challenger?.name ?? 'Mi Squad'}</span><Swords size={22}/><span>{opponent?.name ?? 'Rival'}</span></div>
                    <label>
                      Squad rival
                      <select value={opponentId} onChange={(event) => setOpponentId(event.target.value)}>
                        {opponents.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                      </select>
                    </label>
                    <button className="squad-send-battle-v11" type="button" onClick={() => { void sendBattle(); }} disabled={sending || !challengerId || !opponentId}>
                      <Swords size={18}/>{sending ? 'Enviando batalla…' : 'Retar Squad'}
                    </button>
                    <small>El Squad rival tendrá 24 horas para aceptar. Al aceptar, la batalla dura 72 horas.</small>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
