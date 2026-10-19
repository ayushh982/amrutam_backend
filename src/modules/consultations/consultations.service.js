import { prisma } from '../../database/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAuditEvent } from '../../middleware/audit.js';

const VALID_TRANSITIONS = {
  BOOKED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const getConsultationById = async (consultationId, requestingUser) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
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
    throw new AppError('Consultation not found', 404, 'CONSULTATION_NOT_FOUND');
  }

  const isPatient = consultation.patientId === requestingUser.id;
  const isDoctor = consultation.doctor.userId === requestingUser.id;
  const isAdmin = requestingUser.role === 'ADMIN';

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new AppError(
      'Forbidden: You do not have permission to view this consultation record',
      403,
      'FORBIDDEN'
    );
  }

  return consultation;
};

export const updateConsultationStatus = async (
  consultationId,
  { status: targetStatus, notes },
  requestingUser,
  reqMeta = {}
) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: true },
  });

  if (!consultation) {
    throw new AppError('Consultation not found', 404, 'CONSULTATION_NOT_FOUND');
  }

  // Only assigned doctor or ADMIN can advance consultation lifecycle
  const isDoctor = consultation.doctor.userId === requestingUser.id;
  const isAdmin = requestingUser.role === 'ADMIN';

  if (!isDoctor && !isAdmin) {
    throw new AppError('Forbidden: Only the assigned doctor can update consultation status', 403, 'FORBIDDEN');
  }

  // Validate state machine transition
  const allowedNextStates = VALID_TRANSITIONS[consultation.status] || [];
  if (!allowedNextStates.includes(targetStatus)) {
    throw new AppError(
      `Invalid state transition: Cannot transition from '${consultation.status}' to '${targetStatus}'. Allowed: [${allowedNextStates.join(', ')}]`,
      400,
      'INVALID_STATUS_TRANSITION'
    );
  }

  const updated = await prisma.consultation.update({
    where: { id: consultationId },
    data: {
      status: targetStatus,
      ...(notes && { notes: consultation.notes ? `${consultation.notes}\n${notes}` : notes }),
    },
    include: { slot: true, doctor: true, patient: true },
  });

  // Audit log
  await logAuditEvent({
    actorId: requestingUser.id,
    action: `CONSULTATION_STATUS_${targetStatus}`,
    resourceType: 'Consultation',
    resourceId: consultationId,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { previousStatus: consultation.status, newStatus: targetStatus },
  });

  return updated;
};

export const createPrescription = async (
  consultationId,
  { notes, items },
  requestingUser,
  reqMeta = {}
) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: true, prescription: true },
  });

  if (!consultation) {
    throw new AppError('Consultation not found', 404, 'CONSULTATION_NOT_FOUND');
  }

  // Doctor authorization
  if (consultation.doctor.userId !== requestingUser.id && requestingUser.role !== 'ADMIN') {
    throw new AppError('Forbidden: Only the assigned doctor can issue a prescription', 403, 'FORBIDDEN');
  }

  // Status requirement: must be IN_PROGRESS or COMPLETED
  if (consultation.status !== 'IN_PROGRESS' && consultation.status !== 'COMPLETED') {
    throw new AppError(
      `Prescriptions can only be issued during or after consultation (Current status: ${consultation.status})`,
      400,
      'INVALID_PRESCRIPTION_STATE'
    );
  }

  // Prevent duplicate prescriptions
  if (consultation.prescription) {
    throw new AppError('A prescription has already been issued for this consultation', 409, 'PRESCRIPTION_EXISTS');
  }

  const prescription = await prisma.$transaction(async (tx) => {
    const created = await tx.prescription.create({
      data: {
        consultationId,
        doctorId: consultation.doctorId,
        patientId: consultation.patientId,
        notes,
        items: {
          create: items.map((item) => ({
            medication: item.medication,
            dosage: item.dosage,
            instructions: item.instructions,
            duration: item.duration,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: 'PRESCRIPTION_ISSUED',
        aggregateType: 'Prescription',
        aggregateId: created.id,
        payload: {
          prescriptionId: created.id,
          consultationId,
          patientId: consultation.patientId,
          doctorId: consultation.doctorId,
          itemCount: items.length,
        },
      },
    });

    return created;
  });

  // Audit log
  await logAuditEvent({
    actorId: requestingUser.id,
    action: 'PRESCRIPTION_CREATED',
    resourceType: 'Prescription',
    resourceId: prescription.id,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { consultationId, itemCount: items.length },
  });

  return prescription;
};

export const getPrescriptionByConsultationId = async (consultationId, requestingUser) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: { doctor: true },
  });

  if (!consultation) {
    throw new AppError('Consultation not found', 404, 'CONSULTATION_NOT_FOUND');
  }

  const isPatient = consultation.patientId === requestingUser.id;
  const isDoctor = consultation.doctor.userId === requestingUser.id;
  const isAdmin = requestingUser.role === 'ADMIN';

  if (!isPatient && !isDoctor && !isAdmin) {
    throw new AppError('Forbidden: You do not have permission to view this prescription', 403, 'FORBIDDEN');
  }

  const prescription = await prisma.prescription.findUnique({
    where: { consultationId },
    include: {
      items: true,
      doctor: {
        include: {
          user: { select: { profile: { select: { name: true } } } },
        },
      },
    },
  });

  if (!prescription) {
    throw new AppError('No prescription has been issued for this consultation', 404, 'PRESCRIPTION_NOT_FOUND');
  }

  return prescription;
};
