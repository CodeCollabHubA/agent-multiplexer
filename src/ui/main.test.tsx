import { afterEach, expect, it, vi } from 'vitest';
const { rendered, provider } = vi.hoisted(() => ({ rendered: vi.fn(), provider: vi.fn() }));
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: rendered }) }));
vi.mock('convex/react', () => ({ ConvexReactClient: class {}, useConvexAuth: vi.fn(), useConvex: vi.fn(), useQuery: vi.fn() }));
vi.mock('@auth0/auth0-react', () => ({ Auth0Provider: provider, useAuth0: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('configures the official Auth0 provider to refresh tokens without silent iframe consent', async () => {
  vi.stubGlobal('document', { getElementById: () => ({}) });
  vi.stubGlobal('window', { location: { origin: 'https://workspace.example' } });
  await import('./main.js');
  const strictMode = rendered.mock.calls.at(-1)![0];
  const auth = strictMode.props.children;
  expect(auth.type).toBe(provider);
  expect(auth.props.useRefreshTokens).toBe(true);
  expect(auth.props.cacheLocation).toBe('localstorage');
  expect(auth.props.authorizationParams.redirect_uri).toBe('https://workspace.example');
});
