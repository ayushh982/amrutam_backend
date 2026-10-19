import { Router } from 'express';
import * as doctorsController from './doctors.controller.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();

// Public doctor endpoints
router.get('/', doctorsController.listDoctors);
router.get('/:id', doctorsController.getDoctorById);
router.get('/:id/slots', doctorsController.listSlots);

// Doctor authenticated endpoints
router.patch('/profile', authenticate, authorize('DOCTOR'), doctorsController.updateProfile);
router.post('/:id/slots', authenticate, authorize('DOCTOR', 'ADMIN'), doctorsController.createSlot);
router.delete('/:id/slots/:slotId', authenticate, authorize('DOCTOR', 'ADMIN'), doctorsController.deleteSlot);

export default router;
