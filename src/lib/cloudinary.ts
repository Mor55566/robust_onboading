import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
} from "@/lib/attachment-limits";

type UploadMode =
  | { uploadPreset: string; signed: false }
  | { uploadPreset: null; signed: true };

let configuredMode: UploadMode | null = null;

export type UploadedFile = {
  file_name: string;
  mime_type: string;
  storage_url: string;
};

export class CloudinaryConfigError extends Error {
  constructor(message = "Cloudinary is not configured") {
    super(message);
    this.name = "CloudinaryConfigError";
  }
}

export class CloudinaryUploadError extends Error {
  /** False when retrying can't help (bad source file, missing permission). */
  readonly retryable: boolean;

  constructor(message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = "CloudinaryUploadError";
    this.retryable = options?.retryable ?? true;
  }
}

function parseCloudinaryUrl(url: string) {
  // cloudinary://<api_key>:<api_secret>@<cloud_name>
  const match = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?]+)/i);
  if (!match) return null;
  return {
    api_key: match[1],
    api_secret: match[2],
    cloud_name: match[3],
  };
}

function getCredentials() {
  const cloudinaryUrl = process.env.CLOUDINARY_URL?.trim();
  const fromUrl = cloudinaryUrl ? parseCloudinaryUrl(cloudinaryUrl) : null;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || null;

  const cloudName =
    fromUrl?.cloud_name?.trim() || process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey =
    fromUrl?.api_key?.trim() || process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret =
    fromUrl?.api_secret?.trim() || process.env.CLOUDINARY_API_SECRET?.trim();

  return { cloudName, apiKey, apiSecret, uploadPreset };
}

function ensureConfigured(): UploadMode {
  if (configuredMode) return configuredMode;

  const { cloudName, apiKey, apiSecret, uploadPreset } = getCredentials();

  if (!cloudName) {
    throw new CloudinaryConfigError();
  }

  // Unsigned preset uploads only need cloud name + preset.
  if (uploadPreset) {
    cloudinary.config({
      cloud_name: cloudName,
      secure: true,
    });
    configuredMode = { uploadPreset, signed: false };
    return configuredMode;
  }

  if (!apiKey || !apiSecret) {
    throw new CloudinaryConfigError();
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  configuredMode = { uploadPreset: null, signed: true };
  return configuredMode;
}

function resourceTypeForMime(mimeType: string): "image" | "video" | "raw" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "video";
  return "raw";
}

/**
 * Cloudinary stores PDFs (and some other non-image files) under the "image"
 * resource type so it can rasterize pages/thumbnails. Re-uploading a copy
 * under a mime-guessed resource type (e.g. "raw" for application/pdf) would
 * diverge from how the source asset is actually stored. When the source URL
 * is itself a Cloudinary delivery URL, trust its resource type segment.
 */
function resourceTypeFromSourceUrl(url: string): "image" | "video" | "raw" | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/(image|video|raw)\/upload\//i);
    return match ? (match[1]!.toLowerCase() as "image" | "video" | "raw") : null;
  } catch {
    return null;
  }
}

function toUploadError(error: unknown): Error {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Cloudinary upload failed";

  if (/missing permissions|actions=\["create"\]/i.test(message)) {
    return new CloudinaryUploadError(
      "Cloudinary API key is missing upload permission. Enable Create/Upload on the key, or set CLOUDINARY_UPLOAD_PRESET to an unsigned upload preset.",
      { retryable: false },
    );
  }

  // The account's per-file size limit: the same file will never fit.
  if (/file size too large/i.test(message)) {
    return new CloudinaryUploadError(message, { retryable: false });
  }

  return new CloudinaryUploadError(message);
}

export function collectAttachmentFiles(formData: FormData): File[] {
  return formData.getAll("attachments").filter((value): value is File => {
    return typeof File !== "undefined" && value instanceof File && value.size > 0;
  });
}

export function validateAttachmentFiles(
  files: File[],
  messages: {
    tooMany: string;
    tooLarge: string;
  },
  maxFiles = MAX_ATTACHMENT_FILES,
): string | null {
  if (files.length > maxFiles) {
    return messages.tooMany;
  }

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return messages.tooLarge;
    }
  }

  return null;
}

