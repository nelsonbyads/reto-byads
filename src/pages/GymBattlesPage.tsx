import { ArrowLeft } from "lucide-react";
import { Building2 } from "lucide-react";
import { Check } from "lucide-react";
import { Clock3 } from "lucide-react";
import { Coins } from "lucide-react";
import { RefreshCw } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { Swords } from "lucide-react";
import { Trophy } from "lucide-react";
import { X } from "lucide-react";
import { useCallback } from "react";
import { useEffect } from "react";
import { useMemo } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "../components/AppHeader";
import { useAuth } from "../auth/AuthContext";
import { backend } from "../lib/backend";
import { dcBlockReasonLabel } from "../lib/dcBlockReason";
import { loadPartnerPointConfigs } from "../lib/partnerPoints";
import { resolvePartnerPointConfig } from "../lib/partnerPoints";
import { type PartnerPointConfig } from "../lib/partnerPoints";
import { formatShortDateTime as formatDate } from "../lib/format";
import { BattleRow, ChallengeRow, MembershipRow, OrganizationRow, ParticipantRow, ProfileRow, battleStatusLabel, initials, participantStatusLabel } from "./gymBattles/model";
import { GymBattleEvidence } from "./gymBattles/GymBattleEvidence";

export function GymBattlesPage() {
  const { user } = useAuth();
  const [memberships, setMemberships] = useState<MembershipRow[]>([]);
  const [battles, setBattles] = useState<BattleRow[]>([]);
  const [challenges, setChallenges] = useState<Map<string, ChallengeRow>>(
    new Map(),
  );
  const [organizations, setOrganizations] = useState<
    Map<string, OrganizationRow>
  >(new Map());
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [profiles, setProfiles] = useState<Map<string, ProfileRow>>(new Map());
  const [ppConfigs, setPpConfigs] = useState<Map<string, PartnerPointConfig>>(
    new Map(),
  );
  const [tab, setTab] = useState<"active" | "history">("active");
  const [loading, setLoading] = useState(user?.provider === "cloud");
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const cloudReady = user?.provider === "cloud" && Boolean(backend);

  const load = useCallback(async () => {
    if (!user || user.provider !== "cloud" || !backend) {
      setLoading(false);
      return;
    }
    const client = backend;
    setLoading(true);
    setError("");

    const [membershipResult, battleResult] = await Promise.all([
      client
        .from("organization_members")
        .select("organization_id, role, status")
        .eq("user_id", user.id)
        .eq("status", "active"),
      client
        .from("organization_battles")
        .select(
          "id, challenge_id, challenger_organization_id, challenged_organization_id, created_by_user_id, accepted_by_user_id, status, response_expires_at, starts_at, expires_at, completed_at, winner_organization_id, created_at",
        )
        .order("created_at", { ascending: false }),
    ]);
    const firstError = membershipResult.error ?? battleResult.error;
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const membershipRows = (membershipResult.data ?? []) as MembershipRow[];
    const battleRows = (battleResult.data ?? []) as BattleRow[];
    setMemberships(membershipRows);
    setBattles(battleRows);

    const challengeIds = battleRows.map((item) => item.challenge_id);
    const orgIds = [
      ...new Set(
        battleRows.flatMap((item) => [
          item.challenger_organization_id,
          item.challenged_organization_id,
        ]),
      ),
    ];

    const [challengeResult, orgResult, participantResult] = await Promise.all([
      challengeIds.length
        ? client
            .from("challenges")
            .select(
              "id, status, exercise_name, reps, dice_level, starts_at, expires_at, reward_coins, reward_xp, sponsor_points",
            )
            .in("id", challengeIds)
        : Promise.resolve({ data: [] as ChallengeRow[], error: null }),
      orgIds.length
        ? client
            .from("organizations")
            .select("id, name, logo_url, organization_type")
            .in("id", orgIds)
        : Promise.resolve({ data: [] as OrganizationRow[], error: null }),
      challengeIds.length
        ? client
            .from("challenge_participants")
            .select(
              "id, challenge_id, user_id, organization_id, status, invited_at, accepted_at, submitted_at, completed_at, rewarded_at, reward_coins_granted, reward_xp_granted, sponsor_points_granted, reward_block_reason, dc_block_reason",
            )
            .in("challenge_id", challengeIds)
        : Promise.resolve({ data: [] as ParticipantRow[], error: null }),
    ]);
    const secondError =
      challengeResult.error ?? orgResult.error ?? participantResult.error;
    if (secondError) {
      setError(secondError.message);
      setLoading(false);
      return;
    }

    const participantRows = (participantResult.data ?? []) as ParticipantRow[];
    setChallenges(
      new Map(
        ((challengeResult.data ?? []) as ChallengeRow[]).map((item) => [
          item.id,
          item,
        ]),
      ),
    );
    setOrganizations(
      new Map(
        ((orgResult.data ?? []) as OrganizationRow[]).map((item) => [
          item.id,
          item,
        ]),
      ),
    );
    setParticipants(participantRows);
    const configs = await loadPartnerPointConfigs(orgIds);
    setPpConfigs(configs);

    const profileIds = [
      ...new Set(participantRows.map((item) => item.user_id)),
    ];
    if (profileIds.length) {
      const profileResult = await client
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", profileIds);
      if (profileResult.error) {
        setError(profileResult.error.message);
        setLoading(false);
        return;
      }
      setProfiles(
        new Map(
          ((profileResult.data ?? []) as ProfileRow[]).map((item) => [
            item.id,
            item,
          ]),
        ),
      );
    } else {
      setProfiles(new Map());
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const managerOrgIds = useMemo(
    () =>
      new Set(
        memberships
          .filter((item) => ["owner", "admin", "coach"].includes(item.role))
          .map((item) => item.organization_id),
      ),
    [memberships],
  );
  const ppShort = (orgId: string | null | undefined) =>
    resolvePartnerPointConfig(ppConfigs, orgId, "gym").points_short_name;
  const activeBattles = useMemo(
    () => battles.filter((item) => ["pending", "active"].includes(item.status)),
    [battles],
  );
  const historyBattles = useMemo(
    () =>
      battles.filter((item) => !["pending", "active"].includes(item.status)),
    [battles],
  );
  const current = tab === "active" ? activeBattles : historyBattles;

  const respond = async (battleId: string, accept: boolean) => {
    if (!backend) return;
    setActing(`respond:${battleId}`);
    setError("");
    setMessage("");
    const { error: rpcError } = await backend.rpc(
      "respond_organization_battle",
      { p_battle_id: battleId, p_accept: accept },
    );
    setActing(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setMessage(
      accept
        ? "Batalla aceptada. El roster quedó congelado por 72 horas."
        : "Batalla rechazada.",
    );
    await load();
  };

  const declineContribution = async (participantId: string) => {
    if (!backend || !window.confirm("¿No participar en esta batalla?")) return;
    setActing(`decline:${participantId}`);
    const { error: rpcError } = await backend.rpc(
      "decline_organization_battle_participation",
      { p_participant_id: participantId },
    );
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  const finalize = async (battleId: string) => {
    if (!backend) return;
    setActing(`finalize:${battleId}`);
    setError("");
    const { error: rpcError } = await backend.rpc(
      "finalize_organization_battle",
      { p_battle_id: battleId },
    );
    setActing(null);
    if (rpcError) setError(rpcError.message);
    else await load();
  };

  return (
    <div className="profile-shell-v9 gym-battles-shell-v121">
      <AppHeader />
      <main className="profile-page-v9 gym-battles-page-v121">
        <div className="gym-battles-topline-v121">
          <Link className="profile-back-v9" to="/workspace">
            <ArrowLeft size={16} /> Dashboard del Gym
          </Link>
          {cloudReady && (
            <button
              type="button"
              onClick={() => {
                void load();
              }}
              disabled={loading}
            >
              <RefreshCw size={15} /> Actualizar
            </button>
          )}
        </div>

        <section className="profile-hero-v9 gym-battles-hero-v121">
          <div className="profile-avatar-v9">
            <Trophy size={31} />
          </div>
          <div>
            <span className="eyebrow">DADOFIT GYM LEAGUE</span>
            <h1>Gym vs Gym</h1>
            <p>
              Los miembros compiten, los managers rivales validan y cada aporte
              aprobado suma Competitive Score.
            </p>
          </div>
          {cloudReady && (
            <div className="gym-battles-hero-stats-v121">
              <span>
                <strong>{activeBattles.length}</strong> activas
              </span>
              <span>
                <strong>{historyBattles.length}</strong> historial
              </span>
            </div>
          )}
        </section>

        {!cloudReady ? (
          <section className="profile-card-v9 profile-cloud-callout-v9">
            <h2>Necesitas una cuenta cloud</h2>
            <p>
              Las batallas Gym vs Gym funcionan con organizaciones y miembros
              reales.
            </p>
          </section>
        ) : (
          <>
            {error && <div className="auth-error">{error}</div>}
            {message && <div className="auth-success">{message}</div>}

            <section
              className="gym-battle-tabs-v121"
              role="tablist"
              aria-label="Batallas Gym"
            >
              <button
                type="button"
                className={tab === "active" ? "active" : ""}
                onClick={() => setTab("active")}
              >
                Activas <span>{activeBattles.length}</span>
              </button>
              <button
                type="button"
                className={tab === "history" ? "active" : ""}
                onClick={() => setTab("history")}
              >
                Historial <span>{historyBattles.length}</span>
              </button>
            </section>

            {loading ? (
              <section className="profile-card-v9 gym-battle-empty-v121">
                Cargando batallas…
              </section>
            ) : current.length === 0 ? (
              <section className="profile-card-v9 gym-battle-empty-v121">
                <Swords size={32} />
                <h2>
                  {tab === "active"
                    ? "No tienes batallas activas"
                    : "Aún no hay historial"}
                </h2>
                <p>
                  Lanza los dados y usa “Gym vs Gym” para desafiar otro
                  gimnasio.
                </p>
                <Link className="profile-primary-v9" to="/app">
                  Lanzar dados
                </Link>
              </section>
            ) : (
              <section className="gym-battle-list-v121">
                {current.map((battle) => {
                  const challenge = challenges.get(battle.challenge_id);
                  const challenger = organizations.get(
                    battle.challenger_organization_id,
                  );
                  const challenged = organizations.get(
                    battle.challenged_organization_id,
                  );
                  const battleParticipants = participants.filter(
                    (item) => item.challenge_id === battle.challenge_id,
                  );
                  const challengerParticipants = battleParticipants.filter(
                    (item) =>
                      item.organization_id ===
                      battle.challenger_organization_id,
                  );
                  const challengedParticipants = battleParticipants.filter(
                    (item) =>
                      item.organization_id ===
                      battle.challenged_organization_id,
                  );
                  const challengerPoints = challengerParticipants.reduce(
                    (sum, item) =>
                      sum + Number(item.sponsor_points_granted ?? 0),
                    0,
                  );
                  const challengedPoints = challengedParticipants.reduce(
                    (sum, item) =>
                      sum + Number(item.sponsor_points_granted ?? 0),
                    0,
                  );
                  const ownParticipant = battleParticipants.find(
                    (item) => item.user_id === user?.id,
                  );
                  const canRespond =
                    battle.status === "pending" &&
                    managerOrgIds.has(battle.challenged_organization_id);
                  const canFinalize =
                    managerOrgIds.has(battle.challenger_organization_id) ||
                    managerOrgIds.has(battle.challenged_organization_id);
                  const reviewable = battleParticipants.filter((item) => {
                    if (item.status !== "submitted" || !item.organization_id)
                      return false;
                    const opposing =
                      item.organization_id === battle.challenger_organization_id
                        ? battle.challenged_organization_id
                        : battle.challenger_organization_id;
                    return (
                      managerOrgIds.has(opposing) && item.user_id !== user?.id
                    );
                  });
                  const winner = battle.winner_organization_id
                    ? organizations.get(battle.winner_organization_id)
                    : null;

                  return (
                    <article
                      key={battle.id}
                      className={`profile-card-v9 gym-battle-card-v121 battle-${battle.status}`}
                    >
                      <header className="gym-battle-card-head-v121">
                        <div>
                          <span className="eyebrow">GYM VS GYM</span>
                          <h2>
                            {challenge
                              ? `${challenge.reps}× ${challenge.exercise_name}`
                              : "Batalla de Gym"}
                          </h2>
                          <p>
                            {challenge?.dice_level?.toUpperCase() ?? ""} ·
                            creada {formatDate(battle.created_at)}
                          </p>
                        </div>
                        <span
                          className={`gym-battle-status-v121 status-${battle.status}`}
                        >
                          {battleStatusLabel(battle.status)}
                        </span>
                      </header>

                      <div className="gym-battle-score-v121">
                        <div className="gym-battle-team-v121">
                          <div className="gym-battle-logo-v121">
                            {challenger?.logo_url ? (
                              <img src={challenger.logo_url} alt="" />
                            ) : (
                              <Building2 size={22} />
                            )}
                          </div>
                          <span>
                            <strong>{challenger?.name ?? "Gym retador"}</strong>
                            <small>
                              {challengerParticipants.length} participantes
                            </small>
                          </span>
                          <b>
                            {challengerPoints}{" "}
                            {ppShort(battle.challenger_organization_id)}
                          </b>
                        </div>
                        <div className="gym-battle-versus-v121">
                          <Swords size={18} />
                          <span>VS</span>
                        </div>
                        <div className="gym-battle-team-v121 right">
                          <b>
                            {challengedPoints}{" "}
                            {ppShort(battle.challenged_organization_id)}
                          </b>
                          <span>
                            <strong>{challenged?.name ?? "Gym rival"}</strong>
                            <small>
                              {challengedParticipants.length} participantes
                            </small>
                          </span>
                          <div className="gym-battle-logo-v121">
                            {challenged?.logo_url ? (
                              <img src={challenged.logo_url} alt="" />
                            ) : (
                              <Building2 size={22} />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="gym-battle-meta-v121">
                        {battle.status === "pending" && (
                          <span>
                            <Clock3 size={14} /> Responder antes de{" "}
                            {formatDate(battle.response_expires_at)}
                          </span>
                        )}
                        {battle.status === "active" && (
                          <span>
                            <Clock3 size={14} /> Finaliza{" "}
                            {formatDate(battle.expires_at)}
                          </span>
                        )}
                        <span>
                          <Coins size={14} /> Hasta 25 DC por aporte
                        </span>
                        <span>
                          <Trophy size={14} /> Hasta 50 XP + 100 Partner Points
                        </span>
                      </div>

                      {canRespond && (
                        <div className="gym-battle-response-v121">
                          <button
                            type="button"
                            className="reject"
                            onClick={() => {
                              void respond(battle.id, false);
                            }}
                            disabled={Boolean(acting)}
                          >
                            <X size={16} /> Rechazar
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void respond(battle.id, true);
                            }}
                            disabled={Boolean(acting)}
                          >
                            <Check size={16} /> Aceptar batalla
                          </button>
                        </div>
                      )}

                      {battle.status === "pending" && !canRespond && (
                        <div className="gym-battle-info-v121">
                          Esperando que un owner, admin o coach de{" "}
                          {challenged?.name ?? "Gym rival"} responda.
                        </div>
                      )}

                      {battle.status === "active" && ownParticipant && (
                        <section className="gym-battle-own-v121">
                          <div className="gym-battle-subheading-v121">
                            <div>
                              <ShieldCheck size={16} />
                              <span>
                                <strong>Tu aporte</strong>
                                <small>
                                  {participantStatusLabel(
                                    ownParticipant.status,
                                  )}
                                </small>
                                {dcBlockReasonLabel(ownParticipant.dc_block_reason) && (
                                  <small>{dcBlockReasonLabel(ownParticipant.dc_block_reason)}</small>
                                )}
                              </span>
                            </div>
                            {["accepted", "rejected"].includes(
                              ownParticipant.status,
                            ) && (
                              <button
                                type="button"
                                className="gym-battle-skip-v121"
                                onClick={() => {
                                  void declineContribution(ownParticipant.id);
                                }}
                                disabled={Boolean(acting)}
                              >
                                No participar
                              </button>
                            )}
                          </div>
                          {[
                            "accepted",
                            "rejected",
                            "submitted",
                            "approved",
                          ].includes(ownParticipant.status) && (
                            <GymBattleEvidence
                              participant={ownParticipant}
                              canUpload={["accepted", "rejected"].includes(
                                ownParticipant.status,
                              )}
                              canReview={false}
                              onChanged={load}
                            />
                          )}
                          {ownParticipant.status === "approved" && (
                            <div className="gym-battle-approved-v121">
                              <Check size={18} />
                              <span>
                                <strong>Aporte aprobado</strong>
                                <small>
                                  +{ownParticipant.reward_coins_granted} DC · +
                                  {ownParticipant.reward_xp_granted} XP · +
                                  {ownParticipant.sponsor_points_granted}{" "}
                                  {ppShort(battle.challenger_organization_id)}
                                  {ownParticipant.reward_block_reason
                                    ? " · anti-farming aplicado"
                                    : ""}
                                </small>
                              </span>
                            </div>
                          )}
                        </section>
                      )}

                      {battle.status === "active" && reviewable.length > 0 && (
                        <section className="gym-battle-reviews-v121">
                          <div className="gym-battle-subheading-v121">
                            <div>
                              <Trophy size={16} />
                              <span>
                                <strong>Evidencias del Gym rival</strong>
                                <small>{reviewable.length} por revisar</small>
                              </span>
                            </div>
                          </div>
                          {reviewable.map((participant) => {
                            const profile = profiles.get(participant.user_id);
                            return (
                              <article
                                key={participant.id}
                                className="gym-battle-review-card-v121"
                              >
                                <div className="gym-battle-person-v121">
                                  <div>
                                    {profile?.avatar_url ? (
                                      <img src={profile.avatar_url} alt="" />
                                    ) : (
                                      <span>{initials(profile)}</span>
                                    )}
                                  </div>
                                  <span>
                                    <strong>
                                      {profile?.display_name ||
                                        profile?.username ||
                                        "Gymbro"}
                                    </strong>
                                    <small>
                                      {profile?.username
                                        ? `@${profile.username}`
                                        : "Miembro DadoFit"}
                                    </small>
                                  </span>
                                </div>
                                <GymBattleEvidence
                                  participant={participant}
                                  canUpload={false}
                                  canReview
                                  onChanged={load}
                                />
                              </article>
                            );
                          })}
                        </section>
                      )}

                      {battle.status === "active" && canFinalize && (
                        <button
                          className="gym-battle-finalize-v121"
                          type="button"
                          onClick={() => {
                            void finalize(battle.id);
                          }}
                          disabled={Boolean(acting)}
                        >
                          <RefreshCw size={15} /> Actualizar cierre
                        </button>
                      )}

                      {battle.status === "completed" && (
                        <div className="gym-battle-result-v121">
                          <Trophy size={21} />
                          <div>
                            <strong>
                              {winner
                                ? `${winner.name} gana`
                                : "Empate entre Gyms"}
                            </strong>
                            <span>
                              {challenger?.name ?? "Gym A"} {challengerPoints}{" "}
                              {ppShort(battle.challenger_organization_id)} ·{" "}
                              {challenged?.name ?? "Gym B"} {challengedPoints}{" "}
                              {ppShort(battle.challenged_organization_id)}
                            </span>
                          </div>
                        </div>
                      )}
                      {battle.status === "declined" && (
                        <div className="gym-battle-info-v121">
                          El Gym rival rechazó esta batalla.
                        </div>
                      )}
                      {battle.status === "expired" && (
                        <div className="gym-battle-info-v121">
                          La batalla expiró.
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
