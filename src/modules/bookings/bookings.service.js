import { prisma } from '../../database/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAuditEvent } from '../../middleware/audit.js';
import { bookingConflictsTotal } from '../../observability/metrics.js';

export const createBooking = async ({ patientId, slotId, reason }, reqMeta = {}) => {
  // Check if slot exists and fetch doctor details
  const slot = await prisma.availabilitySlot.findUnique({
    where: { id: slotId },
    include: { doctor: true },
  });

  if (!slot) {
    throw new AppError('The requested availability slot does not exist.', 404, 'SLOT_NOT_FOUND');
  }

  // Prevent doctor from booking themselves
  if (slot.doctor.userId === patientId) {
    throw new AppError('Doctors cannot book consultations with themselves.', 400, 'SELF_BOOKING_NOT_ALLOWED');
  }

  // Atomic database transaction with row-level lock & status check
  const consultation = await prisma.$transaction(async (tx) => {
    // 1. Atomic slot status update: succeeds ONLY IF status is currently 'AVAILABLE'
    const updateResult = await tx.availabilitySlot.updateMany({
      where: {
        id: slotId,
        status: 'AVAILABLE',
      },
      data: {
        status: 'BOOKED',
      },
    });

    if (updateResult.count === 0) {
      bookingConflictsTotal.inc();
      throw new AppError(
        'This slot has already been booked or is no longer available.',
        409,
        'SLOT_ALREADY_BOOKED'
      );
    }

    // 2. Create consultation record (guaranteed unique by slotId constraint)
    const newConsultation = await tx.consultation.create({
      data: {
        patientId,
        doctorId: slot.doctorId,
        slotId,
        status: 'BOOKED',
        reason,
      },
      include: {
        slot: true,
        doctor: {
          include: {
            user: { select: { email: true, profile: { select: { name: true } } } },
          },
        },
        patient: {
          select: { email: true, profile: { select: { name: true, phone: true } } },
        },
      },
    });

    // 3. Transactional Outbox Pattern: Record event for downstream notifications/queues
    await tx.outboxEvent.create({
      data: {
        eventType: 'BOOKING_CREATED',
        aggregateType: 'Consultation',
        aggregateId: newConsultation.id,
        payload: {
          consultationId: newConsultation.id,
          patientId,
          doctorId: slot.doctorId,
          slotId,
          startAt: slot.startAt,
          endAt: slot.endAt,
        },
      },
    });

    return newConsultation;
  });

  // 4. Audit Log
  await logAuditEvent({
    actorId: patientId,
    action: 'BOOKING_CREATED',
    resourceType: 'Consultation',
    resourceId: consultation.id,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { slotId, doctorId: slot.doctorId },
  });

  return consultation;
};

export const getBookingById = async (bookingId, requestingUser) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: bookingId },
    include: {
      slot: true,
      doctor: {
        include: {
          user: { select: { email: true, profile: { select: { name: true } } } },
        },
      },
      patient: {
        select: { id: true, email: true, profile: { select: { name: true, phone: true } } },
      },
      prescription: {
        include: { items: true },
      },
      payments: true,
    },
  });

  if (!consultation) {
    throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  }

  // Cross-patient data isolation: enforce ownership
  const isPatient = consultation.patientId === requestingUser.id;
  const isDoctor = consultation.doctor.userId === requestingUser.id;
  const isAdmin = requestingUser.role === 'ADMIN';

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new AppError(
      'Forbidden: You do not have permission to view this booking record',
      403,
      'FORBIDDEN_RESOURCE_ACCESS'
    );
  }

  return consultation;
};

export const listUserBookings = async (requestingUser, { status, page = 1, limit = 20 }) => {
  const skip = (page - 1) * limit;

  let where = {};
  if (requestingUser.role === 'PATIENT') {
    where.patientId = requestingUser.id;
  } else if (requestingUser.role === 'DOCTOR') {
    const doctor = await prisma.doctor.findUnique({ where: { userId: requestingUser.id } });
    if (!doctor) throw new AppError('Doctor profile not found', 404, 'DOCTOR_NOT_FOUND');
    where.doctorId = doctor.id;
  }
  // Admin sees all

  if (status) {
    where.status = status;
  }

  const [total, bookings] = await Promise.all([
    prisma.consultation.count({ where }),
    prisma.consultation.findMany({
      where,
      skip,
      take: limit,
      include: {
        slot: true,
        doctor: {
          include: {
            user: { select: { profile: { select: { name: true } } } },
          },
        },
        patient: {
          select: { profile: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    bookings,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const cancelBooking = async (bookingId, cancellationReason, requestingUser, reqMeta = {}) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: bookingId },
    include: {
      doctor: true,
      slot: true,
    },
  });

  if (!consultation) {
    throw new AppError('Booking not found', 404, 'BOOKING_NOT_FOUND');
  }

  // Ownership validation
  const isPatient = consultation.patientId === requestingUser.id;
  const isDoctor = consultation.doctor.userId === requestingUser.id;
  const isAdmin = requestingUser.role === 'ADMIN';

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new AppError('Forbidden: You cannot cancel this booking', 403, 'FORBIDDEN');
  }

  // State validation: only BOOKED status can be cancelled
  if (consultation.status !== 'BOOKED') {
    throw new AppError(
      `Cannot cancel consultation in status '${consultation.status}'. Only BOOKED consultations can be cancelled.`,
      400,
      'INVALID_CANCELLATION_STATE'
    );
  }

  // Atomic cancellation + slot release
  const updatedConsultation = await prisma.$transaction(async (tx) => {
    // 1. Release slot back to AVAILABLE
    await tx.availabilitySlot.update({
      where: { id: consultation.slotId },
      data: { status: 'AVAILABLE' },
    });

    // 2. Set consultation status to CANCELLED with notes
    const updated = await tx.consultation.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELLED',
        notes: `Cancelled by ${requestingUser.role}: ${cancellationReason}`,
      },
      include: { slot: true },
    });

    // 3. Outbox Event
    await tx.outboxEvent.create({
      data: {
        eventType: 'BOOKING_CANCELLED',
        aggregateType: 'Consultation',
        aggregateId: bookingId,
        payload: {
          bookingId,
          reason: cancellationReason,
          cancelledBy: requestingUser.id,
        },
      },
    });

    return updated;
  });

  // Audit log
  await logAuditEvent({
    actorId: requestingUser.id,
    action: 'BOOKING_CANCELLED',
    resourceType: 'Consultation',
    resourceId: bookingId,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { reason: cancellationReason },
  });

  return updatedConsultation;
};
