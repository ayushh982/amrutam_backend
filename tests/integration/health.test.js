import request from 'supertest';
import app from '../../src/app.js';

describe('Health and System Endpoints', () => {
  it('GET /health should return 200 and UP status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.service).toBe('amrutam-telemedicine-backend');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET / should return 200 with service meta', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.name).toContain('Amrutam');
  });

  it('GET /metrics should return Prometheus metrics with custom histograms', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('amrutam_http_request_duration_seconds');
  });

  it('GET /unknown-route should return 404 with standard error format', async () => {
    const res = await request(app).get('/api/v1/invalid-route-path');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
  });
});
