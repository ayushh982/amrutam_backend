import request from 'supertest';
import app from '../../src/app.js';
import { mockPrisma } from '../helpers/mock-prisma.js';

describe('Authentication & RBAC Integration Tests', () => {
  beforeEach(() => {
    mockPrisma.reset();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new patient successfully', async () => {
      const payload = {
        email: 'patient.sharma@example.com',
        password: 'Password123',
        name: 'Rahul Sharma',
        phone: '+919876543210',
        role: 'PATIENT',
      };

      const res = await request(app).post('/api/v1/auth/register').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('patient.sharma@example.com');
      expect(res.body.data.user.role).toBe('PATIENT');
      expect(res.body.data.token).toBeDefined();
    });

    it('should register a new doctor with license and specialization', async () => {
      const payload = {
        email: 'doctor.patel@example.com',
        password: 'Password123',
        name: 'Dr. Anita Patel',
        phone: '+919876543211',
        role: 'DOCTOR',
        specialization: 'Ayurvedic Kayachikitsa',
        licenseNumber: 'AYUSH-KA-2024-001',
        consultationFee: 75000,
        experienceYears: 10,
      };

      const res = await request(app).post('/api/v1/auth/register').send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe('DOCTOR');
      expect(res.body.data.user.doctor.specialization).toBe('Ayurvedic Kayachikitsa');
    });

    it('should reject registration if email is already registered', async () => {
      const payload = {
        email: 'duplicate@example.com',
        password: 'Password123',
        name: 'Duplicate Test',
      };

      await request(app).post('/api/v1/auth/register').send(payload);
      const res = await request(app).post('/api/v1/auth/register').send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('USER_ALREADY_EXISTS');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send({
        email: 'login.test@example.com',
        password: 'CorrectPassword123',
        name: 'Login Tester',
      });
    });

    it('should login successfully with correct credentials and return token', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'login.test@example.com',
        password: 'CorrectPassword123',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('login.test@example.com');
    });

    it('should return 401 Unauthorized for incorrect password', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'login.test@example.com',
        password: 'WrongPassword123',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('RBAC & Route Protection', () => {
    let patientToken;
    let doctorToken;

    beforeEach(async () => {
      const patientRes = await request(app).post('/api/v1/auth/register').send({
        email: 'patient.rbac@example.com',
        password: 'Password123',
        name: 'Patient RBAC',
        role: 'PATIENT',
      });
      patientToken = patientRes.body.data.token;

      const docRes = await request(app).post('/api/v1/auth/register').send({
        email: 'doctor.rbac@example.com',
        password: 'Password123',
        name: 'Doctor RBAC',
        role: 'DOCTOR',
        specialization: 'Panchakarma',
        licenseNumber: 'AYUSH-DOC-001',
      });
      doctorToken = docRes.body.data.token;
    });

    it('GET /api/v1/users/me should succeed with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('patient.rbac@example.com');
    });

    it('GET /api/v1/users/me should return 401 when token is missing', async () => {
      const res = await request(app).get('/api/v1/users/me');
      expect(res.status).toBe(401);
    });

    it('Patient should be forbidden (403) from accessing doctor-only profile updates', async () => {
      const res = await request(app)
        .patch('/api/v1/doctors/profile')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ bio: 'Hacker Bio' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Doctor should be allowed (200) to update their own doctor profile', async () => {
      const res = await request(app)
        .patch('/api/v1/doctors/profile')
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ bio: 'Holistic Ayurveda Specialist' });

      expect(res.status).toBe(200);
      expect(res.body.data.bio).toBe('Holistic Ayurveda Specialist');
    });

    it('Non-admin should be forbidden (403) from accessing /api/v1/admin/analytics', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics')
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
