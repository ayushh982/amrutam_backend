import {
  listDoctorsQuerySchema,
  updateDoctorProfileSchema,
  createSlotSchema,
  listSlotsQuerySchema,
} from './doctors.validation.js';
import * as doctorsService from './doctors.service.js';

export const listDoctors = async (req, res, next) => {
  try {
    const query = listDoctorsQuerySchema.parse(req.query);
    const result = await doctorsService.listDoctors(query);
    res.status(200).json({
      success: true,
      data: result.doctors,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getDoctorById = async (req, res, next) => {
  try {
    const doctor = await doctorsService.getDoctorById(req.params.id);
    res.status(200).json({
      success: true,
      data: doctor,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const validatedData = updateDoctorProfileSchema.parse(req.body);
    const updated = await doctorsService.updateDoctorProfile(req.user.id, validatedData);
    res.status(200).json({
      success: true,
      data: updated,
      message: 'Doctor profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const createSlot = async (req, res, next) => {
  try {
    const validatedData = createSlotSchema.parse(req.body);
    const slot = await doctorsService.createDoctorSlot(req.params.id, validatedData, req.user);
    res.status(201).json({
      success: true,
      data: slot,
      message: 'Availability slot created successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const listSlots = async (req, res, next) => {
  try {
    const query = listSlotsQuerySchema.parse(req.query);
    const slots = await doctorsService.listDoctorSlots(req.params.id, query);
    res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSlot = async (req, res, next) => {
  try {
    const result = await doctorsService.deleteDoctorSlot(req.params.id, req.params.slotId, req.user);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
