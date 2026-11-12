import { Building2, Gift, Heart, Search, Sparkles, Star, Store, Trophy, X, Zap } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { blockedReasonLabel, filterPartnerMarketplaces, normalizePartnerIcon, safePartnerColor, type CatalogRewardDto, type IntegerValue, type PartnerMarketplaceDto, type MarketplaceState } from "../../lib/partnerMarketplace";
import { date, fmt, fulfillmentLabels } from "./model";

export function PartnerIcon({ value }: { value: string | null }) {
  const key = normalizePartnerIcon(value);
  if (key === "star") return <Star />;
  if (key === "sparkles") return <Sparkles />;
  if (key === "building") return <Building2 />;
  if (key === "trophy") return <Trophy />;
  if (key === "heart") return <Heart />;
  if (key === "zap") return <Zap />;
  return <Store />;
}

export function CommunityButton({
  community,
  active,
  onSelect,
}: {
  community: PartnerMarketplaceDto;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? "active" : ""}
      style={{ "--community-accent": safePartnerColor(community.points_color) } as CSSProperties}
      onClick={onSelect}
    >
      <span className="community-logo">
        {community.organization_logo ? (
          <img src={community.organization_logo} alt="" />
        ) : (
          <PartnerIcon value={community.points_icon} />
        )}
      </span>
      <span>
        <strong>{community.organization_name}</strong>
        <small>{fmt(community.balance)} {community.points_short_name}</small>
      </span>
      <i>
        {community.marketplace_state === "OPERATIONAL"
          ? "Ver marketplace"
          : community.marketplace_state === "DISABLED"
            ? "Suspendido"
            : "Solo historial"}
      </i>
    </button>
  );
}

export function CommunityDirectory({
  communities,
  selectedOrganizationId,
  onClose,
  onSelect,
}: {
  communities: PartnerMarketplaceDto[];
  selectedOrganizationId: string | null;
  onClose: () => void;
  onSelect: (organizationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<MarketplaceState | "ALL">("ALL");
  const closeButton = useRef<HTMLButtonElement>(null);
  const results = filterPartnerMarketplaces(communities, query, state);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", keydown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="community-directory-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="community-directory" role="dialog" aria-modal="true" aria-labelledby="community-directory-title">
        <header>
          <div><span>MARKETPLACES PARTNER</span><h2 id="community-directory-title">Mis comunidades</h2><p>Busca y selecciona dónde quieres usar tus Partner Points.</p></div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Cerrar comunidades"><X /></button>
        </header>
        <div className="community-directory-tools">
          <label><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar comunidad o puntos…" /></label>
          <div role="group" aria-label="Filtrar comunidades">
            {([['ALL','Todas'],['OPERATIONAL','Disponibles'],['DISABLED','Suspendidas'],['HISTORY_ONLY','Historial']] as const).map(([value,label]) => (
              <button type="button" key={value} className={state === value ? "active" : ""} onClick={() => setState(value)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="community-directory-results" aria-live="polite">
          {results.length ? results.map((community) => (
            <CommunityButton key={community.organization_id} community={community} active={selectedOrganizationId === community.organization_id} onSelect={() => onSelect(community.organization_id)} />
          )) : <div className="community-directory-empty"><Search /><strong>No encontramos comunidades</strong><span>Prueba otro nombre o cambia el filtro.</span></div>}
        </div>
        <footer>{results.length} de {communities.length} comunidades</footer>
      </section>
    </div>
  );
}

export function RewardDetail({
  reward,
  balance,
  acting,
  onClose,
  onRedeem,
}: {
  reward: CatalogRewardDto;
  balance: IntegerValue;
  acting: boolean;
  onClose: () => void;
  onRedeem: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href]",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [onClose]);
  const reason = blockedReasonLabel(reward.blocked_reason);
  return (
    <div
      className="reward-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="reward-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-detail-title"
      >
        <header>
          <div>
            <span>{reward.organization_name}</span>
            <h2 id="reward-detail-title">{reward.title}</h2>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            <X />
          </button>
        </header>
        <div className="reward-detail-scroll">
          {reward.image_url ? (
            <img
              className="reward-detail-image"
              src={reward.image_url}
              alt={`Premio ${reward.title}`}
            />
          ) : (
            <div className="reward-detail-placeholder">
              <Gift size={44} aria-hidden="true" />
            </div>
          )}
          <p>
            {reward.description ||
              "Beneficio exclusivo dentro del ecosistema DadoFit."}
          </p>
          <dl className="reward-detail-facts">
            <div>
              <dt>Costo</dt>
              <dd>
                {fmt(reward.native_cost)} {reward.points_short_name}
              </dd>
            </div>
            <div>
              <dt>Tu saldo</dt>
              <dd>
                {fmt(balance)} {reward.points_short_name}
              </dd>
            </div>
            <div>
              <dt>Stock</dt>
              <dd>
                {reward.remaining_stock === null
                  ? "Abierto"
                  : fmt(reward.remaining_stock)}
              </dd>
            </div>
            <div>
              <dt>Entrega</dt>
              <dd>{fulfillmentLabels[reward.fulfillment_type] ?? "Canje"}</dd>
            </div>
            <div>
              <dt>Vigencia</dt>
              <dd>
                {date(reward.starts_at)} a {date(reward.ends_at)}
              </dd>
            </div>
            <div>
              <dt>Límite</dt>
              <dd>
                {reward.user_redemptions} de {reward.max_per_user} usados
              </dd>
            </div>
          </dl>
          {reward.terms && (
            <section className="reward-detail-terms">
              <h3>Términos</h3>
              <p>{reward.terms}</p>
            </section>
          )}
          {!reward.can_redeem && (
            <p className="reward-detail-blocked" role="status">
              {reason}
            </p>
          )}
        </div>
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            Volver
          </button>
          <button
            type="button"
            className="primary"
            disabled={!reward.can_redeem || acting}
            onClick={onRedeem}
          >
            {acting
              ? "Canjeando…"
              : `Confirmar canje · ${fmt(reward.native_cost)} ${reward.points_short_name}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
