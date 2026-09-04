import { Building2, Check, Coins, Swords, Trophy, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { supabase } from '../lib/supabase';
import type { AppExercise, DiceLevel } from '../types/exercise';

interface Props { exercise: AppExercise; reps: number; diceLevel: DiceLevel; }

const clampInt = (value: string, min: number, max: number) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
};

export function OrganizationChallengeButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [rewardCoins, setRewardCoins] = useState(25);
  const [rewardXp, setRewardXp] = useState(50);
  const [gymPoints, setGymPoints] = useState(100);
  const title = useMemo(() => `${reps}× ${exercise.name}`, [exercise.name, reps]);
  const canManage = user?.provider === 'supabase' && activeWorkspace.kind === 'gym' && Boolean(activeWorkspace.organizationId) && ['owner', 'admin', 'coach'].includes(activeWorkspace.role ?? '');

  const close = () => {
    if (!sending) {
      setOpen(false);
      setError('');
      setSent(false);
    }
  };

  const publish = async () => {
    if (!supabase || !activeWorkspace.organizationId || !canManage) return;
    setSending(true);
    setError('');
    const { error: rpcError } = await supabase.rpc('create_organization_challenge', {
      p_organization_id: activeWorkspace.organizationId,
      p_exercise_id: exercise.id,
      p_exercise_name: exercise.name,
      p_reps: reps,
      p_dice_level: diceLevel,
      p_reward_coins: rewardCoins,
      p_reward_xp: rewardXp,
      p_gym_points: gymPoints,
    });
    setSending(false);
    if (rpcError) { setError(rpcError.message); return; }
    setSent(true);
  };

  if (!canManage) return null;

  return <>
    <button className="organization-challenge-trigger-v12" type="button" onClick={() => setOpen(true)}><Building2 size={18}/> Reto de mi Gym</button>
    {open && <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="challenge-modal-v10 organization-challenge-modal-v12 organization-challenge-modal-v153" role="dialog" aria-modal="true"><button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>
      {sent ? <div className="challenge-success-v10"><div className="challenge-success-icon-v10"><Check size={28}/></div><span className="eyebrow">RETO PUBLICADO</span><h2>{activeWorkspace.label} ya tiene un nuevo reto.</h2><p>{title}</p><div className="organization-reward-v12"><span>Recompensa potencial por miembro aprobado</span><strong>+{rewardCoins} DC · +{rewardXp} XP · +{gymPoints} GP</strong></div><p className="organization-policy-note-v12">La recompensa solo se entrega si el participante es elegible según las reglas anti-farming.</p><div className="challenge-modal-actions-v10"><Link to="/organization-challenges">Ver retos del Gym</Link><button type="button" onClick={close}>Cerrar</button></div></div> : <><div className="challenge-modal-heading-v10"><span className="eyebrow">WORKSPACE GYM</span><h2>Publicar reto en {activeWorkspace.label}</h2><p>{title}</p></div><div className="challenge-summary-v10"><div><span>Ejercicio</span><strong>{exercise.name}</strong></div><div><span>Repeticiones</span><strong>{reps}</strong></div><div><span>Duración</span><strong>72 h</strong></div><div><span>Política</span><strong>Anti-farming</strong></div></div>

        <div className="gym-reward-config-v153">
          <div className="gym-reward-config-head-v153"><div><span className="eyebrow">RECOMPENSA DEL RETO</span><h3>Define qué puede ganar cada miembro</h3></div><small>Valores máximos controlados por DadoFit</small></div>
          <div className="gym-reward-fields-v153">
            <label><span><Coins size={15}/> DadoCoins</span><input type="number" min="0" max="25" step="1" value={rewardCoins} onChange={(event) => setRewardCoins(clampInt(event.target.value, 0, 25))}/><small>0–25 DC</small></label>
            <label><span><Trophy size={15}/> Experiencia</span><input type="number" min="0" max="50" step="5" value={rewardXp} onChange={(event) => setRewardXp(clampInt(event.target.value, 0, 50))}/><small>0–50 XP</small></label>
            <label><span><Building2 size={15}/> Gym Points</span><input type="number" min="0" max="100" step="10" value={gymPoints} onChange={(event) => setGymPoints(clampInt(event.target.value, 0, 100))}/><small>0–100 GP</small></label>
          </div>
          <div className="gym-reward-preview-v153"><span>Potencial por aprobación</span><strong>{rewardCoins} DC · {rewardXp} XP · {gymPoints} GP</strong></div>
          <p className="gym-reward-help-v153">TP (Team Points) pertenece a competencias de Squad. Los retos del Gym usan GP (Gym Points).</p>
        </div>

        {error && <div className="auth-error">{error}</div>}<button className="gym-battle-send-v121" type="button" onClick={() => { void publish(); }} disabled={sending}><Swords size={15}/>{sending ? 'Publicando…' : `Publicar en ${activeWorkspace.label}`}</button><p className="organization-policy-note-v12">La tarjeta del participante mostrará estos valores como <strong>recompensa potencial</strong>. Solo después de la aprobación se mostrará lo realmente otorgado.</p></>}
    </section></div>}
  </>;
}
