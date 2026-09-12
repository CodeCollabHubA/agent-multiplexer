import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaneLauncher } from './PaneLauncher.js';
import { CardDialog } from './CardDialog.js';
import { NameDialog } from './NameDialog.js';
import { Guide } from './Guide.js';

const config = { models: [], routingReady: false, searchReady: false };
const noop = () => {};
afterEach(() => vi.unstubAllEnvs());
describe('Codex demo presentation', () => {
  it('offers only Codex for a new terminal by default', () => {
    vi.stubEnv('VITE_ENABLE_DEVIN', '');
    const html = renderToStaticMarkup(<PaneLauncher defaultCwd="/tmp" config={config} onLaunch={noop} onImport={noop} />);
    expect(html).toContain('Start Codex');
    expect(html).not.toContain('>Devin<');
  });
  it('offers only Codex for a new ticket by default', () => {
    vi.stubEnv('VITE_ENABLE_DEVIN', '');
    const html = renderToStaticMarkup(<CardDialog spec={{ mode: 'create', defaultCwd: '/tmp', hasDefaultContextKey: false }} config={config} onSubmit={noop} onCancel={noop} />);
    expect(html).not.toContain('>Devin<');
  });
  it('keeps legacy provider selection available when opted in', () => {
    vi.stubEnv('VITE_ENABLE_DEVIN', 'true');
    expect(renderToStaticMarkup(<PaneLauncher defaultCwd="/tmp" config={config} onLaunch={noop} onImport={noop} />)).toContain('>Devin<');
  });
  it('does not request an unrelated search credential for new workspaces', () => {
    vi.stubEnv('VITE_ENABLE_DEVIN', '');
    expect(renderToStaticMarkup(<NameDialog spec={{ mode: 'create-workspace', defaultCwd: '/tmp', hasDefaultContextKey: false }} onSubmit={noop} onCancel={noop} />)).not.toContain('context.dev');
  });
  it('teaches the implemented Codex workflow without legacy feature promises', () => {
    const html = renderToStaticMarkup(<Guide onClose={noop} />);
    expect(html).toContain('Exa');
    expect(html).toContain('OpenRouter');
    expect(html).not.toMatch(/Devin|Trace a session|Context health|devin -r/);
  });
});

vi.mock('./backend.js', () => ({ Backend: class {} }));
vi.mock('./TerminalPane.js', () => ({ TerminalPane: () => null }));
it('keeps legacy history and context promises out of the empty workspace screen', async () => {
  vi.stubEnv('VITE_ENABLE_DEVIN', '');
  const { App } = await import('./App.js');
  const html = renderToStaticMarkup(<App backend={{} as import('./backend.js').Backend} />);
  expect(html).not.toContain('Resume a past session');
  expect(html).not.toContain('context budget');
});

it('offers an unchecked approval choice for new agents and preserves opted-in ticket edits', () => {
  const fresh = renderToStaticMarkup(<PaneLauncher defaultCwd="/tmp" config={config} onLaunch={noop} onImport={noop} />);
  expect(fresh).toContain('Skip approval prompts');
  expect(fresh).not.toContain('checked=""');
  const html = renderToStaticMarkup(<CardDialog spec={{ mode: 'edit', hasDefaultContextKey: false, card: { id: 'c', title: 'Task', description: '', cwd: '/tmp', column: 'backlog', agent: 'codex', skipApprovals: true, permissionMode: 'accept-edits', createdAt: 1 } }} config={config} onSubmit={noop} onCancel={noop} />);
  expect(html).toContain('checked=""');
  expect(html).toContain('inside the workspace sandbox');
});
