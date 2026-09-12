import type { Card, SessionConfig } from '../core/models.js';

/** Retry starts a new invocation, preserving only the user's model selection. */
export function freshSession(session: SessionConfig): SessionConfig {
  return { ...session, route: undefined, codexSessionId: undefined, devinSessionId: undefined, resumeSessionId: undefined };
}

/** Reopening a conversation must not repeat the original ticket instruction. */
export function cardLaunchIntent(card: Card, resume: boolean) {
  return {
    route: resume ? card.route : undefined,
    resumeSessionId: resume ? card.codexSessionId : undefined,
    prompt: resume ? undefined : card.description,
  };
}
