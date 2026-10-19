import { prisma } from '../../database/prisma.js';
import { AppError } from '../../middleware/error-handler.js';

export const listDoctors = async ({
  specialization,
  minFee,
  maxFee,
  search,
  verificationStatus,
  page = 1,
  limit = 20,
}) => {
  const skip = (page - 1) * limit;

  const where = {
    ...(verificationStatus && { verificationStatus }),
    ...(specialization && {
      specialization: { contains: specialization, mode: 'insensitive' },
    }),
    ...(minFee || maxFee
      ? {
          consultationFee: {
            ...(minFee && { gte: minFee }),
            ...(maxFee && { lte: maxFee }),
          },
        }
      : {}),
    ...(search && {
      OR: [
        { specialization: { contains: search, mode: 'insensitive' } },
        { bio: { contains: search, mode: 'insensitive' } },
        { user: { profile: { name: { contains: search, mode: 'insensitive' } } } },
      ],
    }),
  };

  const [total, doctors] = await Promise.all([
    prisma.doctor.count({ where }),
    prisma.doctor.findMany({
      where,
      skip,
      take: limit,
      include: {
        user: {
          select: {
            email: true,
            profile: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    doctors,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getDoctorById = async (doctorId) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: {
        select: {
          email: true,
          profile: true,
        },
      },
      slots: {
        where: {
          status: 'AVAILABLE',
          startAt: { gte: new Date() },
        },
        orderBy: { startAt: 'asc' },
        take: 20,
      },
    },
  });

  if (!doctor) {
    throw new AppError('Doctor not found', 404, 'DOCTOR_NOT_FOUND');
  }

  return doctor;
};

export const updateDoctorProfile = async (userId, updateData) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new AppError('Doctor profile not found for this user', 404, 'DOCTOR_NOT_FOUND');
  }

  const updatedDoctor = await prisma.doctor.update({
    where: { id: doctor.id },
    data: updateData,
    include: {
      user: {
        select: {
          email: true,
          profile: true,
        },
      },
    },
  });

  return updatedDoctor;
};

export const createDoctorSlot = async (doctorId, { startAt, endAt }, requestingUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
  });

  if (!doctor) {
    throw new AppError('Doctor not found', 404, 'DOCTOR_NOT_FOUND');
  }

  // Authorization: Only the doctor themselves or an ADMIN can add availability slots
  if (doctor.userId !== requestingUser.id && requestingUser.role !== 'ADMIN') {
    throw new AppError('Forbidden: You can only create slots for your own profile', 403, 'FORBIDDEN');
  }

  const startDate = new Date(startAt);
  const endDate = new Date(endAt);

  // Check for overlapping slots for this doctor
  const overlapping = await prisma.availabilitySlot.findFirst({
    where: {
      doctorId,
      status: { not: 'CANCELLED' },
      OR: [
        {
          startAt: { lt: endDate },
          endAt: { gt: startDate },
        },
      ],
    },
  });

  if (overlapping) {
    throw new AppError('An availability slot already overlaps with this time window', 409, 'SLOT_OVERLAP');
  }

  const slot = await prisma.availabilitySlot.create({
    data: {
      doctorId,
      startAt: startDate,
      endAt: endDate,
      status: 'AVAILABLE',
    },
  });

  return slot;
};

export const listDoctorSlots = async (doctorId, { status, startDate, endDate }) => {
  const where = {
    doctorId,
    ...(status && { status }),
    ...(startDate || endDate
      ? {
          startAt: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  };

  const slots = await prisma.availabilitySlot.findMany({
    where,
    orderBy: { startAt: 'asc' },
  });

  return slots;
};

export const deleteDoctorSlot = async (doctorId, slotId, requestingUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
  });

  if (!doctor) {
    throw new AppError('Doctor not found', 404, 'DOCTOR_NOT_FOUND');
  }

  if (doctor.userId !== requestingUser.id && requestingUser.role !== 'ADMIN') {
    throw new AppError('Forbidden: You can only delete your own slots', 403, 'FORBIDDEN');
  }

  const slot = await prisma.availabilitySlot.findUnique({
    where: { id: slotId },
  });

  if (!slot || slot.doctorId !== doctorId) {
    throw new AppError('Availability slot not found', 404, 'SLOT_NOT_FOUND');
  }

  if (slot.status === 'BOOKED' || slot.status === 'RESERVED') {
    throw new AppError('Cannot delete a slot that is already booked or reserved', 409, 'SLOT_IN_USE');
  }

  await prisma.availabilitySlot.delete({
    where: { id: slotId },
  });

  return { message: 'Slot deleted successfully' };
};