async function uploadAttachmentFile(
  file: File,
  mode: UploadMode,
): Promise<UploadedFile> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const resourceType = resourceTypeForMime(mimeType);

  try {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "task-attachments",
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          filename_override: file.name || undefined,
          ...(mode.uploadPreset ? { upload_preset: mode.uploadPreset } : {}),
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new CloudinaryUploadError("Cloudinary upload failed"));
            return;
          }
          resolve(result);
        },
      );
      Readable.from(buffer).pipe(stream);
    });

    if (!uploaded.secure_url) {
      throw new CloudinaryUploadError("Cloudinary upload failed");
    }

    return {
      file_name: file.name || "file",
      mime_type: mimeType,
      storage_url: uploaded.secure_url,
    };
  } catch (error) {
    throw toUploadError(error);
  }
}

export async function uploadTaskAttachments(
  files: File[],
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  const mode = ensureConfigured();
  return Promise.all(files.map((file) => uploadAttachmentFile(file, mode)));
}

export async function uploadChainLogo(file: File): Promise<string> {
  const mode = ensureConfigured();
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "chain-logos",
          resource_type: "image",
          use_filename: true,
          unique_filename: true,
          filename_override: file.name || undefined,
          ...(mode.uploadPreset ? { upload_preset: mode.uploadPreset } : {}),
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new CloudinaryUploadError("Cloudinary upload failed"));
            return;
          }
          resolve(result);
        },
      );
      Readable.from(buffer).pipe(stream);
    });

    if (!uploaded.secure_url) {
      throw new CloudinaryUploadError("Cloudinary upload failed");
    }
    return uploaded.secure_url;
  } catch (error) {
    throw toUploadError(error);
  }
}

function fileNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop() || "attachment";
    return decodeURIComponent(base.split("?")[0] || base) || "attachment";
  } catch {
    return "attachment";
  }
}

function mimeFromContentType(contentType: string | null, fileName: string): string {
  const mime = contentType?.split(";")[0]?.trim().toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "image/jpeg";
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/**
 * Give a file name the extension of its real format, so a PDF that the
 * source page only showed as a ".jpg" preview is saved as "name.pdf".
 */
export function fileNameForMime(fileName: string, mimeType: string): string {
  const extension = EXTENSION_BY_MIME[mimeType.trim().toLowerCase()];
  if (!extension) return fileName;
  const current = fileName.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() ?? "";
  if (current === extension) return fileName;
  if (extension === ".jpg" && current === ".jpeg") return fileName;
  if (extension === ".tiff" && current === ".tif") return fileName;
  const base = current ? fileName.slice(0, -current.length) : fileName;
  return `${base || "file"}${extension}`;
}

/**
 * The URL of a Cloudinary image asset in its ORIGINAL format.
 *
 * Exports read attachment URLs from preview thumbnails, and Cloudinary serves
 * those as ".jpg" even when the asset is a PDF (or PNG, HEIC…): the extension
 * of a Cloudinary image URL picks the delivered format. Dropping the extension
 * (and any transformation) makes Cloudinary deliver the asset as uploaded.
 * Returns null when the URL is not a Cloudinary image delivery URL.
 */
export function originalFormatCloudinaryUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cloudinary\.com$/i.test(parsed.hostname)) return null;
    const match = parsed.pathname.match(/^(.*\/image\/upload\/)(.+)$/i);
    if (!match) return null;
    const segments = match[2]!.split("/").filter(Boolean);
    // Drop transformation segments (e.g. "c_fill,h_60,w_60") before the
    // version / public id; keep "v123" version segments and folders.
    const isTransformation = (segment: string) =>
      segment
        .split(",")
        .every((part) =>
          /^(a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_[^,]+$/i.test(part),
        );
    while (segments.length > 1 && isTransformation(segments[0]!)) {
      segments.shift();
    }
    const last = segments[segments.length - 1]!;
    const withoutExtension = last.replace(/\.[a-z0-9]+$/i, "");
    if (!withoutExtension) return null;
    segments[segments.length - 1] = withoutExtension;
    parsed.pathname = `${match[1]}${segments.join("/")}`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function ownCloudName(): string {
  const { cloudName } = getCredentials();
  return cloudName?.toLowerCase() ?? "";
}

/**
 * True when the URL is already a delivery URL in this project's Cloudinary
 * account — copying it again would only pay for a duplicate.
 */
export function isOwnCloudinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cloudinary\.com$/i.test(parsed.hostname)) return false;
    const cloud = ownCloudName();
    if (!cloud) return false;
    const path = parsed.pathname.toLowerCase();
    return path.startsWith(`/${cloud}/`) && !path.includes("/gantzi/");
  } catch {
    return false;
  }
}

