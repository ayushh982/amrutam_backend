import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// Custom metrics to validate SLA targets
const readLatency = new Trend('read_duration_p95');
const writeLatency = new Trend('write_duration_p95');
const errorRate = new Rate('error_rate');
const bookingConflicts = new Counter('booking_conflicts_detected');

export const options = {
  scenarios: {
    // 1. Doctor Discovery & Profile Search (Read Heavy: 80% traffic)
    read_traffic: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '30s', target: 50 },  // Ramp-up
        { duration: '1m', target: 100 },  // Sustained peak load
        { duration: '30s', target: 0 },   // Ramp-down
      ],
      exec: 'readScenario',
    },
    // 2. Booking & Mutating Writes (20% traffic)
    write_traffic: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 40 },
        { duration: '30s', target: 0 },
      ],
      exec: 'writeScenario',
    },
  },
  thresholds: {
    // SLA 1: p95 read latency below 200 ms
    'read_duration_p95': ['p(95)<200'],
    // SLA 2: p95 write latency below 500 ms
    'write_duration_p95': ['p(95)<500'],
    // Availability target: Error rate below 0.05% (99.95% target)
    'error_rate': ['rate<0.0005'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function readScenario() {
  group('Doctor Search & Discovery', () => {
    // 1. Health check
    const healthRes = http.get(`${BASE_URL}/health`);
    check(healthRes, { 'health status is 200': (r) => r.status === 200 });

    // 2. Search doctors
    const start = new Date();
    const docRes = http.get(`${BASE_URL}/api/v1/doctors?specialization=Ayurveda&limit=10`);
    const duration = new Date() - start;

    readLatency.add(duration);
    const passed = check(docRes, {
      'doctors status is 200': (r) => r.status === 200,
      'has pagination': (r) => JSON.parse(r.body).pagination !== undefined,
    });

    if (!passed) errorRate.add(1);
    else errorRate.add(0);
  });

  sleep(1);
}

export function writeScenario() {
  group('Auth & Mutation Flow', () => {
    const email = `k6_patient_${__VU}_${Date.now()}@example.com`;
    const payload = JSON.stringify({
      email,
      password: 'Password123',
      name: `K6 User ${__VU}`,
      role: 'PATIENT',
    });

    const headers = { 'Content-Type': 'application/json' };

    const start = new Date();
    const regRes = http.post(`${BASE_URL}/api/v1/auth/register`, payload, { headers });
    const duration = new Date() - start;

    writeLatency.add(duration);
    const passed = check(regRes, {
      'register status is 201': (r) => r.status === 201,
    });

    if (!passed) errorRate.add(1);
    else errorRate.add(0);
  });

  sleep(1);
}
