import { Check, Flame, Swords, UserRound, X } from 'lucide-react';
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

interface FriendshipRow {
  requester_id: string;
  addressee_id: string;
  status: string;
}

interface GymbroProfile {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DF';
}

export function ChallengeGymbroButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [gymbros, setGymbros] = useState<GymbroProfile[]>([]);
  const [sentTo, setSentTo] = useState<GymbroProfile | null>(null);
  const [error, setError] = useState('');

  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);
  const title = useMemo(() => `${reps}× ${exercise.name}`, [exercise.name, reps]);

  useEffect(() => {
    if (!open || !cloudReady || !user || !supabase) return;
    const client = supabase;
    let active = true;

    const loadGymbros = async () => {
      setLoading(true);
      setError('');
      const [sent, received] = await Promise.all([
        client.from('friendships').select('requester_id, addressee_id, status').eq('requester_id', user.id).eq('status', 'accepted'),
        client.from('friendships').select('requester_id, addressee_id, status').eq('addressee_id', user.id).eq('status', 'accepted'),
      ]);

      if (!active) return;
      const relationError = sent.error ?? received.error;
      if (relationError) {
        setError(relationError.message);
        setLoading(false);
        return;
      }

      const rows = [...(sent.data ?? []), ...(received.data ?? [])] as FriendshipRow[];
      const ids = [...new Set(rows.map((row) => row.requester_id === user.id ? row.addressee_id : row.requester_id))];
      if (ids.length === 0) {
        setGymbros([]);
        setLoading(false);
        return;
      }

      const { data, error: profilesError } = await client
        .from('profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', ids)
        .order('display_name', { ascending: true });

      if (!active) return;
      if (profilesError) setError(profilesError.message);
      else setGymbros((data ?? []) as GymbroProfile[]);
      setLoading(false);
    };

    void loadGymbros();
    return () => { active = false; };
  }, [open, cloudReady, user]);

  const close = () => {
    if (sendingId) return;
    setOpen(false);
    setError('');
    setSentTo(null);
  };

  const sendChallenge = async (gymbro: GymbroProfile) => {
    if (!supabase || !user || user.provider !== 'supabase') return;
    const client = supabase;
    setSendingId(gymbro.id);
    setError('');

    const { error: rpcError } = await client.rpc('create_direct_challenge', {
      p_recipient_id: gymbro.id,
      p_exercise_id: exercise.id,
      p_exercise_name: exercise.name,
      p_reps: reps,
      p_dice_level: diceLevel,
    });

    setSendingId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setSentTo(gymbro);
  };

  if (!cloudReady) return null;

  return (
    <>
      <button className="challenge-trigger-v10" type="button" onClick={() => setOpen(true)}>
        <Swords size={18}/>
        Retar a un Gymbro
      </button>

      {open && (
        <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="challenge-modal-v10" role="dialog" aria-modal="true" aria-labelledby="challenge-modal-title">
            <button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>

            {sentTo ? (
              <div className="challenge-success-v10">
                <div className="challenge-success-icon-v10"><Check size={28}/></div>
                <span className="eyebrow">RETO ENVIADO</span>
                <h2>Ahora le toca a {sentTo.display_name || sentTo.username || 'tu Gymbro'}.</h2>
                <p>{title}</p>
                <div className="challenge-reward-v10"><Flame size={18}/><span>Si lo completa y apruebas su evidencia:</span><strong>+25 DC · +50 XP</strong></div>
                <div className="challenge-modal-actions-v10">
                  <Link to="/challenges">Ver mis retos</Link>
                  <button type="button" onClick={close}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="challenge-modal-heading-v10">
                  <span className="eyebrow">RETO 1 VS 1</span>
                  <h2 id="challenge-modal-title">¿A quién le mandamos esta tirada?</h2>
                  <p>{title}</p>
                </div>

                <div className="challenge-summary-v10">
                  <div><span>Ejercicio</span><strong>{exercise.name}</strong></div>
                  <div><span>Repeticiones</span><strong>{reps}</strong></div>
                  <div><span>Tiempo</span><strong>48 h</strong></div>
                  <div><span>Recompensa</span><strong>25 DC + 50 XP</strong></div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                {loading ? (
                  <div className="challenge-modal-empty-v10">Cargando tus Gymbros…</div>
                ) : gymbros.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <UserRound size={28}/>
                    <strong>Aún no tienes Gymbros disponibles.</strong>
                    <p>Agrega a alguien primero para poder enviarle un reto.</p>
                    <Link to="/gymbros">Ir a Gymbros</Link>
                  </div>
                ) : (
                  <div className="challenge-gymbro-list-v10">
                    {gymbros.map((gymbro) => {
                      const name = gymbro.display_name?.trim() || gymbro.username || 'Gymbro';
                      return (
                        <article key={gymbro.id} className="challenge-gymbro-row-v10">
                          <div className="challenge-gymbro-avatar-v10">
                            {gymbro.avatar_url ? <img src={gymbro.avatar_url} alt=""/> : <span>{initials(name)}</span>}
                          </div>
                          <div className="challenge-gymbro-copy-v10">
                            <strong>{name}</strong>
                            <span>{gymbro.username ? `@${gymbro.username}` : 'Gymbro DadoFit'}</span>
                          </div>
                          <button type="button" onClick={() => { void sendChallenge(gymbro); }} disabled={Boolean(sendingId)}>
                            <Swords size={16}/>{sendingId === gymbro.id ? 'Enviando…' : 'Retar'}
                          </button>
                        </article>
                      );
                    })}
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
