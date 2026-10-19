import { Router } from 'express';
import * as adminController from './admin.controller.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const router = Router();

// All admin routes require ADMIN role
router.use(authenticate, authorize('ADMIN'));

router.get('/analytics', adminController.getAnalytics);
router.get('/audit-logs', adminController.getAuditLogs);
router.patch('/doctors/:id/verify', adminController.verifyDoctor);

export default router;
