import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { sendFile } from '../../utils/sendFile.js';
import * as revisionService from './revision.service.js';
import * as labOrdersService from './service.js';
import * as workflowService from './workflow.service.js';
import type { ListLabOrdersQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const params = (req: Request) => req.params as { id: string; itemId?: string };

export async function listLabOrders(req: Request, res: Response) {
  const query = req.query as unknown as ListLabOrdersQuery;
  const { items, meta } = await labOrdersService.listLabOrders(
    currentUser(req),
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.getLabOrder(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function createLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.createLabOrder(
    currentUser(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    statusCode: 201,
    message:
      data.status === 'draft'
        ? 'Lab order saved – it is sent when you sign the note'
        : 'Lab order placed',
    data,
  });
}

export async function updateLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.updateDraftOrder(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab order updated', data });
}

export async function discardLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.discardDraftOrder(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Draft lab order discarded', data });
}

export async function cancelLabOrder(req: Request, res: Response) {
  const data = await labOrdersService.cancelLabOrder(
    currentUser(req),
    params(req).id,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Lab order cancelled', data });
}

export async function cancelLabOrderItem(req: Request, res: Response) {
  const { id, itemId } = params(req);
  const data = await labOrdersService.cancelLabOrderItem(
    currentUser(req),
    id,
    itemId!,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Test cancelled', data });
}

// ---- Lab workflow (step 2) ---------------------------------------------------------------------

type OrderAction = (
  user: NonNullable<Request['user']>,
  id: string,
  meta: ReturnType<typeof buildRequestMeta>,
) => Promise<unknown>;
type OrderBodyAction = (
  user: NonNullable<Request['user']>,
  id: string,
  body: never,
  meta: ReturnType<typeof buildRequestMeta>,
) => Promise<unknown>;

const orderAction = (run: OrderAction, message: string) => async (req: Request, res: Response) => {
  const data = await run(currentUser(req), params(req).id, buildRequestMeta(req));
  return sendSuccess(res, { message, data });
};
const orderBodyAction =
  (run: OrderBodyAction, message: string) => async (req: Request, res: Response) => {
    const data = await run(
      currentUser(req),
      params(req).id,
      req.body as never,
      buildRequestMeta(req),
    );
    return sendSuccess(res, { message, data });
  };

export const collectSample = orderAction(workflowService.collectSample, 'Sample collected');
export const rejectSample = orderBodyAction(workflowService.rejectSample, 'Sample rejected');
export const recollectSample = orderAction(
  workflowService.recollectSample,
  'Ready for a new sample',
);
export const startProcessing = orderAction(workflowService.startProcessing, 'Processing started');
export const verifyOrder = orderAction(workflowService.verifyOrder, 'Results verified');
export const sendBack = orderBodyAction(workflowService.sendBack, 'Sent back for correction');
export const releaseOrder = orderAction(workflowService.releaseOrder, 'Results released');
export const acknowledgeResults = orderAction(
  workflowService.acknowledgeResults,
  'Results marked as reviewed',
);

export async function putItemResults(req: Request, res: Response) {
  const { id, itemId } = params(req);
  const data = await workflowService.saveItemResults(
    currentUser(req),
    id,
    itemId!,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Results saved', data });
}

export async function reviseItem(req: Request, res: Response) {
  const { id, itemId } = params(req);
  const data = await revisionService.reviseItem(
    currentUser(req),
    id,
    itemId!,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Revision saved', data });
}

export async function verifyRevision(req: Request, res: Response) {
  const { id, itemId } = params(req);
  const data = await revisionService.verifyRevision(
    currentUser(req),
    id,
    itemId!,
    buildRequestMeta(req),
  );
  return sendSuccess(res, {
    message: 'Revision verified – the corrected results are released',
    data,
  });
}

export async function downloadReport(req: Request, res: Response) {
  const file = await labOrdersService.openReport(
    currentUser(req),
    params(req).id,
    buildRequestMeta(req),
  );
  sendFile(res, file);
}
