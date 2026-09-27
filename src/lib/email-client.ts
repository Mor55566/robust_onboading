/** Server-side client. All provider delivery is owned by Robust Notifications. */
export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: { filename: string; contentType?: string; contentBase64: string }[];
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const baseUrl = process.env.NOTIFICATIONS_API_URL?.trim();
  const secret = process.env.NOTIFICATIONS_SERVICE_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new Error("Email service is not configured (NOTIFICATIONS_API_URL / NOTIFICATIONS_SERVICE_SECRET)");
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("Email service URL must use HTTPS (except localhost)");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/email/send`;
  const body = JSON.stringify(message);
  // Leave headroom below the hosting platform's 4.5 MB request limit.
  if (Buffer.byteLength(body) > 4_000_000) {
    throw new Error("Email attachments are too large (maximum request size: 4 MB)");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Notifications-Service-Secret": secret },
    body,
    signal: AbortSignal.timeout(25_000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Email service rejected the message (HTTP ${response.status})`);
  }
  const result = await response.json() as { success?: boolean };
  if (result.success !== true) throw new Error("Email service did not confirm delivery acceptance");
}
