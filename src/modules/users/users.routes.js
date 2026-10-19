import { Router } from 'express';
import * as authController from '../auth/auth.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

router.get('/me', authenticate, authController.getMe);

export default router;
