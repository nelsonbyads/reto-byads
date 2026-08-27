import { Building2, Check, Swords, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';
import type { AppExercise, DiceLevel } from '../types/exercise';

interface Props { exercise: AppExercise; reps: number; diceLevel: DiceLevel; }

export function OrganizationChallengeButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const title = useMemo(() => `${reps}× ${exercise.name}`, [exercise.name, reps]);
  const canManage = user?.provider === 'supabase' && activeWorkspace.kind === 'gym' && Boolean(activeWorkspace.organizationId) && ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');

  const close = () => { if (!sending) { setOpen(false); setError(''); setSent(false); } };
  const publish = async () => {
    if (!supabase || !activeWorkspace.organizationId || !canManage) return;
    setSending(true); setError('');
    const { error: rpcError } = await supabase.rpc('create_organization_challenge', {
      p_organization_id: activeWorkspace.organizationId,
      p_exercise_id: exercise.id,
      p_exercise_name: exercise.name,
      p_reps: reps,
      p_dice_level: diceLevel,
    });
    setSending(false);
    if (rpcError) { setError(rpcError.message); return; }
    setSent(true);
  };

  if (!canManage) return null;

  return <>
    <button className="organization-challenge-trigger-v12" type="button" onClick={() => setOpen(true)}><Building2 size={18}/> Reto de mi Gym</button>
    {open && <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="challenge-modal-v10 organization-challenge-modal-v12" role="dialog" aria-modal="true"><button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>
      {sent ? <div className="challenge-success-v10"><div className="challenge-success-icon-v10"><Check size={28}/></div><span className="eyebrow">RETO PUBLICADO</span><h2>{activeWorkspace.label} ya tiene un nuevo reto.</h2><p>{title}</p><div className="organization-reward-v12"><span>Por miembro aprobado</span><strong>Hasta +25 DC · +50 XP · +100 Sponsor Points</strong></div><div className="challenge-modal-actions-v10"><Link to="/organization-challenges">Ver retos del Gym</Link><button type="button" onClick={close}>Cerrar</button></div></div> : <><div className="challenge-modal-heading-v10"><span className="eyebrow">WORKSPACE GYM</span><h2>Publicar reto en {activeWorkspace.label}</h2><p>{title}</p></div><div className="challenge-summary-v10"><div><span>Ejercicio</span><strong>{exercise.name}</strong></div><div><span>Repeticiones</span><strong>{reps}</strong></div><div><span>Duración</span><strong>72 h</strong></div><div><span>Por aprobación</span><strong>100 SP</strong></div></div>{error && <div className="auth-error">{error}</div>}<button className="gym-battle-send-v121" type="button" onClick={() => { void publish(); }} disabled={sending}><Swords size={15}/>{sending ? 'Publicando…' : `Publicar en ${activeWorkspace.label}`}</button><p className="organization-policy-note-v12">Solo estás operando sobre el Gym seleccionado en el workspace.</p></>}
    </section></div>}
  </>;
}
