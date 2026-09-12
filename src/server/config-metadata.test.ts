import { expect, it } from 'vitest';
import { configurationMetadata } from './config-metadata.js';
import { openRouterApiKey } from './env.js';
import { DEMO_ROUTING_CONFIG } from '../core/routing.js';
it('accepts the underscored key alias without exposing it', () => {
  const config = configurationMetadata(DEMO_ROUTING_CONFIG, { OPEN_ROUTER_API_KEY: 'alias-secret' });
  expect(config.routingReady).toBe(true);
  expect(JSON.stringify(config)).not.toContain('alias-secret');
});
it('gives the canonical spelling precedence, including an explicitly blank value', () => {
  expect(openRouterApiKey({ OPENROUTER_API_KEY: 'canonical', OPEN_ROUTER_API_KEY: 'alias' })).toBe('canonical');
  expect(openRouterApiKey({ OPENROUTER_API_KEY: '', OPEN_ROUTER_API_KEY: 'alias' })).toBe('');
  expect(openRouterApiKey({})).toBe('');
});
