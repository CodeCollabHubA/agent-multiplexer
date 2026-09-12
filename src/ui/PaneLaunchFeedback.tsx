import type { LaunchPhase } from './launch-state.js';

export function PaneLaunchFeedback({ phase, error, onCancel, onRetry, compact = false }: {
  compact?: boolean;
  phase: LaunchPhase;
  error?: string;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (phase === 'routing') {
    return <div className="launcher"><div className="launcher-inner"><p role="status">Selecting a configured model…</p><button className="secondary" onClick={onCancel}>Cancel</button></div></div>;
  }
  if (compact) return <div className="pane-recovery"><p className={error ? 'error' : ''} role={error ? 'alert' : 'status'}>{error ?? 'Launch canceled or stopped.'}</p><button className="primary" onClick={onRetry}>Retry</button></div>;
  return <div className="launcher"><div className="launcher-inner"><p className={error ? 'error' : ''} role={error ? 'alert' : 'status'}>{error ?? 'Launch canceled or stopped.'}</p><button className="primary" onClick={onRetry}>Retry</button></div></div>;
}
