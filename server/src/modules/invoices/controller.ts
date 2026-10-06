import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { sendPdf } from '../../utils/sendFile.js';
import * as invoicesService from './service.js';
import type { ListInvoicesQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const params = (req: Request) => req.params as { id: string };

export async function listInvoices(req: Request, res: Response) {
  const query = req.query as unknown as ListInvoicesQuery;
  const { items, meta } = await invoicesService.listInvoices(
    currentUser(req),
    query,
    parsePagination(query),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getInvoice(req: Request, res: Response) {
  const data = await invoicesService.getInvoice(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function createInvoice(req: Request, res: Response) {
  const data = await invoicesService.createInvoice(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Draft invoice created', data });
}

export async function updateInvoice(req: Request, res: Response) {
  const data = await invoicesService.updateInvoice(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Invoice saved', data });
}

export async function issueInvoice(req: Request, res: Response) {
  const data = await invoicesService.issueInvoice(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: `Invoice ${data.invoiceNumber} issued`, data });
}

export async function voidInvoice(req: Request, res: Response) {
  const data = await invoicesService.voidInvoice(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Invoice voided', data });
}

export async function invoicePdf(req: Request, res: Response) {
  const { buffer, fileName } = await invoicesService.invoicePdf(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  sendPdf(res, buffer, fileName, { download: (req.query as { download?: boolean }).download });
}
