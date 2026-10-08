import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import * as aiService from './service.js';
import type { InteractionSummaryQuery, ListInteractionsQuery } from './validation.js';

export async function listInteractions(req: Request, res: Response) {
  const query = req.query as unknown as ListInteractionsQuery;
  const { items, meta } = await aiService.listInteractions(query, parsePagination(query));
  return sendSuccess(res, { data: items, meta });
}

export async function interactionSummary(req: Request, res: Response) {
  const data = await aiService.interactionSummary(req.query as unknown as InteractionSummaryQuery);
  return sendSuccess(res, { data });
}

export async function aiConfig(_req: Request, res: Response) {
  return sendSuccess(res, { data: await aiService.aiConfig() });
}
