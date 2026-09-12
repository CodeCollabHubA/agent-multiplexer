import { describe, expect, it } from 'vitest';
import { beginLaunch, reduceLaunchState, type LaunchStates } from './launch-state.js';

describe('pane launch UI state', () => {
  it('transitions Start -> routing -> canceled -> Restart without inventing lifecycle status', () => {
    let state: LaunchStates = {};
    state = beginLaunch(state, 'p1', true);
    expect(state.p1).toEqual({ phase: 'routing' });
    state = reduceLaunchState(state, { t: 'pane:outcome', paneId: 'p1', outcome: 'canceled' });
    expect(state.p1).toEqual({ phase: 'canceled' });
    state = beginLaunch(state, 'p2', true);
    expect(state.p2).toEqual({ phase: 'routing' });
  });

  it('makes a standalone routing failure visible and retryable', () => {
    let state = beginLaunch({}, 'standalone', true);
    state = reduceLaunchState(state, { t: 'pane:error', paneId: 'standalone', error: 'Provider unavailable', retryable: true });
    expect(state.standalone).toEqual({ phase: 'failed', error: 'Provider unavailable' });
    state = beginLaunch(state, 'standalone', true);
    expect(state.standalone).toEqual({ phase: 'routing' });
  });

  it('does not expose hooks-unverified until the server confirms a PTY spawned', () => {
    let state = beginLaunch({}, 'p1', true);
    expect(state.p1?.phase).toBe('routing');
    state = reduceLaunchState(state, { t: 'pane:route', paneId: 'p1', route: { modelId: 'fast', model: 'openai/x', provider: 'openai', complexity: 'simple', reason: 'small' } });
    expect(state.p1?.phase).toBe('routing');
    state = reduceLaunchState(state, { t: 'pane:spawned', paneId: 'p1' });
    expect(state.p1?.phase).toBe('spawned');
  });
});
