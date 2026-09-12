import { expect, it } from 'vitest';
import { cardLaunchIntent, freshSession } from './launch-request.js';
import { buildCodexArgs } from '../core/codex-launch.js';
import type { Card, SessionConfig } from '../core/models.js';
it('resumes the saved model and UUID without repeating the original instruction', () => {
  const card = { description: 'make destructive changes', codexSessionId: 'saved', route: { model: 'openai/model' } } as Card;
  const intent = cardLaunchIntent(card, true);
  expect(buildCodexArgs({ ...intent, model: intent.route!.model })).toContain('saved');
  expect(buildCodexArgs({ ...intent, model: intent.route!.model })).not.toContain(card.description);
  expect(cardLaunchIntent(card, false)).toEqual({ prompt: card.description, route: undefined, resumeSessionId: undefined });
});
it('retry drops saved execution state and retains manual model intent', () => {
  const session = { id: 'p', modelId: 'fast', route: { model: 'old' }, codexSessionId: 'old', resumeSessionId: 'old' } as SessionConfig;
  expect(freshSession(session)).toMatchObject({ id: 'p', modelId: 'fast', route: undefined, codexSessionId: undefined, resumeSessionId: undefined });
});
