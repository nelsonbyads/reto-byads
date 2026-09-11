import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { useWorkspace, workspaceHome, type WorkspaceKind } from './context/WorkspaceContext';
import { WORKSPACE_ROUTE_ACCESS } from './lib/workspaceNavigation';
import { PlatformAccountGate } from './admin/PlatformAccountGate';
import { PlatformAdminRoute } from './admin/PlatformAdminRoute';
import { SiteFooter } from './components/SiteFooter';
import { MonetizedPageShell } from './components/MonetizedPageShell';
import './styles/v14.2-monetization-network.css';
import './styles/v15-rewards-marketplace.css';
import './styles/v15.1-reward-fulfillment.css';
import './styles/v15.2-reward-qr-fulfillment.css';
import './styles/v15.2.1-filter-overlay-legibility.css';
import './styles/v15.3-gym-economy-monetization.css';
import './styles/v15.4-reward-analytics.css';
import './styles/v15.7-pre-release.css';
import './styles/v15.7.11-economy-foundation.css';
import './styles/v15.7.12-brand-editing.css';
import './styles/v15.7.13-account-security.css';
import { AdminPage } from './pages/AdminPage';
import { BrandAuditPage } from './pages/BrandAuditPage';
import { BrandCampaignsPage } from './pages/BrandCampaignsPage';
import { BrandCompetitionsPage } from './pages/BrandCompetitionsPage';
import { ChallengesPage } from './pages/ChallengesPage';
import { BusinessSetupPage } from './pages/BusinessSetupPage';
import { ContactPage } from './pages/ContactPage';
import { GymbrosPage } from './pages/GymbrosPage';
import { GymBattlesPage } from './pages/GymBattlesPage';
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OrganizationChallengesPage } from './pages/OrganizationChallengesPage';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { ProfilePage } from './pages/ProfilePage';
import { RewardsMarketplacePage } from './pages/RewardsMarketplacePage';
import { RewardManagementPage } from './pages/RewardManagementPage';
import { RewardAnalyticsPage } from './pages/RewardAnalyticsPage';
import { RewardValidationPage } from './pages/RewardValidationPage';
import { RegisterPage } from './pages/RegisterPage';
import { SponsoredChallengesPage } from './pages/SponsoredChallengesPage';
import { SeasonHubPage } from './pages/SeasonHubPage';
import { SquadsPage } from './pages/SquadsPage';
import { WorkoutPage } from './pages/WorkoutPage';
import { WorkspaceHomePage } from './pages/WorkspaceHomePage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, recoveryMode } = useAuth();
  const location = useLocation();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (recoveryMode) return <Navigate to="/reset-password" replace/>;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <PlatformAccountGate>{children}</PlatformAccountGate>;
}

function WorkspaceRoute({ allow, children }: { allow: readonly WorkspaceKind[]; children: ReactNode }) {
  const { loading, activeWorkspace } = useWorkspace();
  if (loading) return <main className="auth-loading">Cargando workspace…</main>;
  if (!allow.includes(activeWorkspace.kind)) return <Navigate to={workspaceHome(activeWorkspace)} replace/>;
  return children;
}

function WorkspaceRedirect() {
  const { user, recoveryMode } = useAuth();
  const { loading, activeWorkspace, signupIntent, needsBusinessSetup } = useWorkspace();
  if (recoveryMode) return <Navigate to="/reset-password" replace/>;
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
      <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
      <Route path="/reset-password" element={<ResetPasswordPage/>}/>
      <Route path="/register" element={<RegisterPage/>}/>
      <Route path="/contact" element={<ContactPage/>}/>
      <Route path="/terms" element={<LegalPage document="terms"/>}/>
      <Route path="/privacy" element={<LegalPage document="privacy"/>}/>
      <Route path="/cookies" element={<LegalPage document="cookies"/>}/>
      <Route path="/data-policy" element={<LegalPage document="data"/>}/>
      <Route path="/community-guidelines" element={<LegalPage document="community"/>}/>
      <Route path="/business-setup" element={<ProtectedRoute><BusinessSetupPage/></ProtectedRoute>}/>
      <Route path="/admin/*" element={<ProtectedRoute><PlatformAdminRoute><AdminPage/></PlatformAdminRoute></ProtectedRoute>}/>
      <Route path="/app" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/app']}><WorkoutPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/workspace" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/workspace']}><MonetizedPageShell workspaceKinds={['gym']}><WorkspaceHomePage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/profile" element={<ProtectedRoute><MonetizedPageShell><ProfilePage/></MonetizedPageShell></ProtectedRoute>}/>
      <Route path="/notifications" element={<ProtectedRoute><MonetizedPageShell><NotificationsPage/></MonetizedPageShell></ProtectedRoute>}/>
      <Route path="/gymbros" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/gymbros']}><MonetizedPageShell><GymbrosPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/challenges" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/challenges']}><MonetizedPageShell><ChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/squads" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/squads']}><MonetizedPageShell><SquadsPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/sponsored-challenges" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/sponsored-challenges']}><MonetizedPageShell><SponsoredChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/seasons" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/seasons']}><MonetizedPageShell workspaceKinds={['personal','gym']}><SeasonHubPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/rewards']}><MonetizedPageShell><RewardsMarketplacePage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards/manage" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/rewards/manage']}><MonetizedPageShell workspaceKinds={['gym']}><RewardManagementPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards/analytics" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/rewards/analytics']}><MonetizedPageShell workspaceKinds={['gym']}><RewardAnalyticsPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/rewards/validate" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/rewards/validate']}><MonetizedPageShell workspaceKinds={['gym']}><RewardValidationPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/organizations" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/organizations']}><MonetizedPageShell workspaceKinds={['personal','gym']}><OrganizationsPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/organization-challenges" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/organization-challenges']}><MonetizedPageShell workspaceKinds={['personal','gym']}><OrganizationChallengesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/gym-battles" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/gym-battles']}><MonetizedPageShell workspaceKinds={['gym']}><GymBattlesPage/></MonetizedPageShell></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/brand-campaigns" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/brand-campaigns']}><BrandCampaignsPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/brand-competitions" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/brand-competitions']}><BrandCompetitionsPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/brand-audit" element={<ProtectedRoute><WorkspaceRoute allow={WORKSPACE_ROUTE_ACCESS['/brand-audit']}><BrandAuditPage/></WorkspaceRoute></ProtectedRoute>}/>
      <Route path="/dashboard" element={<Navigate to="/" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
    <SiteFooter/>
  </>;
}
