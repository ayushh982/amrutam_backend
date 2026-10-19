import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/app.js';
import { mockPrisma } from '../helpers/mock-prisma.js';

describe('Bookings, Concurrency & Idempotency Integration Tests', () => {
  let doctorToken;
  let doctorId;
  let patientAToken;
  let patientBToken;
  let testSlotId;

  beforeEach(async () => {
    mockPrisma.reset();

    // 1. Register Doctor
    const docRes = await request(app).post('/api/v1/auth/register').send({
      email: 'dr.ayurveda@amrutam.co.in',
      password: 'Password123',
      name: 'Dr. Vikramaditya',
      role: 'DOCTOR',
      specialization: 'Ayurvedic Surgery & Marma',
      licenseNumber: 'AYUSH-SURG-9901',
    });
    doctorToken = docRes.body.data.token;
    doctorId = docRes.body.data.user.doctor.id;

    // 2. Register Patient A
    const patientARes = await request(app).post('/api/v1/auth/register').send({
      email: 'patient.a@example.com',
      password: 'Password123',
      name: 'Patient Alpha',
      role: 'PATIENT',
    });
    patientAToken = patientARes.body.data.token;

    // 3. Register Patient B
    const patientBRes = await request(app).post('/api/v1/auth/register').send({
      email: 'patient.b@example.com',
      password: 'Password123',
      name: 'Patient Beta',
      role: 'PATIENT',
    });
    patientBToken = patientBRes.body.data.token;

    // 4. Create an Availability Slot for Doctor
    const slotRes = await request(app)
      .post(`/api/v1/doctors/${doctorId}/slots`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        startAt: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        endAt: new Date(Date.now() + 86400000 + 1800000).toISOString(), // +30 mins
      });
    testSlotId = slotRes.body.data.id;
  });

  it('should reject booking creation if Idempotency-Key header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .send({
        slotId: testSlotId,
        reason: 'Joint stiffness in morning',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('CRITICAL CONCURRENCY: Two simultaneous patients booking the exact same slot -> Exactly one succeeds (201) and one fails (409 Conflict)', async () => {
    const keyA = uuidv4();
    const keyB = uuidv4();

    // Fire both booking requests concurrently at the exact same moment
    const [resA, resB] = await Promise.all([
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${patientAToken}`)
        .set('Idempotency-Key', keyA)
        .send({
          slotId: testSlotId,
          reason: 'Patient A consultation',
        }),
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${patientBToken}`)
        .set('Idempotency-Key', keyB)
        .send({
          slotId: testSlotId,
          reason: 'Patient B consultation',
        }),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    // Verify error code for the conflicting request
    const failedRes = resA.status === 409 ? resA : resB;
    expect(failedRes.body.error.code).toBe('SLOT_ALREADY_BOOKED');
  });

  it('IDEMPOTENCY: Repeated request with same Idempotency-Key returns cached response without duplicate database records', async () => {
    const idempotencyKey = uuidv4();
    const payload = {
      slotId: testSlotId,
      reason: 'Migraine consultation with herbal plan',
    };

    // First request
    const firstRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    const bookingId = firstRes.body.data.id;

    // Repeated identical request
    const retryRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(retryRes.status).toBe(201);
    expect(retryRes.headers['x-cache-lookup']).toBe('HIT-IDEMPOTENT');
    expect(retryRes.body.data.id).toBe(bookingId);

    // Check DB has only 1 consultation record
    const totalConsultations = await mockPrisma.consultation.count();
    expect(totalConsultations).toBe(1);
  });

  it('IDEMPOTENCY CONFLICT: Reusing Idempotency-Key with different payload triggers 409 Conflict', async () => {
    const idempotencyKey = uuidv4();

    await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slotId: testSlotId,
        reason: 'Reason 1',
      });

    const conflictingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        slotId: testSlotId,
        reason: 'Totally Different Reason 2',
      });

    expect(conflictingRes.status).toBe(409);
    expect(conflictingRes.body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
  });

  it('CROSS-PATIENT ISOLATION: Patient B cannot view Patient A booking details (403 Forbidden)', async () => {
    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        slotId: testSlotId,
        reason: 'Confidential medical issue',
      });

    const bookingId = bookingRes.body.data.id;

    // Patient B attempts to access Patient A's booking
    const snoopingRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${patientBToken}`);

    expect(snoopingRes.status).toBe(403);
    expect(snoopingRes.body.error.code).toBe('FORBIDDEN_RESOURCE_ACCESS');
  });

  it('CANCELLATION: Patient can cancel booking, transitioning state and releasing slot to AVAILABLE', async () => {
    const bookingRes = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${patientAToken}`)
      .set('Idempotency-Key', uuidv4())
      .send({
        slotId: testSlotId,
        reason: 'Fever and cold',
      });

    const bookingId = bookingRes.body.data.id;

    // Cancel booking
    const cancelRes = await request(app)
      .patch(`/api/v1/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${patientAToken}`)
      .send({
        reason: 'Symptoms subsided after herbal tea',
      });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');

    // Verify slot is AVAILABLE again
    const slot = await mockPrisma.availabilitySlot.findUnique({ where: { id: testSlotId } });
    expect(slot.status).toBe('AVAILABLE');
  });
});
