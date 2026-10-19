import { Router } from 'express';
import * as bookingsController from './bookings.controller.js';
import { authenticate, authorize } from '../../middleware/auth.js';
import { idempotencyMiddleware } from '../../middleware/idempotency.js';

const router = Router();

router.post(
  '/',
  authenticate,
  authorize('PATIENT', 'ADMIN'),
  idempotencyMiddleware({ required: true }),
  bookingsController.createBooking
);

router.get('/', authenticate, bookingsController.listBookings);
router.get('/:id', authenticate, bookingsController.getBookingById);
router.patch('/:id/cancel', authenticate, bookingsController.cancelBooking);

export default router;
