import { Building2, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { backend } from "../../lib/backend";
import { PARTNER_ICON_KEYS } from "../../lib/partnerMarketplace";
import { AdminEmptyState, AdminFilterBar, AdminRowActions, AdminStatusBadge, AdminTable, AdminTruncate } from "../components/AdminVisual";
import { AdminShell, type Row, date, useRpc } from "./shared";

export function PartnerEconomyDialog({ organization, config, onClose, onSaved }: { organization: Row; config: Row; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ pointsName: config.points_name ?? "Partner Points", shortName: config.points_short_name ?? "PP", icon: config.points_icon ?? "", color: config.points_color ?? "#64748B", enabled: Boolean(config.enabled) });
  const [persistedEnabled, setPersistedEnabled] = useState(Boolean(config.enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const changeForm = (next: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...next }));
    setError("");
    setSuccess("");
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", keydown);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = ""; previous?.focus(); };
  }, [onClose]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!backend) return;
    const shortName = form.shortName.trim().toUpperCase();
    setError(""); setSuccess("");
    if (["DC", "TP", "XP"].includes(shortName)) { setError(`${shortName} es una abreviatura reservada. Usa GP, SP u otra abreviatura propia.`); return; }
    if (form.enabled && organization.verification_status !== "verified") { setError("La organización debe estar verificada antes de activar su economía."); return; }
    if (!form.enabled && persistedEnabled && !window.confirm("¿Suspender esta economía? Los saldos y el historial se conservarán, pero los canjes quedarán bloqueados.")) return;
    setSaving(true);
    const { error: rpcError } = await backend.rpc("admin_update_partner_point_config", { p_organization_id: organization.organization_id, p_points_name: form.pointsName.trim(), p_points_short_name: shortName, p_points_icon: form.icon || null, p_points_color: form.color, p_enabled: form.enabled });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    setForm((current) => ({ ...current, shortName }));
    setPersistedEnabled(form.enabled);
    setSuccess(form.enabled ? "Economía Partner activada correctamente." : "Economía Partner suspendida. Los saldos se conservaron.");
    onSaved();
  };
  return createPortal(
    <div className="admin-partner-economy-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="admin-partner-economy-dialog" role="dialog" aria-modal="true" aria-labelledby="partner-economy-title">
        <header><div><span className="eyebrow">ECONOMÍA PARTNER</span><h2 id="partner-economy-title">{organization.name}</h2><p>Configura y controla la moneda de este marketplace.</p></div><button ref={closeRef} type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          {error && <div className="auth-error" role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}
          <div className="admin-partner-economy-fields"><label>Nombre de los puntos<input required minLength={2} maxLength={60} value={form.pointsName} onChange={(event) => changeForm({ pointsName: event.target.value })}/></label><label>Abreviatura<input required minLength={1} maxLength={8} value={form.shortName} onChange={(event) => changeForm({ shortName: event.target.value.toUpperCase() })}/></label></div>
          <div className="admin-partner-economy-fields"><label>Ícono<select value={form.icon} onChange={(event) => changeForm({ icon: event.target.value })}><option value="">Ícono predeterminado</option>{PARTNER_ICON_KEYS.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label><label>Color<input type="color" value={form.color} onChange={(event) => changeForm({ color: event.target.value })}/></label></div>
          <label className="admin-partner-economy-toggle"><input type="checkbox" checked={form.enabled} disabled={organization.verification_status !== "verified"} onChange={(event) => changeForm({ enabled: event.target.checked })}/><span><strong>Economía activa</strong><small>{form.enabled ? "Los usuarios pueden acceder al marketplace y realizar canjes." : "El marketplace y los canjes están suspendidos."}</small></span></label>
          {organization.verification_status !== "verified" && <div className="admin-partner-economy-note">Primero verifica la organización para poder activar su economía.</div>}
          <div className="admin-partner-economy-note">Este cambio no elimina saldos, movimientos, ofertas ni historial.</div>
          <footer><button type="button" onClick={onClose}>Cancelar</button><button className="admin-primary-v14" type="submit" disabled={saving}>{saving ? "Guardando…" : form.enabled ? "Guardar y activar" : "Guardar suspendida"}</button></footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

export function Organizations({ brandsOnly = false }: { brandsOnly?: boolean }) {
  const q = useRpc("admin_list_organizations");
  const economies = useRpc("admin_list_partner_economies");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [economyDialog, setEconomyDialog] = useState<{ organization: Row; config: Row } | null>(null);
  const economyByOrganization = useMemo(() => new Map(((economies.data ?? []) as Row[]).map((row) => [row.organization_id, row])), [economies.data]);
  const rows = useMemo(
    () =>
      ((q.data ?? []) as Row[]).filter(
        (r) =>
          (!brandsOnly || ["brand", "sponsor", "company"].includes(r.organization_type)) &&
          (!statusFilter || r.verification_status === statusFilter) &&
          (!search || `${r.name} ${r.owner_name} ${r.owner_email}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [q.data, brandsOnly, search, statusFilter],
  );
  const verify = async (r: Row, status: string) => {
    if (!backend) return;
    const needsReason = status === "rejected" || status === "suspended";
    const reason = needsReason
      ? window.prompt(
          status === "rejected"
            ? "Motivo del rechazo:"
            : "Motivo de suspensión:",
        )
      : null;
    if (needsReason && !reason) return;
    const { error } = await backend.rpc(
      "admin_set_organization_verification",
      {
        p_organization_id: r.organization_id,
        p_status: status,
        p_reason: reason,
      },
    );
    if (error) alert(error.message);
    else void q.load();
  };
  return (
    <AdminShell
      title={brandsOnly ? "Marcas" : "Organizaciones"}
      subtitle={
        brandsOnly
          ? "Verificación y control de Brands, Sponsors y empresas."
          : "Aprobación y control de Gyms, Marcas y organizaciones."
      }
    >
      <AdminFilterBar><Search size={16}/><input aria-label="Buscar organizaciones" placeholder="Nombre, owner o email" value={search} onChange={(event) => setSearch(event.target.value)}/><select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos los estados</option><option value="verified">Verificadas</option><option value="pending_verification">Pendientes</option><option value="suspended">Suspendidas</option><option value="rejected">Rechazadas</option></select><button className="admin-filter-spacer-v14" onClick={() => void q.load()}><RefreshCw size={14}/> Actualizar</button></AdminFilterBar>
      {(q.error || economies.error) && <div className="auth-error">{q.error || economies.error}</div>}
      <AdminTable loading={q.loading} empty={!q.error && rows.length === 0 ? <AdminEmptyState icon={<Building2 size={22}/>} title={brandsOnly ? "No hay marcas" : "No hay organizaciones"} description="No hay resultados para los filtros seleccionados."/> : undefined}>
        <table>
          <thead>
            <tr>
              <th scope="col">Organización</th>
              <th scope="col">Tipo</th>
              <th scope="col">Owner</th>
              <th scope="col">Miembros</th>
              <th scope="col">Estado</th>
              <th scope="col">Economía Partner</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const economy = economyByOrganization.get(r.organization_id);
              const supportsEconomy = ["gym", "brand", "company"].includes(r.organization_type);
              const economyAction = supportsEconomy && economy ? { label: economy.enabled ? "Configurar economía" : "Activar economía", onClick: () => setEconomyDialog({ organization: r, config: economy }) } : undefined;
              return (
              <tr key={r.organization_id}>
                <td>
                  <strong>{r.name}</strong>
                  <small>{date(r.created_at)}</small>
                </td>
                <td>{r.organization_type}</td>
                <td>
                  {r.owner_name}
                  <small><AdminTruncate value={r.owner_email} /></small>
                </td>
                <td>{r.members}</td>
                <td>
                  <AdminStatusBadge status={r.verification_status}/>
                </td>
                <td>{supportsEconomy ? <span className={`admin-economy-state ${economy?.enabled ? "active" : "suspended"}`}>{economy?.enabled ? "Activa" : "Suspendida"}</span> : "—"}</td>
                <td><AdminRowActions primary={r.verification_status !== "verified" ? { label: r.organization_type === "gym" ? "Aprobar" : "Verificar", onClick: () => void verify(r, "verified") } : economyAction} actions={[
                  ...(r.verification_status !== "verified" && economyAction ? [economyAction] : []),
                  ...(r.verification_status !== "pending_verification" ? [{ label: "Marcar pendiente", onClick: () => void verify(r, "pending_verification") }] : []),
                  ...(r.verification_status !== "suspended" ? [{ label: "Suspender", danger: true, onClick: () => void verify(r, "suspended") }] : []),
                  ...(r.verification_status !== "rejected" ? [{ label: "Rechazar", danger: true, onClick: () => void verify(r, "rejected") }] : []),
                ]}/></td>
              </tr>
            )})}
          </tbody>
        </table>
      </AdminTable>
      {economyDialog && <PartnerEconomyDialog organization={economyDialog.organization} config={economyDialog.config} onClose={() => setEconomyDialog(null)} onSaved={() => void economies.load()}/>}
    </AdminShell>
  );
}
