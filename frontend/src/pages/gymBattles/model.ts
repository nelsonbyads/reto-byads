

export interface BattleRow {
  id: string;
  challenge_id: string;
  challenger_organization_id: string;
  challenged_organization_id: string;
  created_by_user_id: string;
  accepted_by_user_id: string | null;
  status:
    "pending" | "active" | "completed" | "declined" | "expired" | "cancelled";
  response_expires_at: string;
  starts_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  winner_organization_id: string | null;
  created_at: string;
}

export interface ChallengeRow {
  id: string;
  status: string;
  exercise_name: string;
  reps: number;
  dice_level: string;
  starts_at: string;
  expires_at: string | null;
  reward_coins: number;
  reward_xp: number;
  sponsor_points: number;
}

export interface ParticipantRow {
  id: string;
  challenge_id: string;
  user_id: string;
  organization_id: string | null;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  rewarded_at: string | null;
  reward_coins_granted: number;
  reward_xp_granted: number;
  sponsor_points_granted: number;
  reward_block_reason: string | null;
  dc_block_reason: string | null;
}

export interface OrganizationRow {
  id: string;
  name: string;
  logo_url: string | null;
  organization_type: string;
}

export interface MembershipRow {
  organization_id: string;
  role: "owner" | "admin" | "coach" | "member";
  status: string;
}

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

export interface EvidenceRow {
  id: string;
  participant_id: string;
  evidence_kind: "image" | "video";
  storage_path: string;
  file_name: string | null;
  size_bytes: number | null;
  created_at: string;
}

export interface EvidenceView extends EvidenceRow {
  signedUrl: string | null;
}

export function participantStatusLabel(status: string) {
  const labels: Record<string, string> = {
    accepted: "Participando",
    declined: "No participa",
    submitted: "En revisión",
    approved: "Aprobado",
    rejected: "Nueva evidencia",
    expired: "Expirado",
  };
  return labels[status] ?? status;
}

export function battleStatusLabel(status: BattleRow["status"]) {
  const labels: Record<BattleRow["status"], string> = {
    pending: "Esperando respuesta",
    active: "Batalla activa",
    completed: "Finalizada",
    declined: "Rechazada",
    expired: "Expirada",
    cancelled: "Cancelada",
  };
  return labels[status];
}

export function initials(profile: ProfileRow | undefined) {
  const name = profile?.display_name?.trim() || profile?.username || "DF";
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "DF"
  );
}
