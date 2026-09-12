import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const { auth } = vi.hoisted(() => ({ auth: { isLoading: false, isAuthenticated: false, error: undefined as Error | undefined, user: undefined as { name?: string; email?: string } | undefined, loginWithRedirect: vi.fn(), logout: vi.fn() } }));
vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth }));
import { AuthGate } from './AuthGate.js';
describe('Auth0 sign-in boundary', () => {
  it('shows login/signup without mounting the agent workspace', () => {
    auth.isLoading = false; auth.isAuthenticated = false; auth.error = undefined;
    const html = renderToStaticMarkup(<AuthGate><div>PRIVATE WORKSPACE</div></AuthGate>);
    expect(html).toContain('Log in'); expect(html).toContain('Sign up');
    expect(html).not.toContain('PRIVATE WORKSPACE');
  });
  it('waits for the SDK before displaying workspace content', () => {
    auth.isLoading = true;
    expect(renderToStaticMarkup(<AuthGate>PRIVATE WORKSPACE</AuthGate>)).toContain('Checking your session');
    auth.isLoading = false;
  });
  it('renders account identity and workspace after sign-in', () => {
    auth.isAuthenticated = true; auth.user = { email: 'peer@example.com' };
    const html = renderToStaticMarkup(<AuthGate>PRIVATE WORKSPACE</AuthGate>);
    expect(html).toContain('peer@example.com'); expect(html).toContain('Log out'); expect(html).toContain('PRIVATE WORKSPACE');
    auth.isAuthenticated = false;
  });
  it('shows a recoverable authentication error', () => {
    auth.error = new Error('Callback configuration mismatch');
    const html = renderToStaticMarkup(<AuthGate>PRIVATE WORKSPACE</AuthGate>);
    expect(html).toContain('Callback configuration mismatch'); expect(html).toContain('Log in');
    auth.error = undefined;
  });
});
