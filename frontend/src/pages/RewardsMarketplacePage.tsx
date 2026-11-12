import { AlertCircle } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import { Clipboard } from "lucide-react";
import { Clock3 } from "lucide-react";
import { Coins } from "lucide-react";
import { ExternalLink } from "lucide-react";
import { Gift } from "lucide-react";
import { History } from "lucide-react";
import { Package } from "lucide-react";
import { QrCode } from "lucide-react";
import { RefreshCw } from "lucide-react";
import { Search } from "lucide-react";
import { Store } from "lucide-react";
import { X } from "lucide-react";
import { XCircle } from "lucide-react";
import { useCallback } from "react";
import { useEffect } from "react";
import { useRef } from "react";
import { useState } from "react";
import { type CSSProperties } from "react";
import { type KeyboardEvent as ReactKeyboardEvent } from "react";
import { type MutableRefObject } from "react";
import { AppHeader } from "../components/AppHeader";
import { RewardQrCode } from "../components/RewardQrCode";
import { blockedReasonLabel } from "../lib/partnerMarketplace";
import { initialMarketplaceSelection } from "../lib/partnerMarketplace";
import { isCurrentRequest } from "../lib/partnerMarketplace";
import { marketplaceStateCopy } from "../lib/partnerMarketplace";
import { nextTabIndex } from "../lib/partnerMarketplace";
import { PARTNER_MARKETPLACE_RPCS } from "../lib/partnerMarketplace";
import { safePartnerColor } from "../lib/partnerMarketplace";
import { quickPartnerMarketplaces } from "../lib/partnerMarketplace";
import { type CatalogRewardDto } from "../lib/partnerMarketplace";
import { type IntegerValue } from "../lib/partnerMarketplace";
import { type PartnerMarketplaceDto } from "../lib/partnerMarketplace";
import { type RedemptionHistoryDto } from "../lib/partnerMarketplace";
import { backend } from "../lib/backend";
import { safeExternalUrl } from "../lib/safeUrl";
import { redeemErrorMessage } from "../lib/partnerMarketplace";
import { FulfillmentDto, RedemptionResult, Scope, date, fmt, fulfillmentLabels, typeLabels } from "./rewardsMarketplace/model";
import { CommunityButton, CommunityDirectory, PartnerIcon, RewardDetail } from "./rewardsMarketplace/components";

