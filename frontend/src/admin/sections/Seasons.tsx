import { Building2, CalendarDays, Pencil, RefreshCw, Trophy } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { backend } from "../../lib/backend";
import { AdminEmptyState, AdminLoadingState, AdminStatusBadge } from "../components/AdminVisual";
import { AdminShell, type Row, date, fmt, useRpc } from "./shared";

export function SeasonsAdmin() {
  const q = useRpc("admin_list_competitive_seasons");
  const [name, setName] = useState("");
  const [type, setType] = useState<"squad" | "gym">("gym");
  const now = new Date();
  const next = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const local = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [start, setStart] = useState(local(now));
  const [end, setEnd] = useState(local(next));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const rows = (q.data ?? []) as Row[];

  const loadOptions = useCallback(
    async (seasonType: "squad" | "gym", keepSelected = false) => {
      if (!backend) return;
      setOptionsLoading(true);
      const { data, error: rpcError } = await backend.rpc(
        "admin_competitive_season_options",
        { p_season_type: seasonType },
      );
      setOptionsLoading(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      const nextOptions = (data ?? []) as Row[];
      setOptions(nextOptions);
      if (!keepSelected) setSelected([]);
    },
    [],
  );

  useEffect(() => {
    void loadOptions(type, Boolean(editingId));
  }, [type, editingId, loadOptions]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setStart(local(new Date()));
    setEnd(local(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)));
    setSelected([]);
    setError("");
  };
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!backend) return;
    if (selected.length === 0) {
      setError(
        `Selecciona al menos un ${type === "gym" ? "Gym" : "Squad"} para la temporada.`,
      );
      return;
    }
    setSaving(true);
    setError("");
    const args = {
      p_name: name.trim(),
      p_starts_at: new Date(start).toISOString(),
      p_ends_at: new Date(end).toISOString(),
      p_entry_ids: selected,
    };
    const result = editingId
      ? await backend.rpc("admin_update_competitive_season", {
          p_season_id: editingId,
          ...args,
        })
      : await backend.rpc("admin_create_competitive_season", {
          p_season_type: type,
          ...args,
        });
    setSaving(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    resetForm();
    await q.load();
  };

  const edit = (r: Row) => {
    setEditingId(r.id);
    setType(r.season_type as "squad" | "gym");
    setName(r.name ?? "");
    setStart(local(new Date(r.starts_at)));
    setEnd(local(new Date(r.ends_at)));
    setSelected(((r.participants ?? []) as Row[]).map((item) => item.id));
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const setStatus = async (id: string, status: string) => {
    if (!backend) return;
    setError("");
    const { error: rpcError } = await backend.rpc(
      "admin_set_competitive_season_status",
      { p_season_id: id, p_status: status },
    );
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (editingId === id) resetForm();
    void q.load();
  };

  return (
    <AdminShell
      title="Temporadas de Competitive Score"
      subtitle="Define ventanas competitivas y selecciona qué Squads o Gyms participan, sin borrar el histórico del ledger."
    >
      {(error || q.error) && (
        <div className="auth-error">{error || q.error}</div>
      )}
      <section className="admin-season-grid-v157">
        <form className="admin-card-v14 admin-season-form-v157" onSubmit={save}>
          <span className="eyebrow">
            {editingId ? "EDITAR TEMPORADA" : "NUEVA TEMPORADA"}
          </span>
          <h2>
            {editingId
              ? "Corregir ventana competitiva"
              : "Crear ventana competitiva"}
          </h2>
          <label>
            Tipo
            <select
              value={type}
              disabled={Boolean(editingId)}
              onChange={(e) => setType(e.target.value as "squad" | "gym")}
            >
              <option value="gym">Gym · Competitive Score</option>
              <option value="squad">Squad · Competitive Score</option>
            </select>
          </label>
          <label>
            Nombre
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === "gym"
                  ? "Temporada Gym · Octubre"
                  : "Temporada Squad · Octubre"
              }
            />
          </label>
          <div className="admin-form-grid-v14">
            <label>
              Inicio
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Fin
              <input
                type="datetime-local"
                required
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="admin-season-picker-v1573">
            <legend>
              {type === "gym" ? "Gyms participantes" : "Squads participantes"}{" "}
              <small>{selected.length} seleccionados</small>
            </legend>
            <div className="admin-season-picker-actions-v1573">
              <button
                type="button"
                onClick={() => setSelected(options.map((item) => item.id))}
              >
                Seleccionar todos
              </button>
              <button type="button" onClick={() => setSelected([])}>
                Limpiar
              </button>
            </div>
            {optionsLoading ? (
              <div className="admin-season-picker-empty-v1573">
                Cargando participantes…
              </div>
            ) : options.length === 0 ? (
              <div className="admin-season-picker-empty-v1573">
                No hay {type === "gym" ? "Gyms" : "Squads"} disponibles.
              </div>
            ) : (
              <div className="admin-season-picker-list-v1573">
                {options.map((item) => (
                  <label
                    key={item.id}
                    className={selected.includes(item.id) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <strong>{item.name}</strong>
                      {type === "gym" && item.verification_status && (
                        <small>{item.verification_status}</small>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="admin-season-form-actions-v1573">
            <button
              className="admin-season-save-v1573"
              disabled={saving || selected.length === 0}
            >
              {saving
                ? editingId
                  ? "Guardando…"
                  : "Creando…"
                : editingId
                  ? "Guardar cambios"
                  : "Crear temporada"}
            </button>
            {editingId && (
              <button
                className="admin-season-cancel-v1573"
                type="button"
                onClick={resetForm}
              >
                Cancelar edición
              </button>
            )}
          </div>
          <small>
            No se permite solapar dos temporadas activas/próximas del mismo
            tipo. El sistema ahora te dirá cuál temporada entra en conflicto.
          </small>
        </form>
        <section className="admin-card-v14">
          <div className="admin-season-head-v157">
            <div>
              <span className="eyebrow">HISTÓRICO</span>
              <h2>Temporadas configuradas</h2>
            </div>
            <button
              type="button"
              className="admin-refresh-v14"
              onClick={() => void q.load()}
            >
              <RefreshCw size={14} /> Actualizar
            </button>
          </div>
          {q.loading ? (
            <AdminLoadingState rows={4}/>
          ) : rows.length === 0 ? (
            <AdminEmptyState icon={<CalendarDays size={22}/>} title="No hay temporadas." description="Crea una ventana competitiva para empezar a medir Competitive Score."/>
          ) : (
            <div className="admin-season-list-v157">
              {rows.map((r) => (
                <article key={r.id}>
                  <div>
                    <span className="admin-season-icon-v157">
                      {r.season_type === "gym" ? (
                        <Building2 size={17} />
                      ) : (
                        <Trophy size={17} />
                      )}
                    </span>
                    <div>
                      <strong>{r.name}</strong>
                      <small>
                        {r.season_type === "gym" ? "Gym · Competitive Score" : "Squad · Competitive Score"} ·{" "}
                        {date(r.starts_at)} → {date(r.ends_at)} ·{" "}
                        {fmt(r.score_events)} eventos
                      </small>
                      <small className="admin-season-participants-v1573">
                        {((r.participants ?? []) as Row[]).length
                          ? ((r.participants ?? []) as Row[])
                              .map((item) => item.name)
                              .join(" · ")
                          : "Alcance legado: todos los participantes"}
                      </small>
                    </div>
                  </div>
                  <footer>
                    <AdminStatusBadge status={r.status}/>
                    {r.status === "upcoming" && (
                      <small className="admin-season-auto-v157">
                        Se activa automáticamente al iniciar
                      </small>
                    )}
                    {["upcoming", "active"].includes(r.status) && (
                      <button
                        type="button"
                        className="admin-season-edit-v1574"
                        onClick={() => edit(r)}
                      >
                        <Pencil size={12} /> Editar
                      </button>
                    )}
                    {r.status === "active" && (
                      <button
                        type="button"
                        className="admin-season-close-v157"
                        onClick={() => void setStatus(r.id, "completed")}
                      >
                        Cerrar temporada
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </AdminShell>
  );
}
