import { BadgeCheck, Building2, ClipboardList, Coins, FileSearch, LayoutDashboard, Megaphone, Tag, Trophy, UsersRound } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { backend } from "../../lib/backend";
import type { RpcArgs, RpcName } from "../../types/database";
import { AdminPageHeader } from "../components/AdminVisual";

export type Row = Record<string, any>;
export const SECTIONS = [
  ["/admin", "Dashboard", LayoutDashboard],
  ["/admin/users", "Usuarios", UsersRound],
  ["/admin/organizations", "Organizaciones", Building2],
  ["/admin/brands", "Marcas", BadgeCheck],
  ["/admin/campaigns", "Campañas", Tag],
  ["/admin/requests", "Solicitudes", ClipboardList],
  ["/admin/rewards", "Rewards", Coins],
  ["/admin/seasons", "Temporadas", Trophy],
  ["/admin/ads", "Publicidad", Megaphone],
  ["/admin/audit", "Auditoría", FileSearch],
] as const;
export const fmt = (v: any) => Number(v ?? 0).toLocaleString("es-CO");
export const date = (v: any) =>
  v
    ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "—";

export function AdminShell({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title: string;
  subtitle: string;
}) {
  const { user, logout } = useAuth();
  return (
    <div className="admin-shell-v14">
      <aside className="admin-sidebar-v14">
        <Link to="/admin" className="admin-brand-v14">
          <span>⚄</span>
          <div>
            <strong>DadoFit Admin</strong>
            <small>SuperAdmin</small>
          </div>
        </Link>
        <nav>
          {SECTIONS.map(([to, label, Icon]) => (
            <NavLink
              key={to}
              end={to === "/admin"}
              to={to}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer-v14">
          <strong>{user?.name}</strong>
          <small>{user?.email}</small>
          <Link to="/app">Volver a DadoFit</Link>
          <Link to="/contact">Formulario de contacto</Link>
          <button onClick={() => void logout()}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="admin-main-v14">
        <AdminPageHeader title={title} subtitle={subtitle} />
        {children}
      </main>
    </div>
  );
}

export function useRpc<N extends RpcName>(name: N, args?: RpcArgs<N>) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!backend) return;
    setLoading(true);
    setError("");
    const res = await backend.rpc(name, args);
    setLoading(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    setData(res.data);
  }, [name, JSON.stringify(args ?? {})]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, loading, error, load };
}
