import { StrictMode } from 'react';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithAuth0 } from 'convex/react-auth0';
import { ConvexAuthGate, Workspaces, WorkspaceErrorBoundary } from './Workspaces.js';
import { createRoot } from 'react-dom/client';
import { Auth0Provider } from '@auth0/auth0-react';
import { AuthGate } from './AuthGate.js';
import './styles.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN || 'dev-4hw2emzs.eu.auth0.com'}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID || 'CGlOWL0HkW4FAgkAEWyBpFVCn6aCdNd5'}
      authorizationParams={{ redirect_uri: window.location.origin }}
      useRefreshTokens={true}
      cacheLocation="localstorage"
      onRedirectCallback={(appState) => {
        const invite = typeof appState?.invite === 'string' ? appState.invite : null;
        const url = new URL(window.location.origin);
        if (invite) url.searchParams.set('invite', invite);
        window.history.replaceState({}, '', url);
      }}
    >
      <AuthGate>
        {client ? <ConvexProviderWithAuth0 client={client}>
          <ConvexAuthGate><WorkspaceErrorBoundary><Workspaces /></WorkspaceErrorBoundary></ConvexAuthGate>
        </ConvexProviderWithAuth0> : <main className="auth-screen"><p role="alert">Workspace service is not configured. Set VITE_CONVEX_URL.</p></main>}
      </AuthGate>
    </Auth0Provider>
  </StrictMode>,
);
