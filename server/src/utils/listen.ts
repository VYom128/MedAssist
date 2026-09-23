import type { Server } from 'node:http';
import type { Express } from 'express';

/** The port is taken, usually by another MedAssist server (e.g. `npm run dev`). */
export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(
      `Port ${port} is already in use – another MedAssist API (npm run dev?) is probably running. ` +
        `Use that one, stop it, or set PORT to a free port.`,
    );
    this.name = 'PortInUseError';
  }
}

/**
 * Starts listening and resolves once the server is bound.
 * @throws PortInUseError when the port is taken (instead of an uncaught EADDRINUSE).
 */
export function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE' ? new PortInUseError(port) : err);
    });
  });
}
