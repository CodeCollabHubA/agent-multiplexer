import { openRouterApiKey } from './env.js';
import type { RoutingConfig } from '../core/routing.js';
import type { AgentConfiguration } from './protocol.js';

/** Project only public metadata; credential values never enter this object. */
export function configurationMetadata(
  config: RoutingConfig | null,
  env: NodeJS.ProcessEnv,
  error?: string,
): AgentConfiguration {
  return {
    models: config?.models ?? [],
    standardModelId: config?.tiers.standard,
    routingReady: Boolean(config && openRouterApiKey(env)),
    searchReady: Boolean(env.EXA_API_KEY?.trim()),
    error: error?.replace(/[\r\n\t]+/g, ' ').slice(0, 240),
  };
}
