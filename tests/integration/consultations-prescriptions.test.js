import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/app.js';
import { mockPrisma } from '../helpers/mock-prisma.js';

describe('Consultations & Prescriptions Lifecycle Tests', () => {
  let doctorToken;
  let doctorId;
  let otherDoctorToken;
  let patientToken;
  let otherPatientToken;
  let consultationId;

  beforeEach(async () => {
    mockPrisma.reset();

    // 1. Doctor
    const docRes = await request(app).post('/api/v1/auth/register').send({
      email: 'doctor.ayush@amrutam.co.in',
      password: 'Password123',
      name: 'Dr. Charaka',
      role: 'DOCTOR',
      specialization: 'Ayurvedic Herbology',
      licenseNumber: 'AYUSH-HERB-01',
    });
    doctorToken = docRes.body.data.token;
    doctorId = docRes.body.data.user.doctor.id;

    // 2. Other Doctor
    const otherDocRes = await request(app).post('/api/v1/auth/register').send({
      email: 'other.doctor@amrutam.co.in',
      password: 'Password123',
      name: 'Dr. Sushruta',
      role: 'DOCTOR',
      specialization: 'Ayurvedic Surgery',
      licenseNumber: 'AYUSH-SURG-02',
    });
    otherDoctorToken = otherDocRes.body.data.token;

    // 3. Patient
    const patientRes = await request(app).post('/api/v1/auth/register').send({
      email: 'patient.one@example.com',
      password: 'Password123',
      name: 'Patient One',
      role: 'PATIENT',
    });
    patientToken = patientRes.body.data.token;

    // 4. Other Patient
    const otherPatientRes = await request(app).post('/api/v1/auth/register').send({
      email: 'patient.two@example.com',
      password: 'Password123',
      name: 'Patient Two',
      role: 'PATIENT',
    });
    otherPatientToken = otherPatientRes.body.data.token;

    // 5. Create Slot & Book Consultation
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
        reason: 'Digestive dosha imbalance',
      });
    consultationId = bookingRes.body.data.id;
  });

  describe('Consultation Status State Machine', () => {
    it('Assigned Doctor can transition status from BOOKED to IN_PROGRESS', async () => {
      const res = await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'IN_PROGRESS', notes: 'Consultation commenced on video' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('IN_PROGRESS');
    });

    it('Should reject invalid state transition (BOOKED -> COMPLETED directly)', async () => {
      const res = await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('Unassigned Doctor cannot transition consultation status (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${otherDoctorToken}`)
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(403);
    });

    it('Patient cannot transition consultation status (403 Forbidden)', async () => {
      const res = await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(403);
    });
  });

  describe('Prescriptions Lifecycle & Authorization', () => {
    it('Should reject prescription creation while consultation is still in BOOKED state', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/prescriptions`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          notes: 'Take before sleep',
          items: [
            {
              medication: 'Triphala Churna',
              dosage: '5g',
              instructions: 'With lukewarm water',
              duration: '10 days',
            },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PRESCRIPTION_STATE');
    });

    it('Assigned Doctor can create prescription when consultation is IN_PROGRESS', async () => {
      // Transition to IN_PROGRESS first
      await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'IN_PROGRESS' });

      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/prescriptions`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          notes: 'Maintain Pitta-pacifying diet',
          items: [
            {
              medication: 'Amrutam Kuntal Care Hair Oil',
              dosage: '10ml',
              instructions: 'Massage gently into scalp',
              duration: '30 days',
            },
            {
              medication: 'Ashwagandha Capsules',
              dosage: '1 capsule',
              instructions: 'Take twice daily after meals',
              duration: '15 days',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.notes).toContain('Pitta-pacifying');
    });

    it('Patient can view their own prescription (200), but other patient is forbidden (403)', async () => {
      // Move to IN_PROGRESS & Issue prescription
      await request(app)
        .patch(`/api/v1/consultations/${consultationId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'IN_PROGRESS' });

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/prescriptions`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          items: [
            {
              medication: 'Brahmi Vati',
              dosage: '1 tablet',
              instructions: 'Morning with milk',
              duration: '7 days',
            },
          ],
        });

      // Patient 1 views their prescription
      const patientRes = await request(app)
        .get(`/api/v1/consultations/${consultationId}/prescription`)
        .set('Authorization', `Bearer ${patientToken}`);

      expect(patientRes.status).toBe(200);
      expect(patientRes.body.data.items[0].medication).toBe('Brahmi Vati');

      // Patient 2 attempts to view Patient 1's prescription
      const snoopingRes = await request(app)
        .get(`/api/v1/consultations/${consultationId}/prescription`)
        .set('Authorization', `Bearer ${otherPatientToken}`);

      expect(snoopingRes.status).toBe(403);
    });
  });
});
