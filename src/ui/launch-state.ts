import type { ServerMessage } from '../server/protocol.js';

export type LaunchPhase = 'routing' | 'spawned' | 'failed' | 'canceled';
export type LaunchStates = Record<string, { phase: LaunchPhase; error?: string }>;

export function beginLaunch(states: LaunchStates, paneId: string, routed: boolean): LaunchStates {
  return { ...states, [paneId]: { phase: routed ? 'routing' : 'spawned' } };
}

export function reduceLaunchState(states: LaunchStates, message: ServerMessage): LaunchStates {
  if (!('paneId' in message)) return states;
  switch (message.t) {
    case 'pane:starting':
      return beginLaunch(states, message.paneId, message.routing);
    case 'pane:spawned':
      return { ...states, [message.paneId]: { phase: 'spawned' } };
    case 'pane:error':
      return { ...states, [message.paneId]: { phase: 'failed', error: message.error } };
    case 'pane:outcome':
      if (message.outcome === 'completed') return states;
      return { ...states, [message.paneId]: { phase: message.outcome === 'canceled' ? 'canceled' : 'failed', error: message.error } };
    default:
      return states;
  }
}
