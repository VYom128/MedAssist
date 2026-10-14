import { createHash } from 'node:crypto';
import { cloudinaryStorage, signParams } from '../../src/services/storage/cloudinary.js';

/**
 * The Cloudinary driver (D201) with a fake fetch – no network, no SDK: the request signature
 * (Cloudinary's documented example), private raw uploads, signed short-lived downloads streamed
 * back, deletes, and keys that never escape the folder.
 */

const OPTIONS = {
  cloudName: 'demo-cloud',
  apiKey: '123456789012345',
  apiSecret: 'test-cloudinary-0123456789',
  folder: 'medassist',
};
const NOW = Date.UTC(2026, 9, 14, 6, 30, 0); // 14 Oct 2026, 06:30Z
const TS = Math.floor(NOW / 1000);

interface Call {
  url: string;
  method: string;
  fields: Record<string, string>;
  file?: Blob;
}

/** A fetch that records each request and answers with `respond`. */
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const fields: Record<string, string> = {};
    let file: Blob | undefined;
    if (init?.body instanceof FormData) {
      for (const [k, v] of init.body.entries()) {
        if (typeof v === 'string') fields[k] = v;
        else file = v;
      }
    }
    const call = { url: String(input), method: init?.method ?? 'GET', fields, file };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

const expectedSignature = (params: Record<string, string>) => {
  const { api_key: _k, signature: _s, ...signedParams } = params;
  const toSign = Object.keys(signedParams)
    .sort()
    .map((k) => `${k}=${signedParams[k]}`)
    .join('&');
  return createHash('sha1')
    .update(toSign + OPTIONS.apiSecret)
    .digest('hex');
};

describe('signParams', () => {
  it("matches Cloudinary's documented example", () => {
    expect(
      signParams(
        {
          eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
          public_id: 'sample_image',
          timestamp: 1315060510,
        },
        'abcd',
      ),
    ).toBe('bfd09f95f331f558cbd1320e67aa8d488770583e');
  });

  it('sorts by name and never signs file, api_key, resource_type or cloud_name', () => {
    const a = signParams({ timestamp: 1, public_id: 'x' }, 's');
    expect(signParams({ public_id: 'x', timestamp: 1, api_key: 'k', file: 'f' }, 's')).toBe(a);
    expect(signParams({ public_id: 'x', timestamp: 2 }, 's')).not.toBe(a);
  });
});

describe('cloudinaryStorage', () => {
  it('uploads a private raw file under a random id in the folder and keeps only that id', async () => {
    const { fn, calls } = fakeFetch(
      (call) => new Response(JSON.stringify({ public_id: call.fields.public_id })),
    );
    const storage = cloudinaryStorage(OPTIONS, { fetch: fn, now: () => NOW });
    const pdf = Buffer.from('%PDF-1.7 test');
    const { storageKey } = await storage.save(pdf, {
      mimeType: 'application/pdf',
      originalName: 'Priya Sharma lab report.pdf',
    });

    expect(storageKey).toMatch(/^medassist\/2026\/10\/[0-9a-f-]{36}\.pdf$/);
    expect(storageKey).not.toContain('Priya');
    const [call] = calls;
    expect(call!.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/raw/upload');
    expect(call!.method).toBe('POST');
    expect(call!.fields).toMatchObject({
      public_id: storageKey,
      type: 'authenticated', // never public
      overwrite: 'false',
      timestamp: String(TS),
      api_key: OPTIONS.apiKey,
    });
    expect(call!.fields.signature).toBe(expectedSignature(call!.fields));
    expect(Buffer.from(await call!.file!.arrayBuffer()).toString()).toBe('%PDF-1.7 test');
    expect(JSON.stringify(call!.fields)).not.toContain(OPTIONS.apiSecret);
  });

  it('a failed upload rejects without the response body', async () => {
    const { fn } = fakeFetch(
      () => new Response('{"error":{"message":"Invalid Signature"}}', { status: 401 }),
    );
    const storage = cloudinaryStorage(OPTIONS, { fetch: fn, now: () => NOW });
    await expect(
      storage.save(Buffer.from('x'), { mimeType: 'image/png', originalName: 'a.png' }),
    ).rejects.toThrow(/^Cloudinary upload failed \(HTTP 401\)$/);
  });

  it('downloads with a signed link valid for 60 s and streams the bytes', async () => {
    const { fn, calls } = fakeFetch(() => new Response('%PDF-1.7 bytes'));
    const storage = cloudinaryStorage(OPTIONS, { fetch: fn, now: () => NOW });
    const key = 'medassist/2026/10/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.pdf';
    const stream = await storage.createReadStream(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-1.7 bytes');

    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/raw/download',
    );
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      public_id: key,
      type: 'authenticated',
      attachment: 'false',
      timestamp: String(TS),
      expires_at: String(TS + 60),
      api_key: OPTIONS.apiKey,
    });
    expect(params.signature).toBe(expectedSignature(params));
  });

  it('unknown or foreign keys are 404 without asking Cloudinary', async () => {
    const { fn, calls } = fakeFetch(() => new Response('', { status: 404 }));
    const storage = cloudinaryStorage(OPTIONS, { fetch: fn, now: () => NOW });
    for (const key of [
      '../etc/passwd',
      'other/2026/10/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.pdf',
      '2026/10/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.pdf', // a local-driver key
    ]) {
      await expect(storage.createReadStream(key)).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(calls).toHaveLength(0);
    await expect(
      storage.createReadStream('medassist/2026/10/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.pdf'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes with a signed destroy (invalidating cached copies); bad keys are ignored', async () => {
    const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ result: 'ok' })));
    const storage = cloudinaryStorage(OPTIONS, { fetch: fn, now: () => NOW });
    const key = 'medassist/2026/10/0b6f2c1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b.png';
    await storage.remove(key);
    await storage.remove('../../everything');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/raw/destroy');
    expect(calls[0]!.fields).toMatchObject({
      public_id: key,
      type: 'authenticated',
      invalidate: 'true',
    });
    expect(calls[0]!.fields.signature).toBe(expectedSignature(calls[0]!.fields));
  });
});
