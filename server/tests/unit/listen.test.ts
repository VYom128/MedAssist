import { createServer, type Server } from 'node:net';
import express from 'express';
import { listen, PortInUseError } from '../../src/utils/listen.js';

const occupy = () =>
  new Promise<{ server: Server; port: number }>((resolve) => {
    const server = createServer().listen(0, () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });

describe('listen', () => {
  it('resolves with the bound server', async () => {
    const server = await listen(express(), 0);
    expect(server.listening).toBe(true);
    await new Promise((r) => server.close(r));
  });

  it('rejects with a clear PortInUseError when the port is taken', async () => {
    const taken = await occupy();
    const err = await listen(express(), taken.port).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PortInUseError);
    expect((err as Error).message).toContain(`Port ${taken.port} is already in use`);
    await new Promise((r) => taken.server.close(r));
  });
});
