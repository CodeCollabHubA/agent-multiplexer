/**
 * The guide popup.
 *
 * Written against what this app actually does, not what its Claude-Code
 * ancestor did — every claim here was verified against the running CLI. Where a
 * behaviour has a constraint behind it (why a locked session can't be traced,
 * why the context figure is an estimate, why resuming makes its own workspace)
 * the guide says so, because those are exactly the places a user would
 * otherwise assume a bug.
 *
 * Rendered as Instrument cards on a two-column grid. Each card is headed by a
 * readout rule carrying the section name and its index in `data` type — the
 * system's signature element (DESIGN.md §9), and one per card, never stacked.
 * The eight rotating catalog tints it used to cycle are gone with the rest of
 * the Dell language.
 */
import { useEffect, type ReactNode } from 'react';

interface Section {
  title: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    title: 'Workspaces',
    body: (
      <>
        A workspace is a named group of agent sessions with its own layout and a default working
        directory. Add one with <b>+ New workspace</b>, rename with <b>✎</b> (or double-click), and
        remove with <b>✕</b>. Point it at a project directory where agents may work.
      </>
    ),
  },
  {
    title: 'Terminals & layout',
    body: (
      <>
        Pick <b>1–6</b> from the <b>Terminals</b> dropdown. Drag the dividers to resize; the
        terminals reflow. <b>Reset</b> re-evens the splits without touching the running processes.
        Closing a pane with <b>✕</b> shrinks the grid — the slot goes away rather than leaving an
        empty launcher behind.
      </>
    ),
  },
  {
    title: 'Run an agent',
    body: (
      <>
        In an empty pane, choose Codex, Devin, or a plain terminal. Each pane is the native agent
        TUI. Codex uses workspace-write access with approval on request; review <code>/hooks</code>
        when asked so lifecycle status can be verified.
      </>
    ),
  },
  {
    title: 'Status & attention',
    body: (
      <>
        Every pane and sidebar row carries a live status — <b>idle</b>, <b>running</b>,{' '}
        <b>waiting</b>, <b>exited</b> — driven by the agent's own lifecycle hooks, not by guessing at
        terminal output. When an agent needs you its pane header lights amber, its workspace gets a
        marker, and the count appears at the top right. That's the point of running six at once: you
        work by exception instead of watching panes.
      </>
    ),
  },
  {
    title: 'Resume a past session',
    body: (
      <>
        <b>Sessions</b> lists every Devin conversation on this machine. <b>Resume</b> relaunches one
        with <code>devin -r</code> in <b>its own new workspace</b>, at the directory it originally
        ran in — that flag only works from there. Sessions marked <b>locked</b> are open in a
        running process; Devin allows one holder at a time.
      </>
    ),
  },
  {
    title: 'Trace a session',
    body: (
      <>
        <b>Trace</b> replays a conversation turn by turn: prompts, replies, thinking, and every tool
        call paired with its result, duration and file diff. It reads Devin's own record over ACP,
        so nothing is reconstructed or copied. Live panes can't be traced while they run — the same
        one-holder lock — so trace a session once its pane is closed.
      </>
    ),
  },
  {
    title: 'Context health',
    body: (
      <>
        The <b>%</b> readout estimates how full a pane's context window is: green, amber past 50%,
        red past 70%, where quality starts degrading well before the hard limit. It's an{' '}
        <i>estimate</i> — Devin reports cumulative token totals, so the figure is derived from
        per-turn deltas. Hover it for the exact counts and the model's real window.
      </>
    ),
  },
  {
    title: 'Where your state lives',
    body: (
      <>
        Workspaces, layouts and sessions are saved to <code>~/.devin-agent-tmux/</code> as readable
        JSON. Agents run on this machine; model requests use the configured provider, and the optional
        Convex mirror synchronizes app state when enabled.
      </>
    ),
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal guide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Guide">
        <header>
          <h2>The Guide</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close guide" title="Close">
            ✕
          </button>
        </header>

        <p className="guide-lede">
          Run Codex and Devin CLI agents in parallel. Agent Workspace arranges their native terminals,
          watches trusted lifecycle events, and remembers launch choices.
        </p>

        <div className="guide-grid">
          {SECTIONS.map((section, i) => (
            <section className="guide-card" key={section.title}>
              <div className="readout-rule">
                <span className="rule-label">{section.title}</span>
                <i className="rule-line" />
                <span className="rule-value">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <p className="guide-card-body">{section.body}</p>
            </section>
          ))}
        </div>

        <footer className="card-actions">
          <button className="primary" onClick={onClose}>
            Start building
          </button>
        </footer>
      </div>
    </div>
  );
}
