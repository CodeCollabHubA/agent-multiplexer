import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_ROUTING_CONFIG } from '../core/routing.js';
import { loadRoutingConfig, routeTask } from './routing.js';

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(response: { status?: number; body?: unknown; delay?: number }) {
  let requests = 0;
  let requestBody = '';
  const server = createServer(async (req, res) => {
    requests++;
    for await (const chunk of req) requestBody += chunk;
    if (response.delay) await new Promise((resolve) => setTimeout(resolve, response.delay));
    res.writeHead(response.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response.body ?? {}));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  return {
    fetch: (input: URL | RequestInfo, init?: RequestInit) => {
      const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return fetch(source.replace('https://openrouter.ai', `http://127.0.0.1:${address.port}`), init);
    },
    requests: () => requests,
    requestBody: () => requestBody,
  };
}

async function stalledBodyFixture() {
  let headersFlushed!: () => void;
  const receivedHeaders = new Promise<void>((resolve) => { headersFlushed = resolve; });
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the request before responding */ }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.flushHeaders();
    headersFlushed();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
  return {
    fetch: (input: URL | RequestInfo, init?: RequestInit) => {
      const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return fetch(source.replace('https://openrouter.ai', `http://127.0.0.1:${address.port}`), init);
    },
    receivedHeaders,
  };
}

function classifierBody(value: unknown) {
  return { id: 'generation-1', choices: [{ message: { role: 'assistant', content: JSON.stringify(value) } }] };
}

describe('routeTask', () => {
  it('classifies through OpenRouter and maps only the returned tier through configuration', async () => {
    const http = await fixture({ body: classifierBody({ complexity: 'complex', reason: 'Touches several components' }) });
    const decision = await routeTask(
      { title: 'Add routing', description: 'Wire the server and UI' },
      DEMO_ROUTING_CONFIG,
      { apiKey: 'fixture-secret', fetch: http.fetch },
    );

    expect(decision).toEqual({
      modelId: 'capable', model: 'openai/gpt-6-astra', provider: 'openai',
      complexity: 'complex', reason: 'Touches several components',
    });
    const sent = JSON.parse(http.requestBody());
    expect(sent.model).toBe('openai/gpt-5.6-luna');
    expect(sent.tools).toEqual([]);
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content).not.toContain('Add routing');
    expect(JSON.parse(sent.messages[1].content)).toEqual({ title: 'Add routing', description: 'Wire the server and UI' });
  });

  it('requires a credential even when a manual override bypasses classification', async () => {
    const http = await fixture({ body: classifierBody({ complexity: 'simple', reason: 'unused' }) });
    await expect(routeTask({ title: 'Fix copy', description: 'Typo', modelId: 'balanced' }, DEMO_ROUTING_CONFIG,
      { apiKey: '  ', fetch: http.fetch })).rejects.toThrow('OpenRouter API key is required');
    expect(http.requests()).toBe(0);
  });

  it('uses a valid manual override without issuing a classifier request', async () => {
    const http = await fixture({ body: classifierBody({ complexity: 'simple', reason: 'unused' }) });
    await expect(routeTask({ title: '', description: '', modelId: 'balanced' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'fixture', fetch: http.fetch })).resolves.toMatchObject({ modelId: 'balanced', complexity: 'manual' });
    expect(http.requests()).toBe(0);
  });

  it.each([
    ['malformed output', classifierBody('not-an-object')],
    ['unknown complexity', classifierBody({ complexity: 'unbounded', reason: 'x' })],
    ['empty reason', classifierBody({ complexity: 'simple', reason: '  ' })],
    ['too-long reason', classifierBody({ complexity: 'simple', reason: 'x'.repeat(241) })],
    ['extra output field', classifierBody({ complexity: 'simple', reason: 'x', model: 'attacker/model' })],
  ])('rejects %s instead of selecting a fallback', async (_name, body) => {
    const http = await fixture({ body });
    await expect(routeTask({ title: 'Fix copy', description: 'Correct spelling' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'fixture', fetch: http.fetch })).rejects.toThrow('Invalid classifier response');
  });

  it.each([401, 429, 500])('returns a bounded sanitized error for HTTP %s', async (status) => {
    const secret = 'provider-body-secret';
    const http = await fixture({ status, body: { error: secret } });
    const error = await routeTask({ title: 'Task', description: 'Description' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'api-key-secret', fetch: http.fetch }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`Classifier request failed with status ${status}`);
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message.length).toBeLessThanOrEqual(240);
  });

  it('sanitizes fetch failures without reflecting their message', async () => {
    const error = await routeTask({ title: 'Task', description: 'Description' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'api-key-secret', fetch: async () => { throw new Error('leaked api-key-secret'); } }).catch((value: unknown) => value);
    expect((error as Error).message).toBe('Classifier request failed');
  });

  it('times out while a classifier response body is stalled after headers', async () => {
    const http = await stalledBodyFixture();
    await expect(routeTask({ title: 'Task', description: 'Description' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'fixture', fetch: http.fetch, timeoutMs: 25 })).rejects.toThrow('Classifier request timed out');
  }, 300);

  it('honors caller cancellation while the response body is stalled after headers', async () => {
    const http = await stalledBodyFixture();
    const controller = new AbortController();
    const result = routeTask({ title: 'Task', description: 'Description' }, DEMO_ROUTING_CONFIG,
      { apiKey: 'fixture', fetch: http.fetch, signal: controller.signal });
    await http.receivedHeaders;
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await expect(result).rejects.toThrow('Classifier request canceled');
  }, 300);
});

describe('loadRoutingConfig', () => {
  it('uses demo defaults when no path is configured', () => {
    expect(loadRoutingConfig(undefined)).toBe(DEMO_ROUTING_CONFIG);
  });

  it('loads and validates an absolute JSON config path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'routing-config-'));
    tempDirs.push(dir);
    const path = join(dir, 'routing.json');
    await writeFile(path, JSON.stringify(DEMO_ROUTING_CONFIG));
    expect(loadRoutingConfig(path)).toEqual(DEMO_ROUTING_CONFIG);
  });

  it('rejects relative paths and sanitizes file and parser details', async () => {
    expect(() => loadRoutingConfig(relative(process.cwd(), '/tmp/secret-config.json'))).toThrow(
      'AGENT_ROUTING_CONFIG must be an absolute path',
    );
    const dir = await mkdtemp(join(tmpdir(), 'routing-config-secret-'));
    tempDirs.push(dir);
    const path = join(dir, 'secret-name.json');
    await writeFile(path, '{ "secret-token":');
    let error!: Error;
    try {
      loadRoutingConfig(path);
    } catch (value) {
      error = value as Error;
    }
    expect(error.message).toBe('Could not load AGENT_ROUTING_CONFIG: invalid routing configuration');
    expect(error.message).not.toContain(path);
  });
});
