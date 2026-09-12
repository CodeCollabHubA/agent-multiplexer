import { describe, expect, it } from 'vitest';
import { shouldReportPaneExited } from './pane-attachment.js';

describe('pane attachment recovery', () => {
  it('does not report a silent live PTY as exited', () => {
    expect(shouldReportPaneExited({ has: () => true }, false, 'live')).toBe(false);
  });

  it('reports an absent persisted pane as exited', () => {
    expect(shouldReportPaneExited({ has: () => false }, false, 'absent')).toBe(true);
  });

  it('does not report a pane still routing as exited', () => {
    expect(shouldReportPaneExited({ has: () => false }, true, 'pending')).toBe(false);
  });
});
