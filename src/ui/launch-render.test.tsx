import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CardDetail } from './CardDetail.js';
import { PaneLaunchFeedback } from './PaneLaunchFeedback.js';
import { CardTile } from './BoardView.js';
import { AgentLaunchActions } from './PaneLauncher.js';
import type { Card } from '../core/models.js';
import type { Backend } from './backend.js';

vi.mock('./TerminalPane.js', () => ({ TerminalPane: () => <div>terminal</div> }));

const card: Card = { id: 'c1', title: 'Task', description: 'Do it', cwd: '/tmp', column: 'in-progress', paneId: 'p1', agent: 'codex', permissionMode: 'accept-edits', createdAt: 1 };
const noop = vi.fn();

describe('launch transition rendering', () => {
  it('shows routing without idle status, terminal, or hooks guidance', () => {
    const html = renderToStaticMarkup(<CardDetail card={card} status={undefined} health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending startDisabled={false} launchPhase="routing" />);
    expect(html).toContain('Routing this ticket');
    expect(html).not.toContain('idle');
    expect(html).not.toContain('/hooks');
  });

  it('shows Restart instead of Stop after pre-spawn cancellation', () => {
    const html = renderToStaticMarkup(<CardDetail card={card} status="exited" health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} launchPhase="canceled" />);
    expect(html).toContain('Restart');
    expect(html).not.toContain('Stop agent');
  });

  it('shows a standalone error and Retry action', () => {
    const html = renderToStaticMarkup(<PaneLaunchFeedback phase="failed" error="Provider unavailable" onCancel={noop} onRetry={noop} />);
    expect(html).toContain('Provider unavailable');
    expect(html).toContain('Retry');
    expect(html).toContain('role="alert"');
  });

  it('shows routing on a compact card without an idle lifecycle badge', () => {
    const html = renderToStaticMarkup(<CardTile card={card} status={undefined} health={undefined} onOpen={noop} onStart={noop} onEdit={noop} onDelete={noop} onDragStart={noop} startDisabled={false} pending launchError={undefined} />);
    expect(html).toContain('Selecting model');
    expect(html).not.toContain('idle');
  });

  it('shows status unverified after Codex spawns without a trusted hook event', () => {
    const tile = renderToStaticMarkup(<CardTile card={card} status="idle" health={undefined} onOpen={noop} onStart={noop} onEdit={noop} onDelete={noop} onDragStart={noop} startDisabled={false} pending={false} launchError={undefined} launchPhase="spawned" />);
    const detail = renderToStaticMarkup(<CardDetail card={card} status="idle" health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} launchPhase="spawned" />);
    expect(tile).toContain('Status unverified');
    expect(detail).toContain('Status unverified');
    expect(tile).not.toContain('>idle<');
    expect(detail).not.toContain('>idle<');
  });

  it('labels an interrupted/canceled phase without claiming the process exited', () => {
    const html = renderToStaticMarkup(<CardDetail card={card} status="exited" health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} launchPhase="canceled" />);
    expect(html).toContain('Canceled');
    expect(html).not.toContain('>exited<');
  });

  it('keeps Devin history import out of Codex launcher actions', () => {
    const codex = renderToStaticMarkup(<AgentLaunchActions agent="codex" routingReady onLaunch={noop} onImport={noop} onShell={noop} />);
    const devin = renderToStaticMarkup(<AgentLaunchActions agent="devin" routingReady onLaunch={noop} onImport={noop} onShell={noop} />);
    expect(codex).not.toContain('Resume a session');
    expect(devin).toContain('Resume a session');
  });
});

it('keeps the terminal and Stop control through a native interrupted turn', () => {
  const verified = { ...card, codexSessionId: 'verified' };
  const html = renderToStaticMarkup(<CardDetail card={verified} status="interrupted" health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} launchPhase="spawned" />);
  expect(html).toContain('terminal');
  expect(html).toContain('Stop agent');
  expect(html).toContain('interrupted');
  expect(html).not.toContain('Restart');
});
it('retains final terminal output alongside recovery controls', () => {
  const html = renderToStaticMarkup(<CardDetail card={card} status="exited" health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} launchPhase="failed" />);
  expect(html).toContain('terminal');
  expect(html).toContain('Restart');
});
it('does not treat a persisted UUID as current status before runtime replay', () => {
  const html = renderToStaticMarkup(<CardDetail card={{ ...card, codexSessionId: 'saved' }} status={undefined} health={undefined} backend={{} as Backend} onClose={noop} onStart={noop} onResume={noop} onStop={noop} onEdit={noop} pending={false} startDisabled={false} />);
  expect(html).toContain('Status unverified');
  expect(html).not.toContain('>idle<');
});

it('uses compact recovery controls beside retained output', () => {
  const html = renderToStaticMarkup(<PaneLaunchFeedback compact phase="failed" error="Exited" onCancel={noop} onRetry={noop} />);
  expect(html).toContain('pane-recovery');
  expect(html).not.toContain('launcher-inner');
  expect(html).toContain('Retry');
});
