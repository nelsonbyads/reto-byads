import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { WorkoutPage } from './pages/WorkoutPage';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  const { user } = useAuth();
  return <Routes><Route path="/" element={<Navigate to={user ? '/app' : '/login'} replace/>}/><Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/app" element={<ProtectedRoute><WorkoutPage/></ProtectedRoute>}/><Route path="/dashboard" element={<Navigate to="/app" replace/>}/><Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace/>}/></Routes>;
}
