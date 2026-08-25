import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ChallengesPage } from './pages/ChallengesPage';
import { GymbrosPage } from './pages/GymbrosPage';
import { LoginPage } from './pages/LoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkoutPage } from './pages/WorkoutPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <main className="auth-loading">Conectando DadoFit…</main>;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={user ? '/app' : '/login'} replace/>}/>
      <Route path="/login" element={<LoginPage/>}/>
      <Route path="/register" element={<RegisterPage/>}/>
      <Route path="/app" element={<ProtectedRoute><WorkoutPage/></ProtectedRoute>}/>
      <Route path="/profile" element={<ProtectedRoute><ProfilePage/></ProtectedRoute>}/>
      <Route path="/gymbros" element={<ProtectedRoute><GymbrosPage/></ProtectedRoute>}/>
      <Route path="/challenges" element={<ProtectedRoute><ChallengesPage/></ProtectedRoute>}/>
      <Route path="/dashboard" element={<Navigate to="/app" replace/>}/>
      <Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace/>}/>
    </Routes>
  );
}
