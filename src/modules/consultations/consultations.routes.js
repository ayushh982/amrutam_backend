import { Router } from 'express';
import * as consultationsController from './consultations.controller.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();

router.get('/:id', authenticate, consultationsController.getConsultation);
router.patch('/:id/status', authenticate, authorize('DOCTOR', 'ADMIN'), consultationsController.updateStatus);

// Prescriptions sub-routes
router.post(
  '/:id/prescriptions',
  authenticate,
  authorize('DOCTOR', 'ADMIN'),
  consultationsController.createPrescription
);

router.get(
  '/:id/prescription',
  authenticate,
  consultationsController.getPrescription
);

export default router;
