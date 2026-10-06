import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { sendPdf } from '../../utils/sendFile.js';
import * as paymentsService from './service.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const params = (req: Request) => req.params as { id: string };

export async function listForInvoice(req: Request, res: Response) {
  const data = await paymentsService.listPaymentsForInvoice(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function recordPayment(req: Request, res: Response) {
  const data = await paymentsService.recordPayment(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message: `Payment ${data.payment.paymentNumber as string} recorded`,
    data,
  });
}

export async function refundPayment(req: Request, res: Response) {
  const data = await paymentsService.refundPayment(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message: `Refund ${data.refund.paymentNumber as string} recorded`,
    data,
  });
}

export async function daySummary(req: Request, res: Response) {
  currentUser(req);
  const data = await paymentsService.daySummary((req.query as { date?: string }).date);
  return sendSuccess(res, { data });
}

export async function receiptPdf(req: Request, res: Response) {
  const { buffer, fileName } = await paymentsService.receiptPdf(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  sendPdf(res, buffer, fileName, { download: (req.query as { download?: boolean }).download });
}
