import type { Request, Response } from 'express';
import { AUDIT_ACTIONS } from '../../config/constants.js';
import * as audit from '../../services/audit.service.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { toAuditView } from './serializer.js';
import * as auditLogService from './service.js';
import type { AuditLogQuery } from './validation.js';

export async function listAuditLogs(req: Request, res: Response) {
  const query = req.query as unknown as AuditLogQuery;
  const { items, meta } = await auditLogService.listAuditLogs(query, parsePagination(query));
  return sendSuccess(res, { data: items.map((e) => toAuditView(e)), meta });
}

export async function verifyAuditChain(req: Request, res: Response) {
  const data = await audit.verifyChain();
  await audit.record({
    action: AUDIT_ACTIONS.AUDIT_VERIFY,
    req,
    metadata: { ok: data.ok, checked: data.checked },
  });
  return sendSuccess(res, {
    message: data.ok ? 'Audit chain is intact' : 'Audit chain is broken',
    data,
  });
}
