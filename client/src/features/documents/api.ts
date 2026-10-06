import { apiSlice } from '../../app/apiSlice';
import { useAppDispatch } from '../../app/hooks';
import type { DocumentCategory, DocumentLinkType } from '../../constants/catalog';
import { useUpload } from '../../hooks/useFileTransfer';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

/** Server shapes from server/src/modules/documents (spec §6.23, §7.16). */
export interface ClinicDocument {
  id: string;
  patientId: string;
  category: DocumentCategory;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  visibleToPatient: boolean;
  isGenerated: boolean;
  uploadedAt: string | null;
  canDelete: boolean;
  /** Not in the admin (metadata-only) view. */
  title?: string;
  originalName?: string;
  checksumSha256?: string;
  linked?: { type: DocumentLinkType; id: string | null } | null;
  uploadedBy?: { id: string; name: string | null } | null;
  uploadedByRole?: string | null;
}

export interface DocumentListParams {
  patient?: string;
  category?: DocumentCategory;
  linkedType?: DocumentLinkType;
  linkedId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface DocumentUploadInput {
  file: File;
  patientId: string;
  category: DocumentCategory;
  title: string;
  linkedType?: DocumentLinkType;
  linkedId?: string;
  visibleToPatient?: boolean;
}

const LIST = { type: 'Document' as const, id: 'LIST' };

/** Documents (spec §7.16). Uploads and downloads go through hooks, not the cache. */
export const documentsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listDocuments: build.query<Paged<ClinicDocument>, DocumentListParams>({
      query: (params) => ({ url: '/documents', params }),
      transformResponse: (res: ApiSuccess<ClinicDocument[]>) => toPaged(res),
      providesTags: (result) => [
        LIST,
        ...(result?.items.map((d) => ({ type: 'Document' as const, id: d.id })) ?? []),
      ],
    }),
    getDocument: build.query<ClinicDocument, string>({
      query: (id) => ({ url: `/documents/${id}` }),
      transformResponse: (res: ApiSuccess<ClinicDocument>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'Document', id }],
    }),
    deleteDocument: build.mutation<{ id: string; isDeleted: true }, { id: string; reason: string }>(
      {
        query: ({ id, reason }) => ({
          url: `/documents/${id}/delete`,
          method: 'POST',
          data: { reason },
        }),
        transformResponse: (res: ApiSuccess<{ id: string; isDeleted: true }>) => res.data,
        invalidatesTags: (_r, _e, { id }) => [LIST, { type: 'Document', id }],
      },
    ),
  }),
});

export const { useListDocumentsQuery, useGetDocumentQuery, useDeleteDocumentMutation } =
  documentsApi;

export const downloadUrl = (id: string) => `/documents/${id}/download`;

/** Uploads a document with progress; refreshes document lists afterwards. */
export function useUploadDocument() {
  const dispatch = useAppDispatch();
  const { upload, progress } = useUpload<ClinicDocument>();
  const uploadDocument = async (input: DocumentUploadInput) => {
    const form = new FormData();
    form.append('patientId', input.patientId);
    form.append('category', input.category);
    form.append('title', input.title);
    if (input.linkedType && input.linkedId) {
      form.append('linkedType', input.linkedType);
      form.append('linkedId', input.linkedId);
    }
    if (input.visibleToPatient !== undefined) {
      form.append('visibleToPatient', String(input.visibleToPatient));
    }
    form.append('file', input.file, input.file.name);
    const created = await upload('/documents', form);
    dispatch(documentsApi.util.invalidateTags([LIST]));
    return created;
  };
  return { uploadDocument, progress };
}
