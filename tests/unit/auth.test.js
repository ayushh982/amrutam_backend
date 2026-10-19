import { hashPassword, comparePassword, generateToken, verifyToken } from '../../src/middleware/auth.js';
import { registerSchema, loginSchema } from '../../src/modules/auth/auth.validation.js';

describe('Auth Unit Tests', () => {
  describe('Password Hashing & Verification', () => {
    it('should securely hash a password and verify it accurately', async () => {
      const password = 'SuperSecret123!';
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash.startsWith('$2')).toBe(true); // bcrypt prefix

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);

      const isWrongMatch = await comparePassword('WrongPassword123!', hash);
      expect(isWrongMatch).toBe(false);
    });
  });

  describe('JWT Token Generation & Verification', () => {
    it('should generate a valid JWT and decode the claims correctly', () => {
      const payload = { id: 'usr-123', email: 'test@amrutam.co.in', role: 'PATIENT' };
      const token = generateToken(payload);

      expect(typeof token).toBe('string');
      const decoded = verifyToken(token);
      expect(decoded.id).toBe(payload.id);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
    });

    it('should reject tampered JWT tokens', () => {
      const token = generateToken({ id: 'usr-123' });
      const tampered = token + 'tamper';
      expect(() => verifyToken(tampered)).toThrow();
    });
  });

  describe('Registration Zod Validation Schema', () => {
    it('should accept valid patient registration payload', () => {
      const payload = {
        email: 'patient@example.com',
        password: 'Password123',
        name: 'Amit Patel',
        role: 'PATIENT',
      };
      const result = registerSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject doctor registration without licenseNumber and specialization', () => {
      const payload = {
        email: 'doctor@example.com',
        password: 'Password123',
        name: 'Dr. Vaidya',
        role: 'DOCTOR',
      };
      const result = registerSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('should accept doctor registration with licenseNumber and specialization', () => {
      const payload = {
        email: 'doctor@example.com',
        password: 'Password123',
        name: 'Dr. Vaidya',
        role: 'DOCTOR',
        specialization: 'Ayurvedic Medicine',
        licenseNumber: 'AYUSH-12345',
      };
      const result = registerSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject passwords lacking uppercase or numbers', () => {
      const weakPassword = {
        email: 'user@example.com',
        password: 'weakpassword',
        name: 'User',
      };
      const result = registerSchema.safeParse(weakPassword);
      expect(result.success).toBe(false);
    });
  });
});
