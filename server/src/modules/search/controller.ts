import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import * as searchService from './service.js';
import type { SearchQuery } from './validation.js';

export async function search(req: Request, res: Response) {
  if (!req.user) throw ApiError.unauthorized();
  const { q } = req.query as unknown as SearchQuery;
  return sendSuccess(res, { data: await searchService.search(req.user, q) });
}
