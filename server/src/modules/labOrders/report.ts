import type { ClientSession, Types } from 'mongoose';

/**
 * The lab report PDF made on release and on every applied revision (spec §4.8, §12.3).
 * The PDF is built BEFORE the release transaction; `save()` stores its Document inside the
 * transaction and returns its id; `discard()` logs the orphaned file if the transaction fails.
 */
export interface PreparedReport {
  save(session: ClientSession): Promise<Types.ObjectId>;
  discard(): Promise<void>;
}

/**
 * TODO(Phase 6 step 3): build the PDF with pdf.service and store it through the storage
 * adapter. Until then releases have no report document (`reportAvailable: false`).
 */
export async function prepareReleaseReport(
  _orderId: Types.ObjectId,
  _kind: 'release' | 'revision',
): Promise<PreparedReport | null> {
  return null;
}
