import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { useConvex, useConvexAuth, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { authenticatedTransport, Backend } from './backend.js';

const App = lazy(() => import('./App.js').then(module => ({ default: module.App })));
const query = (name: string) => makeFunctionReference<'query'>(name);
const mutation = (name: string) => makeFunctionReference<'mutation'>(name);
type Space = { profileKey: string; name: string };
type Member = { id: string; name: string; email: string; isSelf: boolean };
type Invite = { id: string; expiresAt: number; createdAt: number };

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function pendingInvite() {
  const fromUrl = new URLSearchParams(window.location.search).get('invite');
  if (fromUrl) {
    try { sessionStorage.setItem('workspace-invite', fromUrl); } catch { /* Redirect appState also preserves it. */ }
    return fromUrl;
  }
  try { return sessionStorage.getItem('workspace-invite'); } catch { return null; }
}
function clearInvite() {
  try { sessionStorage.removeItem('workspace-invite'); } catch { /* The URL is cleared independently. */ }
  const url = new URL(window.location.href); url.searchParams.delete('invite');
  window.history.replaceState({}, '', url);
}
export function runnerIsOnline(status: { lastSeen: number } | null | undefined, now: number) {
  return Boolean(status && now - status.lastSeen < 35_000);
}
export function ConvexAuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <main className="auth-screen"><p role="status">Connecting your secure workspace…</p></main>;
  if (!isAuthenticated) return <main className="auth-screen"><p role="alert">Workspace authentication could not be established. Log out and sign in again.</p></main>;
  return <>{children}</>;
}
export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    if (this.state.error) return <main className="auth-screen"><section className="auth-card"><h1>Workspace unavailable</h1><p role="alert">{this.state.error}</p><button onClick={() => window.location.reload()}>Reload workspaces</button></section></main>;
    return this.props.children;
  }
}

export function Workspaces() {
  const client = useConvex();
  const spaces = useQuery(query('spaces:list'), {}) as Space[] | undefined;
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState(() => pendingInvite());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = spaces?.find(space => space.profileKey === selected) ?? spaces?.[0];
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  if (!spaces) return <p role="status">Loading shared workspaces…</p>;
  const controls = <div className="space-controls">
    <label className="space-picker"><span>Workspace</span><select aria-label="Shared workspace" value={active?.profileKey ?? ''} onChange={event => { setSelected(event.target.value); setCreating(false); }}>
      {!active && <option value="">Choose a workspace</option>}
      {spaces.map(space => <option key={space.profileKey} value={space.profileKey}>{space.name}</option>)}
    </select></label>
    <button className="ghost" aria-expanded={creating} aria-controls="create-shared-workspace" onClick={() => setCreating(!creating)}>+ New</button>
  </div>;
  return <div className="shared-workspace-shell">
    {creating && <section className="space-create-panel" id="create-shared-workspace" onKeyDown={event => { if (event.key === 'Escape') setCreating(false); }}>
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        const space = await client.mutation(mutation('spaces:create'), { name: name.trim() }) as Space;
        setSelected(space.profileKey); setName(''); setCreating(false);
      }); }}>
        <label htmlFor="shared-workspace-name">New shared workspace</label>
        <input id="shared-workspace-name" aria-label="New shared workspace name" placeholder="Workspace name" value={name} onChange={event => setName(event.target.value)} maxLength={100} required autoFocus />
        <button disabled={busy || !name.trim()}>Create shared workspace</button>
        <button type="button" className="ghost" onClick={() => setCreating(false)}>Cancel</button>
      </form>
    </section>}
    {error && <p className="space-notice error" role="alert">{error}</p>}
    {invite && <section className="space-notice"><p>You have an invitation to join a shared workspace.</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const space = await client.mutation(mutation('spaces:acceptInvite'), { token: invite }) as Space;
        setSelected(space.profileKey); clearInvite(); setInvite(null);
      })}>Accept invitation</button>
      <button className="ghost" disabled={busy} onClick={() => { clearInvite(); setInvite(null); }}>Dismiss invitation</button>
    </section>}
    {active ? <WorkspaceErrorBoundary key={active.profileKey}><SelectedSpace space={active} controls={controls} /></WorkspaceErrorBoundary> : <><header className="space-bar">{controls}</header><main className="auth-screen"><section className="auth-card"><h1>Create your first shared workspace</h1><p>Invite teammates, pair a runner, then add project boards and terminals.</p><button onClick={() => setCreating(true)}>Create shared workspace</button></section></main></>}
  </div>;
}

