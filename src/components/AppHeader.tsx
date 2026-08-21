import { Dumbbell, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export function AppHeader() {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-mark"><Dumbbell size={19} /></div>
        <div><strong>DadoFit</strong><span>Entrena. Lanza. Repite.</span></div>
      </div>
      <div className="account-chip">
        <UserRound size={16}/>
        <span>{user?.name ?? 'Invitado'}</span>
        <button type="button" onClick={logout} aria-label="Cerrar sesión"><LogOut size={16}/></button>
      </div>
    </header>
  );
}
