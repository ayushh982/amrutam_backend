import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../middleware/error-handler.js';
import { logAuditEvent } from '../../middleware/audit.js';
import { env } from '../../config/env.js';
import { logger } from '../../observability/logger.js';

export const verifyWebhookSignature = (payloadString, signature) => {
  if (!signature || typeof signature !== 'string') return false;
  const expectedSignature = crypto
    .createHmac('sha256', env.PAYMENT_WEBHOOK_SECRET)
    .update(payloadString)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
};

export const initiatePayment = async (
  { consultationId, amount, currency = 'INR' },
  requestingUser,
  idempotencyKey,
  reqMeta = {}
) => {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      doctor: true,
      payments: true,
    },
  });

  if (!consultation) {
    throw new AppError('Consultation not found', 404, 'CONSULTATION_NOT_FOUND');
  }

  // Authorization: only the patient or admin can initiate payment
  if (consultation.patientId !== requestingUser.id && requestingUser.role !== 'ADMIN') {
    throw new AppError('Forbidden: You can only pay for your own consultations', 403, 'FORBIDDEN');
  }

  // Check if consultation is already paid
  const completedPayment = consultation.payments.find((p) => p.status === 'COMPLETED');
  if (completedPayment) {
    throw new AppError('This consultation has already been paid for.', 400, 'PAYMENT_ALREADY_COMPLETED');
  }

  // Generate mock provider payment reference
  const providerReference = `mock_pay_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

  const payment = await prisma.$transaction(async (tx) => {
    const newPayment = await tx.payment.create({
      data: {
        consultationId,
        amount,
        currency,
        status: 'PENDING',
        providerReference,
        idempotencyKey: idempotencyKey || null,
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: 'PAYMENT_INITIATED',
        aggregateType: 'Payment',
        aggregateId: newPayment.id,
        payload: {
          paymentId: newPayment.id,
          consultationId,
          amount,
          currency,
          providerReference,
        },
      },
    });

    return newPayment;
  });

  await logAuditEvent({
    actorId: requestingUser.id,
    action: 'PAYMENT_INITIATED',
    resourceType: 'Payment',
    resourceId: payment.id,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { consultationId, amount, currency, providerReference },
  });

  return {
    payment,
    checkoutUrl: `https://checkout.mock-pay.example.com/pay/${providerReference}`,
  };
};

export const processWebhook = async (rawBodyString, signature, parsedPayload, reqMeta = {}) => {
  // 1. Verify HMAC Signature
  const isValid = verifyWebhookSignature(rawBodyString, signature);
  if (!isValid) {
    await logAuditEvent({
      action: 'PAYMENT_WEBHOOK_VERIFICATION_FAILED',
      resourceType: 'WebhookEvent',
      outcome: 'FAILURE',
      ipAddress: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      details: { eventId: parsedPayload.eventId },
    });
    throw new AppError('Invalid webhook HMAC signature', 401, 'INVALID_WEBHOOK_SIGNATURE');
  }

  // 2. Duplicate Webhook Protection: Check webhook_events table
  const existingEvent = await prisma.webhookEvent.findUnique({
    where: { eventId: parsedPayload.eventId },
  });

  if (existingEvent) {
    logger.info({ eventId: parsedPayload.eventId }, 'Duplicate webhook event received; ignoring.');
    return {
      received: true,
      duplicate: true,
      status: existingEvent.status,
    };
  }

  // 3. Process Event Atomically
  const result = await prisma.$transaction(async (tx) => {
    // Record webhook event as RECEIVED
    const event = await tx.webhookEvent.create({
      data: {
        provider: parsedPayload.provider || 'mock_provider',
        eventId: parsedPayload.eventId,
        eventType: parsedPayload.eventType,
        payload: parsedPayload,
        status: 'RECEIVED',
      },
    });

    const payment = await tx.payment.findUnique({
      where: { id: parsedPayload.data.paymentId },
    });

    if (!payment) {
      throw new AppError('Payment referenced in webhook does not exist', 404, 'PAYMENT_NOT_FOUND');
    }

    let targetPaymentStatus = 'PENDING';
    if (parsedPayload.eventType === 'payment.succeeded') {
      targetPaymentStatus = 'COMPLETED';
    } else if (parsedPayload.eventType === 'payment.failed') {
      targetPaymentStatus = 'FAILED';
    }

    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: targetPaymentStatus,
        providerReference: parsedPayload.data.providerReference || payment.providerReference,
      },
    });

    // Mark webhook as PROCESSED
    await tx.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
      },
    });

    // Outbox event
    await tx.outboxEvent.create({
      data: {
        eventType: `PAYMENT_${targetPaymentStatus}`,
        aggregateType: 'Payment',
        aggregateId: payment.id,
        payload: {
          paymentId: payment.id,
          consultationId: payment.consultationId,
          status: targetPaymentStatus,
        },
      },
    });

    return { updatedPayment, eventId: event.id };
  });

  // 4. Audit Log
  await logAuditEvent({
    action: `PAYMENT_WEBHOOK_${parsedPayload.eventType}`,
    resourceType: 'Payment',
    resourceId: parsedPayload.data.paymentId,
    outcome: 'SUCCESS',
    ipAddress: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    details: { eventId: parsedPayload.eventId, eventType: parsedPayload.eventType },
  });

  return {
    received: true,
    duplicate: false,
    paymentStatus: result.updatedPayment.status,
  };
};
