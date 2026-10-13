import type { Request, Response } from 'express';
import type { ReportType } from '../../config/constants.js';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { streamCsv } from './csv.js';
import * as reportsService from './service.js';
import type { ReportQuery } from './validation.js';

/** GET /reports/<type> – JSON for the screen, or a streamed CSV with `format=csv`. */
export const report = (type: ReportType) => async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const query = req.query as unknown as ReportQuery;
  const built = await reportsService.buildReport(type, query);
  if (query.format === 'csv') {
    await reportsService.auditExport(
      req.user,
      type,
      query,
      built.groupBy,
      built.rows.length,
      buildRequestMeta(req),
    );
    await streamCsv(
      res,
      reportsService.reportFileName(type, query.from, query.to),
      built.columns,
      built.rows,
      { timezone: built.meta.timezone, totals: built.totals },
    );
    return;
  }
  return sendSuccess(res, {
    data: { rows: built.rows, totals: built.totals },
    meta: built.meta,
  });
};
