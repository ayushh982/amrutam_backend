import { initiatePaymentSchema, webhookPayloadSchema } from './payments.validation.js';
import * as paymentsService from './payments.service.js';

export const initiatePayment = async (req, res, next) => {
  try {
    const validatedData = initiatePaymentSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];

    const result = await paymentsService.initiatePayment(
      validatedData,
      req.user,
      idempotencyKey,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment initiated successfully',
    });
  } catch (error) {
    next(error);
  }
};

export const handleWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const validatedPayload = webhookPayloadSchema.parse(req.body);

    const result = await paymentsService.processWebhook(
      rawBody,
      signature,
      validatedPayload,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
