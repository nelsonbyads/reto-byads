import { ArrowLeft, Check, CheckCircle2, Clock3, FileVideo2, History, Image as ImageIcon, LockKeyhole, RefreshCw, ShieldCheck, ShieldQuestion, ToggleLeft, ToggleRight, UserCheck, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useWorkspace } from '../context/WorkspaceContext';
import { canManageBrandRole } from '../lib/sponsoredRules';
import { formatSponsoredGoal, readSponsoredGoal } from '../lib/sponsoredGoals';
import { supabase } from '../lib/supabase';

interface GovernanceCampaign {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  requires_double_validation: boolean;
  created_at: string;
}

interface AuditQueueItem {
  participant_id: string;
  user_id: string;
  participant_name: string;
  username: string | null;
  challenge_id: string;
  campaign_id: string;
  campaign_name: string;
  exercise_name: string;
  reps: number;
  metadata: Record<string, unknown> | null;
  primary_reviewer_name: string;
  primary_reviewed_at: string;
  evidence_storage_path: string | null;
  evidence_kind: 'image' | 'video' | null;
  evidence_file_name: string | null;
}

interface ReviewHistoryItem {
  id: string;
  participant_id: string;
  review_stage: 'primary' | 'audit';
  decision: 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
  participant_name: string;
  username: string | null;
  campaign_name: string;
  exercise_name: string;
  reviewer_name: string;
}

interface GovernanceData {
  members: number;
  campaigns: number;
  active_campaigns: number;
  sponsored_challenges: number;
  active_challenges: number;
  participants: number;
  pending_review: number;
  pending_audit: number;
  approved: number;
  rejected: number;
  coins_granted: number;
  xp_granted: number;
  campaigns_config: GovernanceCampaign[];
  audit_queue: AuditQueueItem[];
  history: ReviewHistoryItem[];
}

const EMPTY: GovernanceData = { members: 0, campaigns: 0, active_campaigns: 0, sponsored_challenges: 0, active_challenges: 0, participants: 0, pending_review: 0, pending_audit: 0, approved: 0, rejected: 0, coins_granted: 0, xp_granted: 0, campaigns_config: [], audit_queue: [], history: [] };

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return value; }
}

function campaignStatusLabel(status: GovernanceCampaign['status']) {
  const labels: Record<GovernanceCampaign['status'], string> = { draft: 'Borrador', active: 'Activa', paused: 'Pausada', completed: 'Finalizada', cancelled: 'Cancelada' };
  return labels[status];
}

