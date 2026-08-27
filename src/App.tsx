import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useWorkspace, workspaceHome, type WorkspaceKind } from './context/WorkspaceContext';
import { ChallengesPage } from './pages/ChallengesPage';
import { BusinessSetupPage } from './pages/BusinessSetupPage';
import { GymbrosPage } from './pages/GymbrosPage';
import { GymBattlesPage } from './pages/GymBattlesPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrganizationChallengesPage } from './pages/OrganizationChallengesPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { SquadsPage } from './pages/SquadsPage';
import { WorkoutPage } from './pages/WorkoutPage';
import { WorkspaceHomePage } from './pages/WorkspaceHomePage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

function WorkspaceRoute({ allow, children }: { allow: WorkspaceKind[]; children: ReactNode }) {
  const { loading, activeWorkspace } = useWorkspace();
  if (loading) return <main className="auth-loading">Cargando workspace…</main>;
  if (!allow.includes(activeWorkspace.kind)) return <Navigate to={workspaceHome(activeWorkspace)} replace/>;
  return children;
}

function WorkspaceRedirect() {
  const { user } = useAuth();
  const { loading, activeWorkspace, signupIntent, needsBusinessSetup } = useWorkspace();
  if (!user) return <Navigate to="/login" replace/>;
  if (loading) return <main className="auth-loading">Cargando workspace…</main>;
  if (user.provider === 'supabase' && needsBusinessSetup && (signupIntent === 'gym' || signupIntent === 'brand')) {
    return <Navigate to={`/business-setup?type=${signupIntent}`} replace/>;
  }
  return <Navigate to={workspaceHome(activeWorkspace)} replace/>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;

  return (
    <Routes>
      <Route path="/" element={<WorkspaceRedirect/>}/>
      <Route path="/login" element={<LoginPage/>}/>
      <Route path="/register" element={<RegisterPage/>}/>
      <Route path="/business-setup" element={<ProtectedRoute><BusinessSetupPage/></ProtectedRoute>}/>

      <Route path="/app" element={<ProtectedRoute><WorkspaceRoute allow={['personal', 'gym']}><WorkoutPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/workspace" element={<ProtectedRoute><WorkspaceRoute allow={['gym', 'brand']}><WorkspaceHomePage/></WorkspaceRoute></ProtectedRoute>}/>

      <Route path="/profile" element={<ProtectedRoute><ProfilePage/></ProtectedRoute>}/>
      <Route path="/notifications" element={<ProtectedRoute><NotificationsPage/></ProtectedRoute>}/>

      <Route path="/gymbros" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><GymbrosPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/challenges" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><ChallengesPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/squads" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><SquadsPage/></WorkspaceRoute></ProtectedRoute>}/>

      <Route path="/organizations" element={<ProtectedRoute><WorkspaceRoute allow={['personal', 'gym', 'brand']}><OrganizationsPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/organization-challenges" element={<ProtectedRoute><WorkspaceRoute allow={['personal', 'gym']}><OrganizationChallengesPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/gym-battles" element={<ProtectedRoute><WorkspaceRoute allow={['gym']}><GymBattlesPage/></WorkspaceRoute></ProtectedRoute>}/>

      <Route path="/dashboard" element={<Navigate to="/" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  );
}