function SelectedSpace({ space, controls }: { space: Space; controls: ReactNode }) {
  const client = useConvex();
  const args = { profileKey: space.profileKey };
  const members = useQuery(query('spaces:members'), args) as Member[] | undefined;
  const invites = useQuery(query('spaces:invites'), args) as Invite[] | undefined;
  const machine = useQuery(query('spaces:machine'), args) as { paired: boolean } | undefined;
  const status = useQuery(query('mux:getMachineStatus'), args) as { lastSeen: number } | null | undefined;
  const [now, setNow] = useState(Date.now);
  const [manage, setManage] = useState(false);
  const [name, setName] = useState(space.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string>();
  const [credential, setCredential] = useState<string>();
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5_000); return () => window.clearInterval(timer); }, []);
  const online = Boolean(machine?.paired && runnerIsOnline(status, now));
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(undefined);
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const call = (name: string, values: Record<string, unknown> = {}) => client.mutation(mutation(`spaces:${name}`), { ...args, ...values });
  return <>
    <header className="space-bar">{controls}<div className="space-actions"><span className={`runner-indicator${online ? ' online' : ''}`} role="status">{online ? 'Runner connected' : machine?.paired ? 'Runner disconnected' : 'No runner paired'}</span><button onClick={() => { setManage(!manage); setCredential(undefined); setLink(undefined); }}> {manage ? 'Close settings' : 'Members & settings'}</button></div></header>
    {error && <p className="space-notice error" role="alert">{error}</p>}
    {manage && <section className="space-settings">
      <h2>Shared workspace settings</h2>
      <form onSubmit={event => { event.preventDefault(); void run(async () => { await call('rename', { name: name.trim() }); }); }}><input aria-label="Rename shared workspace" value={name} maxLength={100} required onChange={event => setName(event.target.value)} /><button disabled={busy || !name.trim()}>Rename</button></form>
      <h3>Members</h3>
      <p>Everyone has equal access to this workspace.</p>
      {!members ? <p>Loading members…</p> : <ul>{members.map(member => <li key={member.id}>{member.name || member.email || 'Workspace member'} {member.email && member.email !== member.name ? `(${member.email})` : ''}{member.isSelf ? ' · you' : ''}</li>)}</ul>}
      <button disabled={busy || !members || members.length < 2} onClick={() => void run(async () => { await call('leave'); })}>Leave shared workspace</button>
      {members?.length === 1 && <p>The last member cannot leave this workspace.</p>}
      <h3>Invitations</h3><p>Links work once and expire after seven days. Anyone with the link can join after signing in.</p>
      <button disabled={busy} onClick={() => void run(async () => {
        const token = randomToken(); await call('createInvite', { token });
        const url = new URL(window.location.origin); url.searchParams.set('invite', token); setLink(url.toString());
      })}>Create invitation link</button>
      {link && <label className="space-secret">Copy this invitation link<input readOnly value={link} onFocus={event => event.target.select()} /></label>}
      <ul>{invites?.map(invitation => <li key={invitation.id}>Expires {new Date(invitation.expiresAt).toLocaleString()} <button disabled={busy} onClick={() => void run(async () => { await call('revokeInvite', { id: invitation.id }); setLink(undefined); })}>Revoke invitation</button></li>)}</ul>
      <h3>Runner</h3><p>Pair the machine where your project files and agents run. Pairing replaces the previous runner credential.</p>
      <button disabled={busy} onClick={() => void run(async () => { const token = randomToken(); await call('pairMachine', { token }); setCredential(token); })}>{machine?.paired ? 'Replace runner credential' : 'Pair runner'}</button>
      {machine?.paired && <button disabled={busy} onClick={() => void run(async () => { await call('revokeMachine'); setCredential(undefined); })}>Revoke runner</button>}
      {credential && <div className="space-secret"><p>Copy this credential now. It is shown only here and cannot be retrieved later. Set these environment variables on your runner, then start it.</p><pre>{`CONVEX_URL=${import.meta.env.VITE_CONVEX_URL}\nCONVEX_PROFILE=${space.profileKey}\nCONVEX_MACHINE_TOKEN=${credential}`}</pre><button onClick={() => setCredential(undefined)}>Hide credential</button></div>}
    </section>}
    {online ? <WorkspaceSession profileKey={space.profileKey} /> : <main className="auth-screen"><section className="auth-card"><h1>{machine?.paired ? 'Connect your runner' : 'Pair a runner to begin'}</h1><p>Project edits and terminal actions are unavailable while the runner is disconnected. Existing projects remain saved in this shared workspace.</p><button onClick={() => setManage(true)}>Open runner settings</button></section></main>}
  </>;
}
function WorkspaceSession({ profileKey }: { profileKey: string }) {
  const client = useConvex();
  const [backend, setBackend] = useState<Backend>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const transport = new Backend({ client: authenticatedTransport(client), profileKey, onError: cause => setError(cause.message) });
    setBackend(transport);
    return () => transport.dispose();
  }, [client, profileKey]);
  if (error) return <section className="space-notice"><h2>Workspace connection interrupted</h2><p role="alert">{error}</p><p>Your last action may not have been saved. Reload to restore the saved workspace before continuing.</p><button onClick={() => window.location.reload()}>Reload workspace</button></section>;
  if (!backend) return <p role="status">Loading projects…</p>;
  return <Suspense fallback={<p role="status">Opening projects…</p>}><App backend={backend} /></Suspense>;
}
