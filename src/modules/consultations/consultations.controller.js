import {
  updateConsultationStatusSchema,
  createPrescriptionSchema,
} from './consultations.validation.js';
import * as consultationsService from './consultations.service.js';

export const getConsultation = async (req, res, next) => {
  try {
    const consultation = await consultationsService.getConsultationById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

export const updateStatus = async (req, res, next) => {
  try {
    const validatedData = updateConsultationStatusSchema.parse(req.body);
    const updated = await consultationsService.updateConsultationStatus(
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
      message: 'Consultation status updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const createPrescription = async (req, res, next) => {
  try {
    const validatedData = createPrescriptionSchema.parse(req.body);
    const prescription = await consultationsService.createPrescription(
      req.params.id,
      validatedData,
      req.user,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(201).json({
      success: true,
      data: prescription,
      message: 'Prescription created successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getPrescription = async (req, res, next) => {
  try {
    const prescription = await consultationsService.getPrescriptionByConsultationId(
      req.params.id,
      req.user
    );

    res.status(200).json({
      success: true,
      data: prescription,
    });
  } catch (error) {
    next(error);
  }
};
