import { Router } from 'express';
import * as authController from './auth.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { authRateLimiter } from '../../middleware/rate-limiter.js';

const router = Router();

router.post('/register', authRateLimiter, authController.register);
router.post('/login', authRateLimiter, authController.login);
router.get('/me', authenticate, authController.getMe);

export default router;
