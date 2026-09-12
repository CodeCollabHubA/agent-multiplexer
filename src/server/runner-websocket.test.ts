import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { createRunnerWebSocketServer } from './runner-websocket.js';
import type { RunnerConfiguration } from './runner-config.js';

it.each([
  { mode: 'paired' as const, url: 'https://test.convex.cloud', profileKey: 'space-a', machineToken: 'secret' },
  { mode: 'local' as const },
])('denies foreign-origin browser access in $mode mode before any connection handler', async (config: RunnerConfiguration) => {
  const http = createServer();
  const server = createRunnerWebSocketServer(http, config);
  let connections = 0;
  server.on('connection', () => { connections++; });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/pty`, { origin: config.mode === 'paired' ? 'http://localhost:5173' : 'https://attacker.test' });
  try {
    const failure = await new Promise<string>(resolve => { socket.once('error', error => resolve(error.message)); socket.once('open', () => resolve('opened')); });
    expect(failure).toContain('401');
    expect(connections).toBe(0);
  } finally {
    socket.terminate();
    server.close();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
