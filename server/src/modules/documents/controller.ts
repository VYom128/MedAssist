import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError.js';
import { sendSuccess } from '../../utils/ApiResponse.js';
import { parsePagination } from '../../utils/pagination.js';
import { buildRequestMeta } from '../../utils/requestContext.js';
import { sendFile } from '../../utils/sendFile.js';
import * as documentsService from './service.js';
import type { ListDocumentsQuery } from './validation.js';

const currentUser = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};
const idOf = (req: Request) => (req.params as { id: string }).id;

export async function uploadDocument(req: Request, res: Response) {
  const data = await documentsService.uploadDocument(
    currentUser(req),
    req.file,
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { statusCode: 201, message: 'Document uploaded', data });
}

export async function listDocuments(req: Request, res: Response) {
  const query = req.query as unknown as ListDocumentsQuery;
  const { items, meta } = await documentsService.listDocuments(
    currentUser(req),
    query,
    parsePagination(query),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data: items, meta });
}

export async function getDocument(req: Request, res: Response) {
  const data = await documentsService.getDocument(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  return sendSuccess(res, { data });
}

export async function downloadDocument(req: Request, res: Response) {
  const file = await documentsService.openDocument(
    currentUser(req),
    idOf(req),
    buildRequestMeta(req),
  );
  sendFile(res, file);
}

export async function deleteDocument(req: Request, res: Response) {
  const data = await documentsService.deleteDocument(
    currentUser(req),
    idOf(req),
    req.body,
    buildRequestMeta(req),
  );
  return sendSuccess(res, { message: 'Document deleted', data });
}
