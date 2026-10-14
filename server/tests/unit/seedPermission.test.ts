import { seedPermission } from '../../src/seed/index.js';

/**
 * When `npm run seed` may run (spec §15.3, D199): never against production unless it is the
 * hosted demo – `--demo` AND ALLOW_DEMO_SEED=true – and then with a loud warning.
 */
const dev = { isProd: false, isDev: true, allowDemoSeed: false };
const test = { isProd: false, isDev: false, allowDemoSeed: false };
const prod = { isProd: true, isDev: false, allowDemoSeed: false };
const prodAllowed = { ...prod, allowDemoSeed: true };
const REFUSE = /Refusing to seed with NODE_ENV=production/;

describe('seedPermission', () => {
  it('development: seed and --reset', () => {
    expect(seedPermission({}, dev)).toBe(false);
    expect(seedPermission({ reset: true }, dev)).toBe(false);
  });

  it('test: seed, but no --reset', () => {
    expect(seedPermission({}, test)).toBe(false);
    expect(() => seedPermission({ reset: true }, test)).toThrow(
      /only allowed with NODE_ENV=development/,
    );
  });

  it.each([
    ['no flags', {}, prod],
    ['--demo only', { demo: true }, prod],
    ['ALLOW_DEMO_SEED only', {}, prodAllowed],
    ['--reset with ALLOW_DEMO_SEED but no --demo', { reset: true }, prodAllowed],
  ])('production refuses: %s', (_label, options, env) => {
    expect(() => seedPermission(options, env)).toThrow(REFUSE);
  });

  it('production with --demo AND ALLOW_DEMO_SEED=true: allowed (also --reset), flagged for the warning', () => {
    expect(seedPermission({ demo: true }, prodAllowed)).toBe(true);
    expect(seedPermission({ demo: true, reset: true }, prodAllowed)).toBe(true);
  });
});
