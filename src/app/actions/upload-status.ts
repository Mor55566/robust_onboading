"use server";

import { requireSuperAdmin } from "@/lib/auth";
import { getUploadStatus } from "@/lib/upload-status";
import { emptyUploadStatus, type UploadStatus } from "@/lib/upload-status-keys";

export async function getUploadStatusAction(
  complexId: string,
): Promise<UploadStatus> {
  await requireSuperAdmin();
  if (!complexId) return emptyUploadStatus();
  return getUploadStatus(complexId);
}
