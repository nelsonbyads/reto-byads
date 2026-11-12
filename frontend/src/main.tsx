import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import './styles/index.css';
import './styles/v7-themes.css';
import './styles/v8-ads.css';
import './styles/v9-social.css';
import './styles/v10-challenges.css';
import './styles/v11-squads.css';
import './styles/v11.2-dashboard-notifications.css';
import './styles/v11.3-notifications-evidence.css';
import './styles/v12-organizations.css';
import './styles/v12.1-gym-battles.css';
import './styles/v12.2-workspaces-rbac.css';
import './styles/v13-brands-sponsored.css';
import './styles/v13.1-exercise-catalog.css';
import './styles/v13.2-sponsored-goals.css';
import './styles/v13.3-ui-governance.css';
import './styles/v13.4-final-polish.css';
import './styles/v13.5-monetization.css';
// Theme palettes must come last: main.tsx's sheets load after App's, so the
// last import here is the last stylesheet in the cascade.
import './styles/v16-themes.css';
import { applyTheme, readStoredTheme } from './lib/theme';

// Apply the stored theme before the first render (public pages have no header).
applyTheme(readStoredTheme(), false);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><WorkspaceProvider><App /></WorkspaceProvider></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
