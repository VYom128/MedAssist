import mongoose from 'mongoose';
import { api } from './helpers/testApp.js';
import { getMongoUri } from './setup.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with status ok, db connected and an X-Request-Id header', async () => {
    const res = await api().get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { status: 'ok', db: 'connected' },
    });
    expect(res.body.data.uptime).toEqual(expect.any(Number));
    expect(Number.isNaN(Date.parse(res.body.data.timestamp))).toBe(false);
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('reports db disconnected when MongoDB is down', async () => {
    await mongoose.disconnect();
    try {
      const res = await api().get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'ok', db: 'disconnected' });
    } finally {
      await mongoose.connect(getMongoUri());
    }
  });
});
