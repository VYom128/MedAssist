import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { toSuggestion } from './serializer.js';
import { searchFormulary } from './service.js';
import type { SearchFormularyQuery } from './validation.js';

export async function search(req: Request, res: Response) {
  const { q, limit } = req.query as unknown as SearchFormularyQuery;
  return sendSuccess(res, { data: searchFormulary(q, limit).map(toSuggestion) });
}