export function RewardsMarketplacePage() {
  const [communities, setCommunities] = useState<PartnerMarketplaceDto[]>([]);
  const [scope, setScope] = useState<Scope>("dadofit");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogRewardDto[]>([]);
  const [history, setHistory] = useState<RedemptionHistoryDto[]>([]);
  const [dcBalance, setDcBalance] = useState<IntegerValue>(0);
  const [tab, setTab] = useState<"catalog" | "history">("catalog");
  const [historyAll, setHistoryAll] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [error, setError] = useState("");
  const [acting, setActing] = useState("");
  const [detail, setDetail] = useState<CatalogRewardDto | null>(null);
  const [success, setSuccess] = useState<RedemptionResult | null>(null);
  const [copied, setCopied] = useState("");
  const [qrOpen, setQrOpen] = useState("");
  const [communityDirectoryOpen, setCommunityDirectoryOpen] = useState(false);
  const [fulfillment, setFulfillment] = useState<
    Record<string, FulfillmentDto | "loading">
  >({});
  const requestGeneration = useRef(0);
  const destinationTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const contentTabs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected =
    communities.find((item) => item.organization_id === organizationId) ?? null;
  const activeBalance =
    scope === "partner" ? (selected?.balance ?? 0) : dcBalance;
  const quickCommunities = quickPartnerMarketplaces(communities, organizationId);

  const loadHistory = useCallback(
    async (
      partnerOrganization: string | null,
      all: boolean,
      generation: number,
    ) => {
      if (!backend) return;
      const { data, error: rpcError } = await backend.rpc(
        PARTNER_MARKETPLACE_RPCS.history,
        { p_organization_id: all ? null : partnerOrganization },
      );
      if (rpcError) throw rpcError;
      if (!isCurrentRequest(generation, requestGeneration.current)) return;
      setHistory((data ?? []) as RedemptionHistoryDto[]);
      setFulfillment({});
    },
    [],
  );

  const loadCatalog = useCallback(
    async (
      nextScope: Scope,
      nextOrganization: string | null,
      generation: number,
    ) => {
      if (!backend) return;
      if (nextScope === "partner" && !nextOrganization) {
        if (generation === requestGeneration.current) setCatalog([]);
        return;
      }
      setCatalogLoading(true);
      const result =
        nextScope === "dadofit"
          ? await backend.rpc(PARTNER_MARKETPLACE_RPCS.dadofitCatalog)
          : await backend.rpc(PARTNER_MARKETPLACE_RPCS.partnerCatalog, {
              p_organization_id: nextOrganization,
            });
      if (result.error) throw result.error;
      if (!isCurrentRequest(generation, requestGeneration.current)) return;
      setCatalogLoading(false);
      const payload = result.data as unknown;
      if (
        nextScope === "dadofit" &&
        payload &&
        !Array.isArray(payload) &&
        typeof payload === "object"
      ) {
        const wrapped = payload as {
          balance?: IntegerValue;
          offers?: CatalogRewardDto[];
        };
        setDcBalance(wrapped.balance ?? 0);
        setCatalog(wrapped.offers ?? []);
      } else setCatalog((payload ?? []) as CatalogRewardDto[]);
    },
    [],
  );

  const load = useCallback(async () => {
    if (!backend) return;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const discovery = await backend.rpc(PARTNER_MARKETPLACE_RPCS.discovery);
      if (discovery.error) throw discovery.error;
      const rows = (discovery.data ?? []) as PartnerMarketplaceDto[];
      if (generation !== requestGeneration.current) return;
      setCommunities(rows);
      const initial = initialMarketplaceSelection(window.location.search, rows);
      setScope(initial.scope);
      setOrganizationId(initial.organizationId);
      await Promise.all([
        loadCatalog(initial.scope, initial.organizationId, generation),
        loadHistory(
          initial.scope === "partner" ? initial.organizationId : null,
          initial.scope !== "partner",
          generation,
        ),
      ]);
    } catch {
      if (generation === requestGeneration.current) {
        setError("No fue posible cargar Rewards. Intenta de nuevo.");
        setCatalogLoading(false);
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [loadCatalog, loadHistory]);
  useEffect(() => {
    void load();
  }, [load]);

  const selectMarketplace = async (
    nextScope: Scope,
    nextOrganization: string | null = null,
  ) => {
    const generation = ++requestGeneration.current;
    setScope(nextScope);
    setOrganizationId(nextOrganization);
    setHistoryAll(nextScope !== "partner");
    setError("");
    setDetail(null);
    const query =
      nextScope === "partner" && nextOrganization
        ? `?scope=partner&organization=${encodeURIComponent(nextOrganization)}`
        : window.location.pathname;
    window.history.replaceState(null, "", query);
    if (nextScope === "partner" && !nextOrganization) {
      setCatalog([]);
      setHistory([]);
      setCatalogLoading(false);
      return;
    }
    try {
      await Promise.all([
        loadCatalog(nextScope, nextOrganization, generation),
        loadHistory(
          nextScope === "partner" ? nextOrganization : null,
          nextScope !== "partner",
          generation,
        ),
      ]);
    } catch {
      if (generation === requestGeneration.current) {
        setError("No fue posible cargar este marketplace.");
        setCatalogLoading(false);
      }
    }
  };
  const showHistory = async (all: boolean) => {
    const generation = ++requestGeneration.current;
    setHistoryAll(all);
    setError("");
    try {
      await loadHistory(
        scope === "partner" ? organizationId : null,
        all,
        generation,
      );
    } catch {
      if (generation === requestGeneration.current)
        setError("No fue posible cargar el historial.");
    }
  };
  const redeem = async (reward: CatalogRewardDto) => {
    if (!backend || !reward.can_redeem) return;
    const redemptionGeneration = requestGeneration.current;
    setActing(reward.reward_id);
    setError("");
    const payment =
      reward.marketplace_scope === "dadofit"
        ? "dc"
        : selected?.organization_type === "gym"
          ? "gp"
          : "sp";
    const { data, error: rpcError } = await backend.rpc("redeem_reward", {
      p_reward_id: reward.reward_id,
      p_payment_method: payment,
    });
    setActing((current) => (current === reward.reward_id ? "" : current));
    if (redemptionGeneration !== requestGeneration.current) return;
    if (rpcError) {
      setError(redeemErrorMessage(rpcError.message));
      return;
    }
    setSuccess((data ?? null) as RedemptionResult | null);
    setDetail(null);
    setTab("history");
    const generation = ++requestGeneration.current;
    try {
      await Promise.all([
        loadCatalog(scope, organizationId, generation),
        loadHistory(
          scope === "partner" ? organizationId : null,
          historyAll,
          generation,
        ),
      ]);
    } catch {
      if (generation === requestGeneration.current)
        setError(
          "Canje confirmado. No fue posible actualizar todos los datos.",
        );
    }
  };
  const loadFulfillment = async (redemptionId: string) => {
    if (!backend || fulfillment[redemptionId]) return;
    const generation = requestGeneration.current;
    setFulfillment((current) => ({ ...current, [redemptionId]: "loading" }));
    const { data, error: rpcError } = await backend.rpc(
      PARTNER_MARKETPLACE_RPCS.ownerFulfillment,
      { p_redemption_id: redemptionId },
    );
    if (generation !== requestGeneration.current) return;
    setFulfillment((current) => ({
      ...current,
      [redemptionId]: rpcError ? {} : ((data ?? {}) as FulfillmentDto),
    }));
    if (rpcError) setError("No fue posible cargar los datos de entrega.");
  };
  const onTabKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: number,
    refs: MutableRefObject<Array<HTMLButtonElement | null>>,
    select: (index: number) => void,
  ) => {
    const next = nextTabIndex(current, event.key, 2);
    if (next === current && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(next);
    refs.current[next]?.focus();
  };
  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };
  const visible = catalog.filter(
    (reward) =>
      !search.trim() ||
      `${reward.title} ${reward.description ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const color = safePartnerColor(selected?.points_color);

  const stateCopy = selected
    ? marketplaceStateCopy(selected.marketplace_state)
    : null;
  return (
    <div className="rewards-page-v15">
      <AppHeader />
      <main
        className="rewards-shell-v15"
        style={{ "--partner-accent": color } as CSSProperties}
      >
        <section className="rewards-hero-v15">
          <div>
            <span className="eyebrow">DADOFIT REWARDS</span>
            <h1>Premios que hablan tu idioma.</h1>
            <p>
              DadoCoins en DadoFit. Partner Points dentro de cada comunidad. Sin
              mezclar monedas.
            </p>
          </div>
          <div className="reward-wallet-chip-v158 dc">
            <Coins />
            <span>
              {scope === "partner"
                ? (selected?.points_name ?? "Partner Points")
                : "DadoCoins"}
            </span>
            <strong>
              {fmt(activeBalance)}{" "}
              {scope === "partner"
                ? (selected?.points_short_name ?? "PP")
                : "DC"}
            </strong>
          </div>
        </section>
        <div
          className="marketplace-destinations"
          role="tablist"
          aria-label="Marketplace"
        >
          <button
            id="destination-dadofit"
            ref={(node) => {
              destinationTabs.current[0] = node;
            }}
            role="tab"
            tabIndex={scope === "dadofit" ? 0 : -1}
            aria-selected={scope === "dadofit"}
            aria-controls="destination-panel"
            className={scope === "dadofit" ? "active" : ""}
            onKeyDown={(event) =>
              onTabKey(
                event,
                0,
                destinationTabs,
                (index) =>
                  void selectMarketplace(
                    index === 0 ? "dadofit" : "partner",
                    index === 1
                      ? (organizationId ??
                          communities[0]?.organization_id ??
                          null)
                      : null,
                  ),
              )
            }
            onClick={() => void selectMarketplace("dadofit")}
          >
            <Coins />
            DadoFit
          </button>
          <button
            id="destination-partner"
            ref={(node) => {
              destinationTabs.current[1] = node;
            }}
            role="tab"
            tabIndex={scope === "partner" ? 0 : -1}
            aria-selected={scope === "partner"}
            aria-controls="destination-panel"
            className={scope === "partner" ? "active" : ""}
            onKeyDown={(event) =>
              onTabKey(
                event,
                1,
                destinationTabs,
                (index) =>
                  void selectMarketplace(
                    index === 0 ? "dadofit" : "partner",
                    index === 1
                      ? (organizationId ??
                          communities[0]?.organization_id ??
                          null)
                      : null,
                  ),
              )
            }
            onClick={() =>
              void selectMarketplace(
                "partner",
                organizationId ?? communities[0]?.organization_id ?? null,
              )
            }
          >
            <Store />
            Mis comunidades
          </button>
        </div>
        <section
          id="destination-panel"
          role="tabpanel"
          aria-labelledby={
            scope === "dadofit" ? "destination-dadofit" : "destination-partner"
          }
        >
          {scope === "partner" && (
            <section className="community-picker" aria-label="Selecciona una comunidad">
              {communities.length > 6 && <div className="community-picker-toolbar"><span>Accesos rápidos</span><button type="button" onClick={() => setCommunityDirectoryOpen(true)}><Search size={15} />Ver todas ({communities.length})</button></div>}
              <div className="community-strip">
              {communities.length === 0 && !loading ? (
                <div className="rewards-empty-v15">
                  <strong>Aún no tienes comunidades con Partner Points.</strong>
                </div>
              ) : (
                quickCommunities.map((community) => (
                  <CommunityButton
                    key={community.organization_id}
                    community={community}
                    active={organizationId === community.organization_id}
                    onSelect={() =>
                      void selectMarketplace(
                        "partner",
                        community.organization_id,
                      )
                    }
                  />
                ))
              )}
              </div>
            </section>
          )}
          {scope === "partner" && selected && (
            <section className="partner-marketplace-head">
              <div>
                <span className="partner-icon" aria-hidden="true">
                  <PartnerIcon value={selected.points_icon} />
                </span>
                <div>
                  <small>MARKETPLACE PARTNER</small>
                  <h2>{selected.organization_name}</h2>
                  <p>{selected.points_name} exclusivos de esta comunidad.</p>
                </div>
              </div>
              <strong>
                {fmt(selected.balance)} {selected.points_short_name}
              </strong>
            </section>
          )}
        </section>
        <div className="rewards-tab-row">
          <div
            className="rewards-tabs-v15"
            role="tablist"
            aria-label="Contenido"
          >
            <button
              id="rewards-catalog-tab"
              ref={(node) => {
                contentTabs.current[0] = node;
              }}
              role="tab"
              tabIndex={tab === "catalog" ? 0 : -1}
              aria-selected={tab === "catalog"}
              aria-controls="rewards-content-panel"
              className={tab === "catalog" ? "active" : ""}
              onKeyDown={(event) =>
                onTabKey(event, 0, contentTabs, (index) =>
                  setTab(index === 0 ? "catalog" : "history"),
                )
              }
              onClick={() => setTab("catalog")}
            >
              <Gift />
              Premios
            </button>
            <button
              id="rewards-history-tab"
              ref={(node) => {
                contentTabs.current[1] = node;
              }}
              role="tab"
              tabIndex={tab === "history" ? 0 : -1}
              aria-selected={tab === "history"}
              aria-controls="rewards-content-panel"
              className={tab === "history" ? "active" : ""}
              onKeyDown={(event) =>
                onTabKey(event, 1, contentTabs, (index) =>
                  setTab(index === 0 ? "catalog" : "history"),
                )
              }
              onClick={() => setTab("history")}
            >
              <History />
              Mis canjes <span>{history.length}</span>
            </button>
          </div>
          <button
            className="rewards-refresh-v15"
            onClick={() => void load()}
            aria-label="Actualizar Rewards"
          >
            <RefreshCw />
            Actualizar
          </button>
        </div>
        {error && (
          <div className="auth-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="rewards-success-v15" role="status" aria-live="polite">
            <CheckCircle2 />
            <div>
              <strong>Canje confirmado: {success.title}</strong>
              <span>
                Pagaste {fmt(success.payment_amount)}{" "}
                {success.payment_currency === "dc"
                  ? "DC"
                  : (selected?.points_short_name ?? "PP")}
                . Nuevo saldo: {fmt(success.new_balance)}.
              </span>
              {success.assigned_code && (
                <span>
                  Código: <b>{success.assigned_code}</b>{" "}
                  <button onClick={() => void copyText(success.assigned_code!)}>
                    <Clipboard />
                    {copied === success.assigned_code ? "Copiado" : "Copiar"}
                  </button>
                </span>
              )}
              {safeExternalUrl(success.redemption_url) && (
                <a
                  href={safeExternalUrl(success.redemption_url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink />
                  Abrir beneficio
                </a>
              )}
            </div>
            <button
              aria-label="Cerrar confirmación"
              onClick={() => setSuccess(null)}
            >
              <X />
            </button>
          </div>
        )}
        <section
          id="rewards-content-panel"
          role="tabpanel"
          aria-labelledby={
            tab === "catalog" ? "rewards-catalog-tab" : "rewards-history-tab"
          }
          aria-busy={loading || catalogLoading}
        >
          {tab === "catalog" ? (
            <>
              {scope === "partner" &&
              selected?.marketplace_state !== "OPERATIONAL" ? (
                <div className="rewards-empty-v15">
                  <Store />
                  <strong>{stateCopy?.title}</strong>
                  <p>{stateCopy?.description}</p>
                </div>
              ) : (
                <>
                  <div className="rewards-toolbar-v15">
                    <label>
                      <Search />
                      <span className="sr-only">Buscar premios</span>
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Buscar en este marketplace…"
                      />
                    </label>
                  </div>
                  {loading || catalogLoading ? (
                    <div className="reward-skeleton-grid" role="status">
                      <span className="sr-only">Cargando catálogo</span>
                      {[1, 2, 3].map((item) => (
                        <i key={item} />
                      ))}
                    </div>
                  ) : visible.length === 0 ? (
                    <div className="rewards-empty-v15">
                      <Gift />
                      <strong>
                        {scope === "partner"
                          ? `${selected?.organization_name ?? "Esta comunidad"} aún no tiene premios disponibles.`
                          : "No hay premios DadoFit disponibles."}
                      </strong>
                    </div>
                  ) : (
                    <div className="rewards-grid-v15">
                      {visible.map((reward) => (
                        <article
                          className="reward-card-v15"
                          key={reward.reward_id}
                        >
                          <div className="reward-image-v15">
                            {reward.image_url ? (
                              <img
                                src={reward.image_url}
                                alt={`Premio ${reward.title}`}
                              />
                            ) : (
                              <Gift />
                            )}
                            <span>
                              {typeLabels[reward.reward_type] ?? "Premio"}
                            </span>
                          </div>
                          <div className="reward-body-v15">
                            <div className="reward-provider-v15">
                              <Store />
                              <span>
                                {reward.organization_name || "DadoFit"}
                              </span>
                            </div>
                            <h2>{reward.title}</h2>
                            <p>
                              {reward.description ||
                                "Beneficio exclusivo dentro del ecosistema DadoFit."}
                            </p>
                            <div className="reward-meta-v15">
                              <span>
                                <Package />
                                {reward.remaining_stock === null
                                  ? "Stock abierto"
                                  : `${fmt(reward.remaining_stock)} disponibles`}
                              </span>
                            </div>
                            <strong className="reward-price">
                              {fmt(reward.native_cost)}{" "}
                              {reward.points_short_name}
                            </strong>
                            <button
                              className="reward-open-detail"
                              onClick={() => setDetail(reward)}
                            >
                              Ver detalle
                            </button>
                            {!reward.can_redeem && (
                              <small className="reward-block-reason">
                                {blockedReasonLabel(reward.blocked_reason)}
                              </small>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="history-filter">
                <strong>Historial</strong>
                {scope === "partner" && (
                  <div role="group" aria-label="Filtrar historial">
                    <button
                      className={!historyAll ? "active" : ""}
                      aria-pressed={!historyAll}
                      onClick={() => void showHistory(false)}
                    >
                      {selected?.organization_name}
                    </button>
                    <button
                      className={historyAll ? "active" : ""}
                      aria-pressed={historyAll}
                      onClick={() => void showHistory(true)}
                    >
                      Todos
                    </button>
                  </div>
                )}
              </div>
              <div className="redemptions-list-v15">
                {history.length === 0 ? (
                  <div className="rewards-empty-v15">
                    <History />
                    <strong>
                      Aún no has canjeado premios en este contexto.
                    </strong>
                  </div>
                ) : (
                  history.map((item) => {
                    const delivery = fulfillment[item.redemption_id];
                    return (
                      <article key={item.redemption_id}>
                        <div className="redemption-icon-v15">
                          {item.status === "cancelled" ? (
                            <XCircle />
                          ) : item.status === "redeemed" ? (
                            <CheckCircle2 />
                          ) : (
                            <Clock3 />
                          )}
                        </div>
                        <div className="redemption-main-v15">
                          <span>
                            {item.organization_name_snapshot || "DadoFit"}
                          </span>
                          <h3>{item.reward_title_snapshot}</h3>
                          <small>
                            {date(item.redeemed_at)} ·{" "}
                            {fmt(item.payment_amount)}{" "}
                            {item.payment_currency === "dc"
                              ? "DC"
                              : item.points_short_name_snapshot}{" "}
                            ·{" "}
                            {item.status === "cancelled"
                              ? "Cancelado"
                              : item.status === "redeemed"
                                ? `Entregado ${date(item.fulfilled_at)}`
                                : (fulfillmentLabels[item.fulfillment_type] ??
                                  "Canje")}
                          </small>
                          {item.status !== "cancelled" && !delivery && (
                            <button
                              className="reward-show-fulfillment"
                              onClick={() =>
                                void loadFulfillment(item.redemption_id)
                              }
                            >
                              Ver datos de entrega
                            </button>
                          )}
                          {delivery === "loading" && (
                            <span role="status">Cargando entrega…</span>
                          )}
                          {delivery && delivery !== "loading" && (
                            <>
                              {delivery.fulfillment_notes && (
                                <p>{delivery.fulfillment_notes}</p>
                              )}
                              {delivery.fulfillment_instructions && (
                                <p>{delivery.fulfillment_instructions}</p>
                              )}
                              {delivery.assigned_code && (
                                <div className="redemption-benefit-v151">
                                  <span>Código promocional</span>
                                  <strong>{delivery.assigned_code}</strong>
                                  <button
                                    onClick={() =>
                                      void copyText(delivery.assigned_code!)
                                    }
                                  >
                                    <Clipboard />
                                    {copied === delivery.assigned_code
                                      ? "Copiado"
                                      : "Copiar"}
                                  </button>
                                </div>
                              )}
                              {delivery.redemption_url && (
                                <a
                                  className="reward-open-link-v151"
                                  href={safeExternalUrl(delivery.redemption_url)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <ExternalLink />
                                  Abrir beneficio
                                </a>
                              )}
                              {(item.fulfillment_type === "in_person" ||
                                item.fulfillment_type === "physical_product") &&
                                delivery.validation_token &&
                                item.status === "issued" && (
                                  <div className="reward-presential-v152">
                                    <button
                                      className="reward-show-qr-v152"
                                      onClick={() =>
                                        setQrOpen(
                                          qrOpen === item.redemption_id
                                            ? ""
                                            : item.redemption_id,
                                        )
                                      }
                                    >
                                      <QrCode />
                                      {qrOpen === item.redemption_id
                                        ? "Ocultar QR"
                                        : "Mostrar QR de entrega"}
                                    </button>
                                    {qrOpen === item.redemption_id && (
                                      <div className="reward-qr-panel-v152">
                                        <RewardQrCode
                                          value={`${window.location.origin}/rewards/validate?token=${delivery.validation_token}`}
                                          size={190}
                                        />
                                        <div>
                                          <strong>Preséntalo al partner</strong>
                                          <small>
                                            Referencia:{" "}
                                            {item.redemption_reference || "—"}
                                          </small>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                            </>
                          )}
                        </div>
                        <div className="redemption-code-v15">
                          <span>{item.status}</span>
                          <small>Referencia</small>
                          <strong>{item.redemption_reference || "—"}</strong>
                          {item.expires_at && (
                            <small>Vence {date(item.expires_at)}</small>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
        {detail && (
          <RewardDetail
            reward={detail}
            balance={activeBalance}
            acting={acting === detail.reward_id}
            onClose={() => setDetail(null)}
            onRedeem={() => void redeem(detail)}
          />
        )}
      </main>
      {communityDirectoryOpen && <CommunityDirectory communities={communities} selectedOrganizationId={organizationId} onClose={() => setCommunityDirectoryOpen(false)} onSelect={(nextOrganizationId) => { setCommunityDirectoryOpen(false); void selectMarketplace("partner", nextOrganizationId); }} />}
    </div>
  );
}
