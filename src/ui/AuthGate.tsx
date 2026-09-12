import { pendingInvite } from './Workspaces.js';
import { useAuth0 } from '@auth0/auth0-react';
import { useState, type ReactNode } from 'react';

/** Client sign-in boundary. Backend workspace authorization is a separate layer. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, error, user, loginWithRedirect, logout } = useAuth0();
  const [actionError, setActionError] = useState<string>();
  const login = (signup = false) => {
    setActionError(undefined);
    void loginWithRedirect({ appState: { invite: pendingInvite() }, ...(signup ? { authorizationParams: { screen_hint: 'signup' } } : {}) })
      .catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not start sign-in. Please try again.'));
  };
  const signOut = () => {
    setActionError(undefined);
    void logout({ logoutParams: { returnTo: window.location.origin } })
      .catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : 'Could not log out. Please try again.'));
  };

  if (isLoading) return <main className="auth-screen"><p role="status">Checking your session…</p></main>;
  if (!isAuthenticated) return <main className="auth-screen">
    <section className="auth-card">
      <span className="rule-label">Agent Workspace</span>
      <h1>Your agents, together.</h1>
      <p>Sign in to open your Codex workspace.</p>
      {(error || actionError) && <p className="error" role="alert">{actionError ?? error?.message}</p>}
      <div className="auth-actions">
        <button className="primary" onClick={() => login()}>Log in</button>
        <button className="secondary" onClick={() => login(true)}>Sign up</button>
      </div>
    </section>
  </main>;

  return <div className="authenticated-shell">
    <header className="account-bar">
      <span>{user?.email ?? user?.name ?? 'Signed in'}</span>
      {actionError && <span className="error" role="alert">{actionError}</span>}
      <button className="ghost" onClick={signOut}>Log out</button>
    </header>
    <div className="authenticated-workspace">{children}</div>
  </div>;
}
