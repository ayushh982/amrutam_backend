import { prisma } from '../../database/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAuditEvent } from '../../middleware/audit.js';

export const getSystemAnalytics = async () => {
  const [
    totalUsers,
    usersByRole,
    totalConsultations,
    consultationsByStatus,
    totalDoctors,
    doctorsByStatus,
    revenueData,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
    }),
    prisma.consultation.count(),
    prisma.consultation.groupBy({
      by: ['status'],
      _count: { id: true },
    }),
    prisma.doctor.count(),
    prisma.doctor.groupBy({
      by: ['verificationStatus'],
      _count: { id: true },
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const statusMap = consultationsByStatus.reduce((acc, curr) => {
    acc[curr.status] = curr._count.id;
    return acc;
  }, {});

  const totalCancelled = statusMap.CANCELLED || 0;
  const cancellationRate =
    totalConsultations > 0 ? ((totalCancelled / totalConsultations) * 100).toFixed(2) : 0;

  return {
    users: {
      total: totalUsers,
      breakdown: usersByRole.reduce((acc, curr) => {
        acc[curr.role] = curr._count.id;
        return acc;
      }, {}),
    },
    doctors: {
      total: totalDoctors,
      breakdown: doctorsByStatus.reduce((acc, curr) => {
        acc[curr.verificationStatus] = curr._count.id;
        return acc;
      }, {}),
    },
    consultations: {
      total: totalConsultations,
      breakdown: statusMap,
      cancellationRatePercentage: parseFloat(cancellationRate),
    },
    revenue: {
      currency: 'INR',
      totalCollectedMinorUnits: revenueData._sum.amount || 0,
      totalCollectedMajorUnits: ((revenueData._sum.amount || 0) / 100).toFixed(2),
      successfulTransactionsCount: revenueData._count.id || 0,
    },
  };
};

export const listAuditLogs = async ({
  actorId,
  action,
  resourceType,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}) => {
  const skip = (page - 1) * limit;

  const where = {
    ...(actorId && { actorId }),
    ...(action && { action: { contains: action, mode: 'insensitive' } }),
    ...(resourceType && { resourceType }),
    ...(startDate || endDate
      ? {
          timestamp: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}),
  };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { timestamp: 'desc' },
    }),
  ]);

  return {
    logs,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const verifyDoctor = async (doctorId, { status, reason }, requestingAdmin, reqMeta = {}) => {
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { user: true },
  });

  if (!doctor) {
    throw new AppError('Doctor not found', 404, 'DOCTOR_NOT_FOUND');
  }

  const updatedDoctor = await prisma.doctor.update({
    where: { id: doctorId },
    data: { verificationStatus: status },
    include: {
      user: {
        select: {
          email: true,
          profile: true,
        },
      },
    },
  });

  await logAuditEvent({
    actorId: requestingAdmin.id,
    action: `DOCTOR_VERIFICATION_${status}`,
    resourceType: 'Doctor',
    resourceId: doctorId,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { doctorId, status, reason },
  });

  return updatedDoctor;
};
