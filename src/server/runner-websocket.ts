import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { allowLocalSocket, type RunnerConfiguration } from './runner-config.js';

/** Paired runners expose no local terminal/state channel, even to localhost. */
export function createRunnerWebSocketServer(server: Server, config: RunnerConfiguration): WebSocketServer {
  return new WebSocketServer({
    server, path: '/pty',
    verifyClient: ({ origin, req }: { origin: string; req: IncomingMessage }) => allowLocalSocket(config, origin || undefined, req.socket.remoteAddress),
  });
}
