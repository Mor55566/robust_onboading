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
  constructor(message: string) {
    super(message);
    this.name = "CloudinaryUploadError";
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
    );
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

async function uploadAttachmentFromUrl(
  url: string,
  mode: UploadMode,
): Promise<UploadedFile> {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "image/*,*/*" },
    });
  } catch {
    throw new CloudinaryUploadError(`Could not download image: ${url}`);
  }

  if (!response.ok) {
    throw new CloudinaryUploadError(
      `Could not download image (${response.status}): ${url}`,
    );
  }

  const fileName = fileNameFromUrl(url);
  const mimeType = mimeFromContentType(
    response.headers.get("content-type"),
    fileName,
  );
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new CloudinaryUploadError(`Empty image download: ${url}`);
  }
  // Imports may include larger Visitt photos than the form upload limit.
  const maxRemoteBytes = Math.max(MAX_ATTACHMENT_BYTES, 12 * 1024 * 1024);
  if (buffer.byteLength > maxRemoteBytes) {
    throw new CloudinaryUploadError(
      `Image exceeds ${maxRemoteBytes} bytes: ${url}`,
    );
  }

  const resourceType =
    resourceTypeFromSourceUrl(url) ?? resourceTypeForMime(mimeType);

  try {
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "task-attachments",
          resource_type: resourceType,
          use_filename: true,
          unique_filename: true,
          filename_override: fileName,
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
      file_name: fileName,
      mime_type: mimeType,
      storage_url: uploaded.secure_url,
    };
  } catch (error) {
    throw toUploadError(error);
  }
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
      results[index] = await uploadAttachmentFromUrl(url, mode);
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
