/**
 * The empty-slot launcher. This is the screen the whole port exists to change:
 * Chorus offered "Run Claude"; this offers Devin.
 *
 * Deliberately minimal. Model, first prompt and permission mode are NOT here
 * even though the CLI accepts all three, because the pane is the real `devin`
 * TUI: you pick a model with `/model`, type your first message at the prompt,
 * and cycle permissions with `Shift+Tab`. Duplicating those in a launch form
 * gives two ways to do one thing and two places to fall out of sync — and the
 * form's copy goes stale the moment Devin ships a new model or mode.
 *
 * What remains is what the TUI genuinely cannot change after the fact: the
 * working directory the process is spawned in, plus a label for our sidebar.
 *
 * Styled as the instrument's front panel (DESIGN.md §9): a readout rule names
 * the slot, the two controls sit under `label`-styled engravings, and exactly
 * one of the three actions is brass. The panel sheds its prose — and then its
 * heading — via container queries, because a six-way split leaves a pane barely
 * 300px wide and the fields have to survive that.
 */
import { useState } from 'react';
import type { AgentConfiguration } from '../server/protocol.js';

export interface LaunchRequest {
  name?: string;
  cwd: string;
  /** Launch a plain shell instead of devin — the escape hatch pane. */
  shellOnly?: boolean;
  agent?: 'devin' | 'codex';
  modelId?: string;
}

export function AgentLaunchActions({ agent, routingReady, onLaunch, onImport, onShell }: {
  agent: 'devin' | 'codex';
  routingReady: boolean;
  onLaunch: () => void;
  onImport: () => void;
  onShell: () => void;
}) {
  return (
    <div className="launcher-actions">
      <button className="primary" onClick={onLaunch} title={`Launch a new ${agent} agent in this pane`} disabled={agent === 'codex' && !routingReady}>
        Start {agent === 'codex' ? 'Codex' : 'Devin'}
      </button>
      {agent === 'devin' && <button className="secondary" onClick={onImport} title="Reopen one of your past Devin sessions">Resume a session…</button>}
      <button className="secondary" onClick={onShell} title="Open a plain terminal shell instead of an agent">Open a terminal</button>
    </div>
  );
}

export function PaneLauncher({
  defaultCwd,
  onLaunch,
  onImport,
  config,
}: {
  defaultCwd: string;
  onLaunch: (req: LaunchRequest) => void;
  onImport: () => void;
  config: AgentConfiguration;
}) {
  const [name, setName] = useState('');
  const [cwd, setCwd] = useState(defaultCwd);
  const [agent, setAgent] = useState<'devin' | 'codex'>('codex');
  const [modelId, setModelId] = useState('');

  const launch = (shellOnly: boolean) =>
    onLaunch({ name: name.trim() || undefined, cwd: cwd.trim() || defaultCwd, shellOnly, agent, modelId: modelId || undefined });

  return (
    <div className="launcher">
      <div className="launcher-inner">
        <div className="launcher-head">
          <div className="readout-rule">
            <span className="rule-label">Empty slot</span>
            <i className="rule-line" />
            <span className="rule-value">{agent}</span>
          </div>
          <h2 className="launcher-title">Start an agent</h2>
          <p className="launcher-lede">
            Start a native agent terminal with server-configured model routing.
          </p>
        </div>

        <div className="launcher-fields">
          <label className="field">
            <span>Agent</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value as 'devin' | 'codex')}>
              <option value="codex">Codex</option><option value="devin">Devin</option>
            </select>
          </label>
          {agent === 'codex' && <label className="field">
            <span>Model</span>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={config.models.length === 0}>
              <option value="">Standard default</option>
              {config.models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.provider}</option>)}
            </select>
            <small>{config.error ?? `Search ${config.searchReady ? 'ready' : 'unavailable'}`}</small>
          </label>}
          <label className="field">
            <span>Session name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="optional — a label for the sidebar"
            />
          </label>
          <label className="field">
            <span>Working directory</span>
            {/* A path is a measured thing, not prose: it gets the mono face. */}
            <input
              className="mono"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              spellCheck={false}
            />
          </label>
        </div>

        <AgentLaunchActions agent={agent} routingReady={config.routingReady} onLaunch={() => launch(false)} onImport={onImport} onShell={() => launch(true)} />

        <p className="launcher-hint">
          {agent === 'codex' ? 'Codex uses workspace-write with approval on request. The badge records the launch model.' : <>Starts with edits auto-approved. <code>Shift+Tab</code> cycles permission mode.</>}
        </p>
      </div>
    </div>
  );
}