/** File metadata for a URL that is used as-is instead of being re-uploaded. */
export function describeStoredUrl(url: string): UploadedFile {
  const fileName = fileNameFromUrl(url);
  return {
    file_name: fileName,
    mime_type: mimeFromContentType(null, fileName),
    storage_url: url,
  };
}

// Without these, one source URL or upload that never answers keeps the
// whole import request open forever and the UI never sees an error.
const REMOTE_DOWNLOAD_TIMEOUT_MS = 30_000;
const REMOTE_UPLOAD_TIMEOUT_MS = 90_000;

/** Stable public_id for an imported file, derived from its source URL. */
function importPublicId(
  url: string,
  fileName: string,
  resourceType: "image" | "video" | "raw",
): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 40);
  // Raw assets keep their extension in the public_id; images/videos don't.
  const extension =
    resourceType === "raw" ? (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? "") : "";
  return `import-${hash}${extension}`;
}

async function uploadAttachmentFromUrl(
  url: string,
  mode: UploadMode,
): Promise<UploadedFile> {
  let response: Response;
  let buffer: Buffer;
  // Prefer the asset in its original format (PDF stays PDF, PNG stays PNG).
  // Some accounts block delivering PDFs that way, so fall back to the URL
  // as given rather than losing the file.
  const originalUrl = originalFormatCloudinaryUrl(url);
  let downloadedUrl = url;
  if (originalUrl && originalUrl !== url) {
    try {
      const original = await fetch(originalUrl, {
        redirect: "follow",
        headers: { Accept: "*/*" },
        signal: AbortSignal.timeout(REMOTE_DOWNLOAD_TIMEOUT_MS),
      });
      if (original.ok) {
        const originalBuffer = Buffer.from(await original.arrayBuffer());
        if (originalBuffer.byteLength > 0) {
          response = original;
          buffer = originalBuffer;
          downloadedUrl = originalUrl;
        }
      }
    } catch {
      // Fall through to the URL as given.
    }
  }
  try {
    if (downloadedUrl === url) {
    response = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "image/*,*/*" },
      signal: AbortSignal.timeout(REMOTE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new CloudinaryUploadError(
        `Could not download image (${response.status}): ${url}`,
        // 4xx (other than timeout / rate limit) won't fix itself on retry.
        {
          retryable:
            response.status >= 500 ||
            response.status === 408 ||
            response.status === 429,
        },
      );
    }
    buffer = Buffer.from(await response.arrayBuffer());
    }
  } catch (error) {
    if (error instanceof CloudinaryUploadError) throw error;
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new CloudinaryUploadError(
      timedOut
        ? `Image download timed out: ${url}`
        : `Could not download image: ${url}`,
    );
  }

  const sourceFileName = fileNameFromUrl(url);
  const mimeType = mimeFromContentType(
    response!.headers.get("content-type"),
    sourceFileName,
  );
  const fileName = fileNameForMime(sourceFileName, mimeType);
  if (buffer!.byteLength === 0) {
    throw new CloudinaryUploadError(`Empty image download: ${url}`, {
      retryable: false,
    });
  }
  // Imports may include larger Visitt photos than the form upload limit.
  const maxRemoteBytes = Math.max(MAX_ATTACHMENT_BYTES, 12 * 1024 * 1024);
  if (buffer!.byteLength > maxRemoteBytes) {
    throw new CloudinaryUploadError(
      `Image exceeds ${maxRemoteBytes} bytes: ${url}`,
      { retryable: false },
    );
  }

  const resourceType =
    resourceTypeFromSourceUrl(url) ?? resourceTypeForMime(mimeType);

  try {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new CloudinaryUploadError(`Cloudinary upload timed out: ${url}`)),
        REMOTE_UPLOAD_TIMEOUT_MS,
      );
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "task-attachments",
          resource_type: resourceType,
          filename_override: fileName,
          timeout: REMOTE_UPLOAD_TIMEOUT_MS,
          ...(mode.signed
            ? {
                // Same source URL -> same asset. If an earlier import already
                // uploaded it (even one that failed before saving its DB rows),
                // Cloudinary returns the existing asset instead of storing a copy.
                // Keyed on the URL actually downloaded, so an asset copied
                // earlier as a ".jpg" preview is not reused for the original.
                public_id: importPublicId(downloadedUrl, fileName, resourceType),
                overwrite: false,
              }
            : {
                use_filename: true,
                unique_filename: true,
                upload_preset: mode.uploadPreset,
              }),
        },
        (error, result) => {
          clearTimeout(timer);
          if (error || !result) {
            reject(error ?? new CloudinaryUploadError("Cloudinary upload failed"));
            return;
          }
          resolve(result);
        },
      );
      Readable.from(buffer!).pipe(stream);
    });

    if (!uploaded.secure_url) {
      throw new CloudinaryUploadError("Cloudinary upload failed");
    }

    return {
      file_name: fileName,
      mime_type: mimeType,
      storage_url: uploaded.secure_url,
    };
  } catch (error) {
    throw toUploadError(error);
  }
}

