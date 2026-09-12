import { describe, expect, it } from 'vitest';
import type { ServerMessage } from './protocol.js';
import { configurationMetadata } from './config-metadata.js';
import { DEMO_ROUTING_CONFIG } from '../core/routing.js';

describe('configuration transport', () => {
  it('contains sanitized metadata and readiness only', () => {
    const config = configurationMetadata(DEMO_ROUTING_CONFIG, { OPENROUTER_API_KEY: 'secret-openrouter', EXA_API_KEY: 'secret-exa' });
    const reply: ServerMessage = { t: 'config:result', config };
    const wire = JSON.stringify(reply);
    expect(wire).not.toContain('secret-openrouter');
    expect(wire).not.toContain('secret-exa');
    expect(JSON.parse(wire).config).toMatchObject({ routingReady: true, searchReady: true });
  });
});
