import { listAuditLogsQuerySchema, verifyDoctorSchema } from './admin.validation.js';
import * as adminService from './admin.service.js';

export const getAnalytics = async (req, res, next) => {
  try {
    const analytics = await adminService.getSystemAnalytics();
    res.status(200).json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    next(error);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const result = await adminService.listAuditLogs(query);
    res.status(200).json({
      success: true,
      data: result.logs,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const verifyDoctor = async (req, res, next) => {
  try {
    const validatedData = verifyDoctorSchema.parse(req.body);
    const updated = await adminService.verifyDoctor(
      req.params.id,
      validatedData,
      req.user,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(200).json({
      success: true,
      data: updated,
      message: `Doctor verification status updated to ${validatedData.status}`,
    });
  } catch (error) {
    next(error);
  }
};