const REMOTE_UPLOAD_ATTEMPTS = 3;

// A large import runs many downloads/uploads in parallel, so a single slow
// response or network blip is expected now and then — retry those instead of
// failing the whole import. Signed uploads use a stable public_id, so a retry
// after a partly-finished upload doesn't store a second copy.
async function uploadAttachmentFromUrlWithRetry(
  url: string,
  mode: UploadMode,
): Promise<UploadedFile> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await uploadAttachmentFromUrl(url, mode);
    } catch (error) {
      const retryable =
        !(error instanceof CloudinaryUploadError) || error.retryable;
      if (!retryable || attempt >= REMOTE_UPLOAD_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

export type SettledUpload =
  | { ok: true; file: UploadedFile }
  | { ok: false; error: unknown };

/**
 * Like uploadTaskAttachmentsFromUrls, but one failing URL doesn't stop the
 * rest: every URL gets its own result, in input order. Only a missing
 * Cloudinary config throws.
 */
export async function uploadTaskAttachmentsFromUrlsSettled(
  urls: string[],
  options?: { concurrency?: number },
): Promise<SettledUpload[]> {
  if (urls.length === 0) return [];
  const mode = ensureConfigured();
  const concurrency = Math.max(1, options?.concurrency ?? 4);
  const results: SettledUpload[] = new Array(urls.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const file = await uploadAttachmentFromUrlWithRetry(urls[index]!, mode);
        results[index] = { ok: true, file };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return results;
}

/** Download remote image URLs and re-upload them into this project's Cloudinary. */
export async function uploadTaskAttachmentsFromUrls(
  urls: string[],
  options?: { concurrency?: number },
): Promise<UploadedFile[]> {
  if (urls.length === 0) return [];
  const mode = ensureConfigured();
  const concurrency = Math.max(1, options?.concurrency ?? 4);
  const results: UploadedFile[] = new Array(urls.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      const url = urls[index]!;
      results[index] = await uploadAttachmentFromUrlWithRetry(url, mode);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );
  return results;
}

export type CloudinaryAssetRef = {
  publicId: string;
  resourceType: "image" | "video" | "raw";
};

/** Parse a Cloudinary delivery URL into destroy() arguments. */
export function parseCloudinaryUploadUrl(url: string): CloudinaryAssetRef | null {
  try {
    const { pathname } = new URL(url);
    const match = pathname.match(/\/(image|video|raw)\/upload\/(.+)$/);
    if (!match) return null;

    const resourceType = match[1] as CloudinaryAssetRef["resourceType"];
    let rest = decodeURIComponent(match[2].split("?")[0] ?? "");

    // Strip optional transformations + version: .../v1234/public_id
    const versionMatch = rest.match(/(?:^|\/)v\d+\/(.+)$/);
    if (versionMatch) {
      rest = versionMatch[1]!;
    }

    if (!rest) return null;

    // Image/video public IDs omit the file extension; raw keeps it.
    const publicId =
      resourceType === "raw" ? rest : rest.replace(/\.[^/.]+$/, "");

    return { publicId, resourceType };
  } catch {
    return null;
  }
}

function ensureDeleteConfigured() {
  const { cloudName, apiKey, apiSecret } = getCredentials();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new CloudinaryConfigError();
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

/** Delete uploaded assets from Cloudinary. Unknown/non-Cloudinary URLs are skipped. */
export async function deleteCloudinaryByUrls(urls: string[]): Promise<void> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return;

  ensureDeleteConfigured();

  await Promise.all(
    unique.map(async (url) => {
      const asset = parseCloudinaryUploadUrl(url);
      if (!asset) return;

      const result = await cloudinary.uploader.destroy(asset.publicId, {
        resource_type: asset.resourceType,
        invalidate: true,
      });

      if (
        result.result &&
        result.result !== "ok" &&
        result.result !== "not found"
      ) {
        throw new CloudinaryUploadError(
          `Cloudinary delete failed: ${String(result.result)}`,
        );
      }
    }),
  );
}
