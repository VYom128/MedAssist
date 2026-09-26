import type { BaseQueryApi } from '@reduxjs/toolkit/query';
import { useState } from 'react';
import { useStore } from 'react-redux';
import { axiosBaseQuery, type DownloadedFile } from '../app/axiosBaseQuery';
import type { ApiQueryError } from '../utils/http';

/**
 * File transfers go through the same base query as everything else (Bearer token, one refresh
 * on 401) but never through the RTK Query cache: files and blobs are not kept in the store
 * (spec §13.2 – no clinical data in browser storage; object URLs are revoked right away).
 */

type Api = Pick<BaseQueryApi, 'getState' | 'dispatch'>;

function useBaseQueryApi(): Api {
  const store = useStore();
  return { getState: store.getState, dispatch: store.dispatch };
}

/** Hands a blob to the browser as a download (no-op where object URLs are missing, e.g. tests). */
export function saveBlob(blob: Blob, fileName: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Fetches a protected file (`url` below /api/v1) as a blob. */
export async function fetchFile(api: Api, url: string): Promise<DownloadedFile> {
  const res = await axiosBaseQuery({ url, responseType: 'blob' }, api as BaseQueryApi, {});
  if (res.error) throw res.error;
  return res.data as DownloadedFile;
}

/** `download(url, fallbackName)` saves a protected file; `busy` while it loads. */
export function useDownload() {
  const api = useBaseQueryApi();
  const [busy, setBusy] = useState(false);
  const download = async (url: string, fallbackName: string) => {
    setBusy(true);
    try {
      const { blob, fileName } = await fetchFile(api, url);
      saveBlob(blob, fileName ?? fallbackName);
    } finally {
      setBusy(false);
    }
  };
  return { download, busy };
}

/** Sends `form` (multipart) to `url`, reporting progress 0…1. Rejects with an ApiQueryError. */
export function useUpload<T>() {
  const api = useBaseQueryApi();
  const [progress, setProgress] = useState<number | null>(null);
  const upload = async (url: string, form: FormData): Promise<T> => {
    setProgress(0);
    try {
      const res = await axiosBaseQuery(
        {
          url,
          method: 'POST',
          data: form,
          // Let the browser set the multipart boundary.
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: setProgress,
        },
        api as BaseQueryApi,
        {},
      );
      if (res.error) throw res.error as ApiQueryError;
      return (res.data as { data: T }).data;
    } finally {
      setProgress(null);
    }
  };
  return { upload, progress };
}
