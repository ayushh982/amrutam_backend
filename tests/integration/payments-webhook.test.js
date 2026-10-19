import request from 'supertest';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/app.js';
import { mockPrisma } from '../helpers/mock-prisma.js';

describe('Payments & Webhooks Integration Tests', () => {
  let patientToken;
  let adminToken;
  let consultationId;

  beforeEach(async () => {
    mockPrisma.reset();

    // 1. Doctor
    const docRes = await request(app).post('/api/v1/auth/register').send({
      email: 'doctor.pay@amrutam.co.in',
      password: 'Password123',
      name: 'Dr. Dhanvantari',
      role: 'DOCTOR',
      specialization: 'Ayurvedic Rasayana',
      licenseNumber: 'AYUSH-RAS-01',
    });
    const doctorToken = docRes.body.data.token;
    const doctorId = docRes.body.data.user.doctor.id;

    // 2. Patient
    const patientRes = await request(app).post('/api/v1/auth/register').send({
      email: 'patient.pay@example.com',
      password: 'Password123',
      name: 'Pooja Verma',
      role: 'PATIENT',
    });
    patientToken = patientRes.body.data.token;

    // 3. Admin user directly in mock store
    const admin = await mockPrisma.user.create({
      data: {
        email: 'admin@amrutam.co.in',
        passwordHash: 'dummy',
        role: 'ADMIN',
      },
    });
    const { generateToken } = await import('../../src/middleware/auth.js');
    adminToken = generateToken({ id: admin.id, email: admin.email, role: 'ADMIN' });

    // 4. Create slot and booking
    const slotRes = await request(app)
      .post(`/api/v1/doctors/${doctorId}/slots`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        startAt: new Date(Date.now() + 86400000).toISOString(),
        endAt: new Date(Date.now() + 86400000 + 1800000).toISOString(),
      });
    const slotId = slotRes.body.data.id;

    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        slotId,
        reason: 'Rasayana rejuvenation consultation',
      });
    consultationId = bookingRes.body.data.id;
  });

  it('POST /api/v1/payments initiates payment with idempotency key', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        consultationId,
        amount: 50000,
        currency: 'INR',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payment.status).toBe('PENDING');
    expect(res.body.data.payment.amount).toBe(50000);
    expect(res.body.data.checkoutUrl).toBeDefined();
  });

  it('POST /api/v1/payments/webhook rejects webhook with invalid signature (401)', async () => {
    const payload = {
      eventId: 'evt_invalid_sig',
      eventType: 'payment.succeeded',
      provider: 'mock_provider',
      data: {
        paymentId: uuidv4(),
        providerReference: 'mock_pay_123',
        amount: 50000,
        currency: 'INR',
      },
    };

    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('X-Webhook-Signature', 'invalid_signature_hex')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('POST /api/v1/payments/webhook verifies valid HMAC signature and processes payment', async () => {
    // 1. Initiate payment first
    const initRes = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        consultationId,
        amount: 50000,
        currency: 'INR',
      });
    const paymentId = initRes.body.data.payment.id;

    // 2. Prepare webhook payload
    const eventPayload = {
      eventId: `evt_${uuidv4()}`,
      eventType: 'payment.succeeded',
      provider: 'mock_provider',
      data: {
        paymentId,
        providerReference: 'mock_pay_success_123',
        amount: 50000,
        currency: 'INR',
      },
    };

    const payloadString = JSON.stringify(eventPayload);
    const validSignature = crypto
      .createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET)
      .update(payloadString)
      .digest('hex');

    // 3. Send webhook
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', validSignature)
      .send(payloadString);

    expect(res.status).toBe(200);
    expect(res.body.data.paymentStatus).toBe('COMPLETED');
    expect(res.body.data.duplicate).toBe(false);

    // 4. Duplicate webhook delivery test: Send exact same webhook again
    const dupRes = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', validSignature)
      .send(payloadString);

    expect(dupRes.status).toBe(200);
    expect(dupRes.body.data.duplicate).toBe(true);
  });

  it('GET /api/v1/admin/analytics returns system metrics for ADMIN', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.users).toBeDefined();
    expect(res.body.data.consultations).toBeDefined();
    expect(res.body.data.revenue).toBeDefined();
  });
});
