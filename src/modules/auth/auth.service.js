import { prisma } from '../../database/prisma.js';
import { hashPassword, comparePassword, generateToken } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAuditEvent } from '../../middleware/audit.js';

export const registerUser = async (data, reqMeta = {}) => {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });

  if (existingUser) {
    throw new AppError('An account with this email already exists', 409, 'USER_ALREADY_EXISTS');
  }

  if (data.role === 'DOCTOR' && data.licenseNumber) {
    const existingDoctor = await prisma.doctor.findUnique({
      where: { licenseNumber: data.licenseNumber },
    });
    if (existingDoctor) {
      throw new AppError('A doctor with this license number already exists', 409, 'LICENSE_ALREADY_REGISTERED');
    }
  }

  const hashedPassword = await hashPassword(data.password);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash: hashedPassword,
        role: data.role,
        profile: {
          create: {
            name: data.name,
            phone: data.phone,
          },
        },
        ...(data.role === 'DOCTOR' && {
          doctor: {
            create: {
              specialization: data.specialization,
              licenseNumber: data.licenseNumber,
              consultationFee: data.consultationFee || 50000,
              currency: 'INR',
              bio: data.bio,
              experienceYears: data.experienceYears || 0,
              verificationStatus: 'PENDING',
            },
          },
        }),
      },
      include: {
        profile: true,
        doctor: true,
      },
    });

    return user;
  });

  // Audit log
  await logAuditEvent({
    actorId: result.id,
    action: 'USER_REGISTERED',
    resourceType: 'User',
    resourceId: result.id,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { email: result.email, role: result.role },
  });

  const token = generateToken({
    id: result.id,
    email: result.email,
    role: result.role,
  });

  return {
    user: {
      id: result.id,
      email: result.email,
      role: result.role,
      status: result.status,
      profile: result.profile,
      doctor: result.doctor,
      createdAt: result.createdAt,
    },
    token,
  };
};

export const loginUser = async ({ email, password }, reqMeta = {}) => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: {
      profile: true,
      doctor: true,
    },
  });

  if (!user) {
    await logAuditEvent({
      action: 'USER_LOGIN_FAILED',
      resourceType: 'User',
      outcome: 'FAILURE',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      details: { email, reason: 'USER_NOT_FOUND' },
    });
    throw new AppError('Invalid email or password credentials', 401, 'INVALID_CREDENTIALS');
  }

  if (user.status !== 'ACTIVE') {
    throw new AppError(`Account is ${user.status.toLowerCase()}. Please contact support.`, 403, 'ACCOUNT_INACTIVE');
  }

  const isMatch = await comparePassword(password, user.passwordHash);
  if (!isMatch) {
    await logAuditEvent({
      actorId: user.id,
      action: 'USER_LOGIN_FAILED',
      resourceType: 'User',
      resourceId: user.id,
      outcome: 'FAILURE',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      details: { email, reason: 'INVALID_PASSWORD' },
    });
    throw new AppError('Invalid email or password credentials', 401, 'INVALID_CREDENTIALS');
  }

  await logAuditEvent({
    actorId: user.id,
    action: 'USER_LOGIN_SUCCESS',
    resourceType: 'User',
    resourceId: user.id,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
  });

  const token = generateToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      profile: user.profile,
      doctor: user.doctor,
    },
    token,
  };
};

export const getCurrentUserProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      profile: true,
      doctor: true,
    },
  });

  if (!user) {
    throw new AppError('User profile not found', 404, 'USER_NOT_FOUND');
  }

  return user;
};
