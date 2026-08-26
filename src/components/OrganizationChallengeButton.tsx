import { Building2, Check, Swords, X } from 'lucide-react';
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

interface OrganizationRow {
  id: string;
  name: string;
  organization_type: string;
}

export function OrganizationChallengeButton({ exercise, reps, diceLevel }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [sentOrganization, setSentOrganization] = useState<OrganizationRow | null>(null);
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
        .eq('status', 'active')
        .in('role', ['owner', 'admin', 'coach']);

      if (!active) return;
      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      const ids = (memberships ?? []).map((item) => (item as MembershipRow).organization_id);
      if (!ids.length) {
        setOrganizations([]);
        setLoading(false);
        return;
      }

      const { data, error: organizationError } = await client
        .from('organizations')
        .select('id, name, organization_type')
        .in('id', ids)
        .order('name');

      if (!active) return;
      if (organizationError) setError(organizationError.message);
      else setOrganizations((data ?? []) as OrganizationRow[]);
      setLoading(false);
    };

    void load();
    return () => { active = false; };
  }, [open, cloudReady, user]);

  const close = () => {
    if (sendingId) return;
    setOpen(false);
    setError('');
    setSentOrganization(null);
  };

  const publish = async (organization: OrganizationRow) => {
    if (!supabase || !user || user.provider !== 'supabase') return;
    const client = supabase;
    setSendingId(organization.id);
    setError('');

    const { error: rpcError } = await client.rpc('create_organization_challenge', {
      p_organization_id: organization.id,
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
    setSentOrganization(organization);
  };

  if (!cloudReady) return null;

  return (
    <>
      <button className="organization-challenge-trigger-v12" type="button" onClick={() => setOpen(true)}>
        <Building2 size={18}/>
        Reto de mi Gym
      </button>

      {open && (
        <div className="challenge-modal-backdrop-v10" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="challenge-modal-v10 organization-challenge-modal-v12" role="dialog" aria-modal="true" aria-labelledby="organization-challenge-title">
            <button className="challenge-modal-close-v10" type="button" onClick={close} aria-label="Cerrar"><X size={19}/></button>

            {sentOrganization ? (
              <div className="challenge-success-v10">
                <div className="challenge-success-icon-v10"><Check size={28}/></div>
                <span className="eyebrow">RETO PUBLICADO</span>
                <h2>{sentOrganization.name} ya tiene un nuevo reto.</h2>
                <p>{title}</p>
                <div className="organization-reward-v12">
                  <span>Por miembro aprobado</span>
                  <strong>Hasta +25 DC · +50 XP · +100 Sponsor Points</strong>
                </div>
                <div className="challenge-modal-actions-v10">
                  <Link to="/organization-challenges">Ver retos del Gym</Link>
                  <button type="button" onClick={close}>Cerrar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="challenge-modal-heading-v10">
                  <span className="eyebrow">ORGANIZATION CHALLENGE</span>
                  <h2 id="organization-challenge-title">Publica esta tirada a tus miembros</h2>
                  <p>{title}</p>
                </div>

                <div className="challenge-summary-v10">
                  <div><span>Ejercicio</span><strong>{exercise.name}</strong></div>
                  <div><span>Repeticiones</span><strong>{reps}</strong></div>
                  <div><span>Duración</span><strong>72 h</strong></div>
                  <div><span>Por aprobación</span><strong>100 SP</strong></div>
                </div>

                {error && <div className="auth-error">{error}</div>}

                {loading ? (
                  <div className="challenge-modal-empty-v10">Cargando tus organizaciones…</div>
                ) : organizations.length === 0 ? (
                  <div className="challenge-modal-empty-v10">
                    <Building2 size={28}/>
                    <strong>No administras ninguna organización.</strong>
                    <p>Crea un Gym u organización, invita miembros y luego publica retos.</p>
                    <Link to="/organizations">Ir a Organizations</Link>
                  </div>
                ) : (
                  <div className="organization-publish-list-v12">
                    {organizations.map((organization) => (
                      <article key={organization.id}>
                        <div><Building2 size={18}/><span><strong>{organization.name}</strong><small>{organization.organization_type}</small></span></div>
                        <button type="button" onClick={() => { void publish(organization); }} disabled={Boolean(sendingId)}>
                          <Swords size={15}/>{sendingId === organization.id ? 'Publicando…' : 'Publicar reto'}
                        </button>
                      </article>
                    ))}
                  </div>
                )}

                <p className="organization-policy-note-v12">Los miembros necesitan evidencia. La recompensa personal y Sponsor Points respetan las reglas anti-farming de DadoFit.</p>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
