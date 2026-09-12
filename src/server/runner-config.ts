import { createHash } from 'node:crypto';
import { join } from 'node:path';

export type RunnerConfiguration =
  | { mode: 'local' }
  | { mode: 'paired'; url: string; profileKey: string; machineToken: string };

/** A partial pairing must never silently enable an unauthenticated runner. */
export function runnerConfiguration(env: NodeJS.ProcessEnv): RunnerConfiguration {
  const url = (env.CONVEX_URL || env.VITE_CONVEX_URL || '').trim();
  const profileKey = env.CONVEX_PROFILE?.trim();
  const machineToken = env.CONVEX_MACHINE_TOKEN?.trim();
  if (!url && !profileKey && !machineToken) return { mode: 'local' };
  if (!url || !profileKey || !machineToken) throw new Error('Paired runner requires CONVEX_URL, CONVEX_PROFILE and CONVEX_MACHINE_TOKEN');
  return { mode: 'paired', url, profileKey, machineToken };
}

/** Never reuse the anonymous profile or interpolate an external ID into a path. */
export function runnerStoreRoot(base: string, config: RunnerConfiguration): string {
  return config.mode === 'local' ? base : join(base, 'shared-workspaces', createHash('sha256').update(config.url).update('\0').update(config.profileKey).digest('hex'));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function allowLocalSocket(config: RunnerConfiguration, origin: string | undefined, remoteAddress: string | undefined): boolean {
  if (config.mode === 'paired' || !remoteAddress || !LOOPBACK.has(remoteAddress)) return false;
  // CLI tools have no Origin. Browsers send one on websocket handshakes.
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch { return false; }
}
