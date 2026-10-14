import type { Router } from 'express';
import apiRoutes from '../../src/routes/index.js';

/** Walks the real /api/v1 router (Express 4 layers): every mounted route as "METHOD /path". */

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
}

/** "/users" from Express 4's mount regexp `^\/users\/?(?=\/|$)`. */
function mountPath(regexp: RegExp): string {
  return regexp.source.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\(.)/g, '$1');
}

function listRoutes(stack: Layer[], prefix = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const path = `${prefix}${layer.route.path}`.replace(/(.)\/$/, '$1');
      return Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${path}`);
    }
    if (layer.name === 'router' && layer.handle.stack) {
      return listRoutes(layer.handle.stack, `${prefix}${mountPath(layer.regexp)}`);
    }
    return [];
  });
}

/** Every route mounted under /api/v1, e.g. "GET /users/:id". */
export const API_ROUTES = listRoutes((apiRoutes as unknown as Router & { stack: Layer[] }).stack);
