import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles/index.css';
import './styles/v7-themes.css';
import './styles/v8-ads.css';
import './styles/v9-social.css';
import './styles/v10-challenges.css';
import './styles/v11-squads.css';
import './styles/v11.2-dashboard-notifications.css';
import './styles/v11.3-notifications-evidence.css';
import './styles/v12-organizations.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><App /></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
