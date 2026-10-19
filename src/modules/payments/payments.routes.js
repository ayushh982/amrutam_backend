import { Router } from 'express';
import * as paymentsController from './payments.controller.js';
import { authenticate } from '../../middleware/auth.js';
import { idempotencyMiddleware } from '../../middleware/idempotency.js';

const router = Router();

router.post(
  '/',
  authenticate,
  idempotencyMiddleware({ required: true }),
  paymentsController.initiatePayment
);

router.post(
  '/webhook',
  paymentsController.handleWebhook
);

export default router;
