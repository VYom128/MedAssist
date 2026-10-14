import type * as Env from '../../src/config/env.js';

/**
 * Driver choice for STORAGE_DRIVER (services/storage/index.ts). `config` is frozen, so each case
 * loads the module afresh with a mocked config; nothing is stored or sent anywhere.
 */

type StorageConfig = Partial<(typeof Env)['config']['storage']>;

async function load(storage: StorageConfig) {
  vi.resetModules();
  vi.doMock('../../src/config/env.js', async (importOriginal) => {
    const real = await importOriginal<typeof Env>();
    return {
      ...real,
      config: { ...real.config, storage: { ...real.config.storage, ...storage } },
    };
  });
  return import('../../src/services/storage/index.js');
}

const CLOUDINARY = {
  cloudName: 'demo',
  apiKey: '<api-key>',
  apiSecret: '<api-secret>',
  folder: 'x',
};

afterEach(() => {
  vi.doUnmock('../../src/config/env.js');
  vi.resetModules();
});

describe('getStorage', () => {
  it('local: the disk adapter, created once per process', async () => {
    const { getStorage } = await load({ driver: 'local' });
    expect(getStorage().driver).toBe('local');
    expect(getStorage()).toBe(getStorage());
  });

  it('cloudinary with its settings: the Cloudinary adapter', async () => {
    const { getStorage } = await load({ driver: 'cloudinary', cloudinary: CLOUDINARY });
    expect(getStorage().driver).toBe('cloudinary');
  });

  it.each([
    [
      'cloudinary without a secret',
      { driver: 'cloudinary', cloudinary: { ...CLOUDINARY, apiSecret: undefined } },
    ],
    ['s3 (not built)', { driver: 's3' }],
  ] as const)('%s: every call fails with "not configured"', async (_label, storage) => {
    const { getStorage, initStorage } = await load(storage as StorageConfig);
    const adapter = getStorage();
    await expect(initStorage()).rejects.toThrow(/is not configured/);
    await expect(
      adapter.save(Buffer.from('x'), { mimeType: 'text/plain', originalName: 'x' }),
    ).rejects.toThrow(/is not configured/);
    await expect(adapter.createReadStream('key')).rejects.toThrow(/is not configured/);
    await expect(adapter.remove('key')).rejects.toThrow(/is not configured/);
  });
});
