import { apiSlice } from '../../app/apiSlice';
import type {
  LabSampleType,
  LabTestCategory,
  LabValueType,
  RangeGender,
} from '../../constants/catalog';
import { toPaged, type ApiSuccess, type Paged } from '../../utils/http';

export interface ReferenceRange {
  gender: RangeGender;
  ageMinYears?: number;
  ageMaxYears?: number;
  low?: number;
  high?: number;
  criticalLow?: number;
  criticalHigh?: number;
  text?: string;
}

export interface LabParameter {
  key: string;
  name: string;
  unit: string | null;
  valueType: LabValueType;
  options: string[];
  ranges: ReferenceRange[];
}

/** Staff/admin view of a catalogue entry (spec §6.19). Price in paise. */
export interface LabTest {
  id: string;
  code: string;
  name: string;
  category: LabTestCategory;
  sampleType: LabSampleType;
  pricePaise: number;
  preparation: string | null;
  turnaroundHours: number | null;
  parameters: LabParameter[];
  isActive?: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LabTestListParams {
  page?: number;
  limit?: number;
  q?: string;
  category?: LabTestCategory;
  includeInactive?: boolean;
}

export interface LabTestInput {
  code: string;
  name: string;
  category: LabTestCategory;
  sampleType: LabSampleType;
  pricePaise: number;
  turnaroundHours: number | null;
  preparation: string;
  parameters: {
    key: string;
    name: string;
    unit?: string;
    valueType: LabValueType;
    options?: string[];
    ranges?: ReferenceRange[];
  }[];
}

const listTag = { type: 'LabTest' as const, id: 'LIST' };

/** Lab test catalogue (spec §7.14). */
export const labTestsApi = apiSlice.injectEndpoints({
  endpoints: (build) => ({
    listLabTests: build.query<Paged<LabTest>, LabTestListParams>({
      query: (params) => ({ url: '/lab-tests', params }),
      transformResponse: (res: ApiSuccess<LabTest[]>) => toPaged(res),
      providesTags: (result) => [
        listTag,
        ...(result?.items.map((t) => ({ type: 'LabTest' as const, id: t.id })) ?? []),
      ],
    }),
    getLabTest: build.query<LabTest, string>({
      query: (id) => ({ url: `/lab-tests/${id}` }),
      transformResponse: (res: ApiSuccess<LabTest>) => res.data,
      providesTags: (_r, _e, id) => [{ type: 'LabTest', id }],
    }),
    createLabTest: build.mutation<LabTest, LabTestInput>({
      query: (body) => ({ url: '/lab-tests', method: 'POST', data: body }),
      transformResponse: (res: ApiSuccess<LabTest>) => res.data,
      invalidatesTags: [listTag, 'AuditLog'],
    }),
    updateLabTest: build.mutation<LabTest, { id: string; body: Partial<LabTestInput> }>({
      query: ({ id, body }) => ({ url: `/lab-tests/${id}`, method: 'PATCH', data: body }),
      transformResponse: (res: ApiSuccess<LabTest>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'LabTest', id }, 'AuditLog'],
    }),
    labTestAction: build.mutation<LabTest, { id: string; action: 'activate' | 'deactivate' }>({
      query: ({ id, action }) => ({ url: `/lab-tests/${id}/${action}`, method: 'POST' }),
      transformResponse: (res: ApiSuccess<LabTest>) => res.data,
      invalidatesTags: (_r, _e, { id }) => [listTag, { type: 'LabTest', id }, 'AuditLog'],
    }),
  }),
});

export const {
  useListLabTestsQuery,
  useGetLabTestQuery,
  useCreateLabTestMutation,
  useUpdateLabTestMutation,
  useLabTestActionMutation,
} = labTestsApi;
