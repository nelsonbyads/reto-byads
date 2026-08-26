import { Bell, CheckCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';

interface NotificationRow { id: string; notification_type: string; title: string; body: string | null; data: Record<string, unknown> | null; read_at: string | null; created_at: string; }

function notificationTarget(item: NotificationRow): string {
  const type = item.notification_type;
  if (type.startsWith('gym_battle_') || item.data?.organization_battle_id) return '/gym-battles';
  if (type.startsWith('organization_challenge_')) return '/organization-challenges';
  if (type.startsWith('organization_') || item.data?.organization_id) return '/organizations';
  if (type.startsWith('squad_') || item.data?.battle_id || item.data?.group_id) return '/squads';
  if (type.startsWith('challenge_') || item.data?.challenge_id) return '/challenges';
  if (type.startsWith('friend')) return '/gymbros';
  return '/profile';
}

function formatWhen(value: string): string { try { return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); } catch { return ''; } }

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false); const [items, setItems] = useState<NotificationRow[]>([]); const [unreadCount, setUnreadCount] = useState(0); const [loading, setLoading] = useState(false); const [markingAll, setMarkingAll] = useState(false); const [error, setError] = useState('');
  const cloudReady = user?.provider === 'supabase' && Boolean(supabase);

  const load = useCallback(async () => {
    if (!cloudReady || !user || !supabase) return;
    const client = supabase; setLoading(true); setError('');
    const [itemsResult, countResult] = await Promise.all([
      client.from('notifications').select('id, notification_type, title, body, data, read_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
      client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null),
    ]);
    if (itemsResult.error || countResult.error) setError(itemsResult.error?.message ?? countResult.error?.message ?? 'No pudimos cargar las notificaciones.');
    else { setItems((itemsResult.data ?? []) as NotificationRow[]); setUnreadCount(Number(countResult.count ?? 0)); }
    setLoading(false);
  }, [cloudReady, user]);

  useEffect(() => { if (!cloudReady) return; void load(); const interval = window.setInterval(() => { void load(); }, 20000); const handleFocus = () => { void load(); }; window.addEventListener('focus', handleFocus); return () => { window.clearInterval(interval); window.removeEventListener('focus', handleFocus); }; }, [cloudReady, load]);

  const markRead = async (id: string) => { if (!supabase || !user) return; const now = new Date().toISOString(); const { error: updateError } = await supabase.from('notifications').update({ read_at: now }).eq('id', id).eq('user_id', user.id).is('read_at', null); if (!updateError) { setItems((current) => current.map((item) => item.id === id ? { ...item, read_at: item.read_at ?? now } : item)); setUnreadCount((current) => Math.max(0, current - 1)); } };
  const markAllRead = async () => { if (!supabase || unreadCount === 0) return; setMarkingAll(true); setError(''); const { error: rpcError } = await supabase.rpc('mark_all_notifications_read'); setMarkingAll(false); if (rpcError) { setError(rpcError.message); return; } const now = new Date().toISOString(); setItems((current) => current.map((item) => item.read_at ? item : { ...item, read_at: now })); setUnreadCount(0); };

  if (!cloudReady) return null;
  return <div className="notification-bell-v112"><button type="button" className="notification-bell-trigger-v112" aria-label={unreadCount ? `${unreadCount} notificaciones sin leer` : 'Notificaciones'} aria-expanded={open} onClick={() => { setOpen((value) => !value); if (!open) void load(); }}><Bell size={16}/>{unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>{open && <section className="notification-popover-v112 notification-popover-v113"><header><div><strong>Notificaciones</strong><span>{unreadCount} sin leer</span></div>{unreadCount > 0 && <button type="button" onClick={() => { void markAllRead(); }} disabled={markingAll}><CheckCheck size={14}/>{markingAll ? 'Marcando…' : 'Marcar todas'}</button>}</header>{error && <p className="notification-error-v113">{error}</p>}{loading && items.length === 0 ? <p className="notification-empty-v112">Cargando…</p> : items.length === 0 ? <p className="notification-empty-v112">Aún no tienes notificaciones.</p> : <div className="notification-list-v112">{items.map((item) => <Link key={item.id} to={notificationTarget(item)} className={item.read_at ? '' : 'unread'} onClick={() => { if (!item.read_at) void markRead(item.id); setOpen(false); }}><i/><div><strong>{item.title}</strong>{item.body && <span>{item.body}</span>}<small>{formatWhen(item.created_at)}</small></div></Link>)}</div>}<footer className="notification-footer-v113"><Link to="/notifications" onClick={() => setOpen(false)}>Ver todas las notificaciones</Link></footer></section>}</div>;
}