export function BrandAuditPage() {
  const { activeWorkspace } = useWorkspace();
  const orgId = activeWorkspace.organizationId;
  const canManage = canManageBrandRole(activeWorkspace.role);
  const [data, setData] = useState<GovernanceData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [historyFilter, setHistoryFilter] = useState<'all' | 'primary' | 'audit'>('all');

  const load = useCallback(async () => {
    if (!supabase || !orgId) { setLoading(false); return; }
    const client = supabase;
    setLoading(true); setError('');
    const { data: result, error: rpcError } = await client.rpc('get_brand_governance_dashboard', { p_organization_id: orgId });
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    const row = { ...EMPTY, ...((result ?? {}) as Partial<GovernanceData>) };
    row.campaigns_config = Array.isArray(row.campaigns_config) ? row.campaigns_config : [];
    row.audit_queue = Array.isArray(row.audit_queue) ? row.audit_queue : [];
    row.history = Array.isArray(row.history) ? row.history : [];
    setData(row);

    const urls: Record<string, string> = {};
    await Promise.all(row.audit_queue.map(async (item) => {
      if (!item.evidence_storage_path) return;
      const { data: signed } = await client.storage.from('challenge-evidence').createSignedUrl(item.evidence_storage_path, 1800);
      if (signed?.signedUrl) urls[item.participant_id] = signed.signedUrl;
    }));
    setSignedUrls(urls);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  if (activeWorkspace.kind !== 'brand' || !orgId) return <Navigate to="/" replace/>;
  if (!canManage) return <Navigate to="/workspace" replace/>;

  const toggleDoubleValidation = async (campaign: GovernanceCampaign) => {
    if (!supabase || !canManage || !['draft', 'paused'].includes(campaign.status)) return;
    setActing(`toggle:${campaign.id}`); setError(''); setMessage('');
    const enabled = !campaign.requires_double_validation;
    const { error: rpcError } = await supabase.rpc('set_sponsor_campaign_double_validation', { p_campaign_id: campaign.id, p_enabled: enabled });
    setActing(null);
    if (rpcError) { setError(rpcError.message); return; }
    setMessage(enabled ? 'Doble validación activada para la campaña.' : 'Doble validación desactivada para la campaña.');
    await load();
  };

  const audit = async (participantId: string, decision: 'approved' | 'rejected') => {
    if (!supabase || !canManage) return;
    setActing(`audit:${participantId}`); setError(''); setMessage('');
    const { data: result, error: rpcError } = await supabase.rpc('audit_sponsored_challenge', { p_participant_id: participantId, p_decision: decision, p_notes: notes[participantId]?.trim() || null });
    setActing(null);
    if (rpcError) { setError(rpcError.message); return; }
    const row = (result ?? {}) as Record<string, unknown>;
    if (decision === 'rejected') setMessage('Auditoría rechazada. El participante podrá corregir y reenviar evidencia.');
    else if (row.reward_blocked) setMessage('Auditoría aprobada. El reto quedó completado sin recompensa adicional por política anti-farming.');
    else setMessage(`Auditoría aprobada: +${Number(row.coins_granted ?? 0)} DC · +${Number(row.xp_granted ?? 0)} XP.`);
    setNotes((current) => ({ ...current, [participantId]: '' }));
    await load();
  };

  const filteredHistory = useMemo(() => historyFilter === 'all' ? data.history : data.history.filter((item) => item.review_stage === historyFilter), [data.history, historyFilter]);

  return <div className="profile-shell-v9 brand-audit-shell-v133"><AppHeader/><main className="profile-page-v9 brand-audit-page-v133">
    <div className="brand-audit-topline-v133"><Link className="profile-back-v9" to="/workspace"><ArrowLeft size={16}/> Dashboard Marca</Link><button type="button" onClick={() => { void load(); }} disabled={loading}><RefreshCw size={15}/> Actualizar</button></div>

    <section className="brand-audit-hero-v133"><div className="brand-audit-hero-icon-v133"><ShieldCheck size={30}/></div><div><span className="eyebrow">BRAND GOVERNANCE</span><h1>Control & Auditoría</h1><p>Segunda validación, histórico inmutable y trazabilidad de decisiones para {activeWorkspace.label}.</p></div></section>
    {error && <div className="auth-error">{error}</div>}{message && <div className="auth-success">{message}</div>}

    <section className="brand-audit-stats-v133">
      <article><Clock3 size={19}/><span>Por revisar</span><strong>{data.pending_review}</strong></article>
      <article className={data.pending_audit > 0 ? 'attention' : ''}><ShieldQuestion size={19}/><span>Por auditar</span><strong>{data.pending_audit}</strong></article>
      <article><CheckCircle2 size={19}/><span>Aprobados</span><strong>{data.approved}</strong></article>
      <article><XCircle size={19}/><span>Rechazados</span><strong>{data.rejected}</strong></article>
      <article><UserCheck size={19}/><span>Participantes</span><strong>{data.participants}</strong></article>
    </section>

    <section className="profile-card-v9 governance-config-v133"><div className="brand-audit-section-head-v133"><div><span className="eyebrow">POLÍTICA DE CONTROL</span><h2>Doble validación por campaña</h2><p>Cuando está activa, la recompensa se entrega únicamente después de que un segundo Owner/Admin distinto confirme la aprobación.</p></div><ShieldCheck size={24}/></div>
      <div className="governance-campaign-list-v133">{data.campaigns_config.map((campaign) => { const editable = ['draft', 'paused'].includes(campaign.status); return <article key={campaign.id}><div><strong>{campaign.name}</strong><span>{campaignStatusLabel(campaign.status)}</span></div><div className="governance-policy-actions-v1331"><button type="button" className={campaign.requires_double_validation ? 'enabled' : ''} disabled={!canManage || !editable || acting === `toggle:${campaign.id}`} onClick={() => { void toggleDoubleValidation(campaign); }} title={editable ? 'Cambiar política' : 'Pausa la campaña para cambiar esta política'}>{campaign.requires_double_validation ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>}<span>{campaign.requires_double_validation ? 'Doble validación activa' : 'Validación simple'}</span></button>{!editable && <Link className="governance-policy-help-v1331" to="/brand-campaigns"><LockKeyhole size={12}/><span>Campaña activa · pausa para cambiar la política</span><strong>Ir a Campañas</strong></Link>}</div></article>; })}</div>
      {data.campaigns_config.length === 0 && <p className="workspace-empty-v133">No hay campañas configuradas.</p>}
    </section>

    <section className="brand-audit-section-v133"><div className="brand-audit-section-head-v133"><div><span className="eyebrow">SEGUNDA VALIDACIÓN</span><h2>Cola de auditoría</h2><p>Solo puede auditar una persona diferente de quien realizó la primera aprobación.</p></div><span className="audit-count-v133">{data.audit_queue.length}</span></div>
      {loading ? <div className="profile-card-v9">Cargando auditorías…</div> : data.audit_queue.length === 0 ? <div className="profile-card-v9 audit-empty-v133"><ShieldCheck size={30}/><h3>Todo al día</h3><p>No hay aprobaciones pendientes de segunda validación.</p></div> : <div className="audit-queue-v133">{data.audit_queue.map((item) => { const goal = readSponsoredGoal(item.metadata, item.reps); const mediaUrl = signedUrls[item.participant_id]; return <article key={item.participant_id} className="profile-card-v9 audit-card-v133"><header><div><span className="eyebrow">{item.campaign_name}</span><h3>{item.participant_name}</h3><p>@{item.username ?? 'gymbro'} · {item.exercise_name} · {formatSponsoredGoal(goal)}</p></div><span className="audit-pending-pill-v133"><Clock3 size={14}/> Pendiente</span></header><div className="audit-reviewer-v133"><UserCheck size={16}/><span>Primera aprobación por <strong>{item.primary_reviewer_name}</strong> · {formatDate(item.primary_reviewed_at)}</span></div>{mediaUrl && <div className="audit-media-v133">{item.evidence_kind === 'image' ? <img src={mediaUrl} alt={`Evidencia de ${item.participant_name}`}/> : <video src={mediaUrl} controls preload="metadata"/>}<span>{item.evidence_kind === 'image' ? <ImageIcon size={15}/> : <FileVideo2 size={15}/>} {item.evidence_file_name || 'Evidencia enviada'}</span></div>}<label className="audit-notes-v133">Comentario de auditoría<textarea rows={2} maxLength={500} placeholder="Opcional al aprobar. Recomendado al rechazar." value={notes[item.participant_id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [item.participant_id]: event.target.value }))}/></label><footer><button type="button" className="audit-reject-v133" disabled={Boolean(acting)} onClick={() => { void audit(item.participant_id, 'rejected'); }}><X size={15}/> Rechazar auditoría</button><button type="button" className="audit-approve-v133" disabled={Boolean(acting)} onClick={() => { void audit(item.participant_id, 'approved'); }}><Check size={15}/> Confirmar aprobación</button></footer></article>; })}</div>}
    </section>

    <section className="brand-audit-section-v133"><div className="brand-audit-section-head-v133"><div><span className="eyebrow">HISTÓRICO</span><h2>Registro de decisiones</h2><p>Cada revisión queda registrada como un evento independiente; nunca se sobrescribe el historial anterior.</p></div><History size={22}/></div><div className="history-filter-v133"><button type="button" className={historyFilter === 'all' ? 'active' : ''} onClick={() => setHistoryFilter('all')}>Todas</button><button type="button" className={historyFilter === 'primary' ? 'active' : ''} onClick={() => setHistoryFilter('primary')}>Revisión inicial</button><button type="button" className={historyFilter === 'audit' ? 'active' : ''} onClick={() => setHistoryFilter('audit')}>Auditoría</button></div>
      <div className="profile-card-v9 audit-history-card-v133">{filteredHistory.length === 0 ? <p className="workspace-empty-v133">No hay decisiones para este filtro.</p> : <div className="audit-history-list-v133">{filteredHistory.map((item) => <div key={item.id} className="audit-history-row-v133"><span className={`audit-history-icon-v133 ${item.decision}`}>{item.decision === 'approved' ? <Check size={15}/> : <X size={15}/>}</span><div className="audit-history-main-v133"><strong>{item.participant_name}</strong><span>{item.campaign_name} · {item.exercise_name}</span>{item.notes && <p>“{item.notes}”</p>}</div><div className="audit-history-meta-v133"><span className={`stage-${item.review_stage}`}>{item.review_stage === 'audit' ? 'Auditoría' : 'Revisión inicial'}</span><strong>{item.reviewer_name}</strong><small>{formatDate(item.created_at)}</small></div></div>)}</div>}</div>
    </section>
  </main></div>;
}
