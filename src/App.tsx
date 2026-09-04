import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useWorkspace, workspaceHome, type WorkspaceKind } from './context/WorkspaceContext';
import { PlatformAccountGate } from './admin/PlatformAccountGate';
import { PlatformAdminRoute } from './admin/PlatformAdminRoute';
import { SiteFooter } from './components/SiteFooter';
import { MonetizedPageShell } from './components/MonetizedPageShell';
import './styles/v14.2-monetization-network.css';
import './styles/v15-rewards-marketplace.css';
import './styles/v15.1-reward-fulfillment.css';
import './styles/v15.2-reward-qr-fulfillment.css';
import './styles/v15.3-gym-economy-monetization.css';
import { AdminPage } from './pages/AdminPage';
import { BrandAuditPage } from './pages/BrandAuditPage';
import { BrandCampaignsPage } from './pages/BrandCampaignsPage';
import { ChallengesPage } from './pages/ChallengesPage';
import { BusinessSetupPage } from './pages/BusinessSetupPage';
import { ContactPage } from './pages/ContactPage';
import { GymbrosPage } from './pages/GymbrosPage';
import { GymBattlesPage } from './pages/GymBattlesPage';
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrganizationChallengesPage } from './pages/OrganizationChallengesPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RewardsMarketplacePage } from './pages/RewardsMarketplacePage';
import { RewardManagementPage } from './pages/RewardManagementPage';
import { RewardValidationPage } from './pages/RewardValidationPage';
import { RegisterPage } from './pages/RegisterPage';
import { SponsoredChallengesPage } from './pages/SponsoredChallengesPage';
import { SquadsPage } from './pages/SquadsPage';
import { WorkoutPage } from './pages/WorkoutPage';
import { WorkspaceHomePage } from './pages/WorkspaceHomePage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <PlatformAccountGate>{children}</PlatformAccountGate>;
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
  if (user.provider === 'supabase' && needsBusinessSetup && (signupIntent === 'gym' || signupIntent === 'brand')) return <Navigate to={`/business-setup?type=${signupIntent}`} replace/>;
  return <Navigate to={workspaceHome(activeWorkspace)} replace/>;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  return <>
    <Routes>
      <Route path="/" element={<WorkspaceRedirect/>}/>
      <Route path="/login" element={<LoginPage/>}/>
      <Route path="/register" element={<RegisterPage/>}/>
      <Route path="/contact" element={<ContactPage/>}/>
      <Route path="/terms" element={<LegalPage document="terms"/>}/>
      <Route path="/privacy" element={<LegalPage document="privacy"/>}/>
      <Route path="/cookies" element={<LegalPage document="cookies"/>}/>
      <Route path="/data-policy" element={<LegalPage document="data"/>}/>
      <Route path="/community-guidelines" element={<LegalPage document="community"/>}/>
      <Route path="/business-setup" element={<ProtectedRoute><BusinessSetupPage/></ProtectedRoute>}/>
      <Route path="/admin/*" element={<ProtectedRoute><PlatformAdminRoute><AdminPage/></PlatformAdminRoute></ProtectedRoute>}/>
      <Route path="/app" element={<ProtectedRoute><WorkspaceRoute allow={['personal','gym']}><WorkoutPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/workspace" element={<ProtectedRoute><WorkspaceRoute allow={['gym','brand']}><MonetizedPageShell workspaceKinds={['gym']}><WorkspaceHomePage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/profile" element={<ProtectedRoute><MonetizedPageShell><ProfilePage/></MonetizedPageShell></ProtectedRoute>}/>
      <Route path="/notifications" element={<ProtectedRoute><MonetizedPageShell><NotificationsPage/></MonetizedPageShell></ProtectedRoute>}/>
      <Route path="/gymbros" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><MonetizedPageShell><GymbrosPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/challenges" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><MonetizedPageShell><ChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/squads" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><MonetizedPageShell><SquadsPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/sponsored-challenges" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><MonetizedPageShell><SponsoredChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards" element={<ProtectedRoute><WorkspaceRoute allow={['personal']}><MonetizedPageShell><RewardsMarketplacePage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards/manage" element={<ProtectedRoute><WorkspaceRoute allow={['gym','brand']}><MonetizedPageShell workspaceKinds={['gym']}><RewardManagementPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards/validate" element={<ProtectedRoute><MonetizedPageShell workspaceKinds={['gym']}><RewardValidationPage/></MonetizedPageShell></ProtectedRoute>}/>
      <Route path="/organizations" element={<ProtectedRoute><WorkspaceRoute allow={['personal','gym','brand']}><MonetizedPageShell workspaceKinds={['personal','gym']}><OrganizationsPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/organization-challenges" element={<ProtectedRoute><WorkspaceRoute allow={['personal','gym']}><MonetizedPageShell workspaceKinds={['personal','gym']}><OrganizationChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/gym-battles" element={<ProtectedRoute><WorkspaceRoute allow={['gym']}><MonetizedPageShell workspaceKinds={['gym']}><GymBattlesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/brand-campaigns" element={<ProtectedRoute><WorkspaceRoute allow={['brand']}><BrandCampaignsPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/brand-audit" element={<ProtectedRoute><WorkspaceRoute allow={['brand']}><BrandAuditPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/dashboard" element={<Navigate to="/" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
    <SiteFooter/>
  </>;
}
