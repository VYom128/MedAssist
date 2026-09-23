import mongoose from 'mongoose';
import { describe, expect, inject, it } from 'vitest';
import { api } from './setup/testApp.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with api ok and db connected', async () => {
    const res = await api().get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Service healthy',
      data: { api: 'ok', db: 'connected' },
    });
    expect(typeof res.body.data.uptime).toBe('number');
    expect(new Date(res.body.data.timestamp).toString()).not.toBe('Invalid Date');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('returns 503 with db disconnected when MongoDB is down', async () => {
    const dbName = mongoose.connection.name;
    await mongoose.disconnect();
    try {
      const res = await api().get('/api/v1/health');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({
        success: true,
        message: 'Database unavailable',
        data: { api: 'ok', db: 'disconnected' },
      });
    } finally {
      await mongoose.connect(inject('mongoUri'), { dbName });
    }
  });
});
