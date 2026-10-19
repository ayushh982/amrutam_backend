import {
  createBookingSchema,
  cancelBookingSchema,
  listBookingsQuerySchema,
} from './bookings.validation.js';
import * as bookingsService from './bookings.service.js';

export const createBooking = async (req, res, next) => {
  try {
    const validatedData = createBookingSchema.parse(req.body);
    const consultation = await bookingsService.createBooking(
      {
        patientId: req.user.id,
        slotId: validatedData.slotId,
        reason: validatedData.reason,
      },
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(201).json({
      success: true,
      data: consultation,
      message: 'Consultation booked successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const getBookingById = async (req, res, next) => {
  try {
    const consultation = await bookingsService.getBookingById(req.params.id, req.user);
    res.status(200).json({
      success: true,
      data: consultation,
    });
  } catch (error) {
    next(error);
  }
};

export const listBookings = async (req, res, next) => {
  try {
    const query = listBookingsQuerySchema.parse(req.query);
    const result = await bookingsService.listUserBookings(req.user, query);
    res.status(200).json({
      success: true,
      data: result.bookings,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const cancelBooking = async (req, res, next) => {
  try {
    const validatedData = cancelBookingSchema.parse(req.body);
    const result = await bookingsService.cancelBooking(
      req.params.id,
      validatedData.reason,
      req.user,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(200).json({
      success: true,
      data: result,
      message: 'Booking cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
};
