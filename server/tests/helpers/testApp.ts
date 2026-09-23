import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Router, type Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * Test servers listen on 127.0.0.1 only. supertest's default (`request(app)`) starts a server on
 * port 0 on every interface (`::`) for each request and then connects to 127.0.0.1:<port>. On
 * macOS another socket may hold the same port number on 127.0.0.1 specifically (e.g. another
 * worker's in-memory mongod), and the more specific binding wins: the request then reaches the
 * wrong process ("Parse Error: Expected HTTP/", or a 404 with an empty body).
 */
const servers: Server[] = [];

/** Starts `app` on 127.0.0.1 (closed by closeTestServers) and returns a supertest factory. */
export async function serve(app: Express): Promise<() => ReturnType<typeof request>> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return () => request(url);
}

/** Routes `api(router)` mounts for one test (before notFound). */
let extra: Router | undefined;
const extraSlot = Router().use((req, res, next) => (extra ? extra(req, res, next) : next()));
let shared: (() => ReturnType<typeof request>) | undefined;

/** Starts this test file's shared app server (tests/setup.ts). */
export async function startTestServer() {
  shared = await serve(createApp({ extraRoutes: extraSlot }));
}

/** Closes every server started by this test file. */
export async function closeTestServers() {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  shared = undefined;
}

/** Supertest agent for the real app, optionally with test-only routes mounted before notFound. */
export const api = (extraRoutes?: Router) => {
  if (!shared) throw new Error('Test server not started (tests/setup.ts)');
  extra = extraRoutes;
  return shared();
};

export interface ErrorBody {
  success: false;
  message: string;
  error: { code: string; details?: unknown };
  requestId: string;
}

/** Asserts the standard error envelope (spec §7.1) and returns the typed body. */
export function expectErrorShape(body: unknown, code: string): ErrorBody {
  expect(body).toMatchObject({
    success: false,
    message: expect.any(String),
    error: { code },
    requestId: expect.any(String),
  });
  return body as ErrorBody;
}
