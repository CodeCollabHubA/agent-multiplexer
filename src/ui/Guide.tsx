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
  { title: 'Workspaces', body: <>Create a workspace pointing at your project directory. Choose a <b>board</b> for tickets or a <b>terminal grid</b> for interactive Codex sessions.</> },
  { title: 'Tickets into tasks', body: <>Add a title and a clear description, then press <b>Start</b>. Codex receives the description as its first instruction. Open the card to watch and interact with its native terminal.</> },
  { title: 'Model routing', body: <><b>Auto</b> asks OpenRouter to classify a ticket as simple, standard, or complex and selects the configured model. You can also choose a model manually. Empty interactive panes use the standard default. The badge shows the launch choice and reason; it does not track later native model changes.</> },
  { title: 'Search with Exa', body: <>Ask Codex to research current documentation with <b>Exa</b> and cite its sources. Search readiness appears in the launcher. Tool calls and results appear in the Codex terminal.</> },
  { title: 'Parallel terminals', body: <>Choose <b>1–6</b> terminals and drag dividers to resize. Each pane holds an independent Codex session. Use tabs or maximize a pane when you need more room.</> },
  { title: 'Status & attention', body: <>Trusted Codex hooks report running, waiting, interrupted, and completed turns. Review the project and <code>/hooks</code> trust prompts when asked. <b>Status unverified</b> means the app has not verified hooks for this invocation. Codex uses workspace-write access with approval on request.</> },
  { title: 'Resume & retry', body: <>On a stopped ticket, <b>Resume same model</b> reopens its saved conversation without submitting the original task again. <b>Restart</b> starts the ticket afresh; <b>Retry</b> starts a fresh standalone session. Interrupting a turn keeps its terminal available for your next instruction.</> },
  { title: 'State & reconnect', body: <>Workspaces, tickets, layouts, and session identities are saved locally. Refresh to reconnect to processes still running on this machine. Model requests go to OpenRouter and search requests go to Exa; credentials stay on the server. Restarting the server stops its running agents.</> },
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
          Run Codex agents in parallel. Agent Workspace arranges their native terminals,
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
