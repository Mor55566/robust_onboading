import nodemailer from "nodemailer";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import type { Locale } from "@/i18n/config";

function getSmtpConfig() {
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("Zoho SMTP credentials are not configured");
  }

  const port = Number(process.env.ZOHO_SMTP_PORT ?? "465");
  return {
    host: process.env.ZOHO_SMTP_HOST ?? "smtp.zoho.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  };
}

const magicLinkCopy: Record<
  Locale,
  { subject: string; text: (code: string, link: string) => string }
> = {
  he: {
    subject: "קישור הכניסה שלך ל־Robust",
    text: (code, link) =>
      `קוד הכניסה שלך ל־Robust הוא:\n\n${code}\n\nאפשר להזין את הקוד במסך ההתחברות או ללחוץ על הקישור הבא:\n${link}\n\nהקוד והקישור תקפים ל־15 דקות וניתנים לשימוש פעם אחת בלבד. אם לא ביקשת להתחבר, אפשר להתעלם מהמייל.`,
  },
  en: {
    subject: "Your Robust sign-in link",
    text: (code, link) =>
      `Your Robust sign-in code is:\n\n${code}\n\nEnter the code on the sign-in screen or use this link:\n${link}\n\nThe code and link expire in 15 minutes and can only be used once. If you did not request this, you can ignore this email.`,
  },
  ru: {
    subject: "Ваша ссылка для входа в Robust",
    text: (code, link) =>
      `Ваш код для входа в Robust:\n\n${code}\n\nВведите код на экране входа или перейдите по ссылке:\n${link}\n\nКод и ссылка действительны 15 минут и могут быть использованы только один раз. Если вы не запрашивали вход, просто проигнорируйте это письмо.`,
  },
};

// E2E tests can't read a real inbox. Playwright supplies an explicit capture
// path when it starts the server. When a developer started the dev server
// first, capture the configured E2E user's email to the same default path so
// reuseExistingServer works as well. Other recipients still use SMTP during
// local development.
function getE2ECaptureFile(email: string) {
  const e2eEmail = (process.env.PLAYWRIGHT_TEST_USER_EMAIL ?? "test_admin@robust.com").toLowerCase();
  const localE2ECaptureFile =
    process.env.NODE_ENV === "development" && email.toLowerCase() === e2eEmail
      ? resolve(process.cwd(), "e2e/.auth/magic-link-capture.ndjson")
      : undefined;
  return process.env.E2E_MAGIC_LINK_CAPTURE_FILE ?? localE2ECaptureFile;
}

function captureEmail(captureFile: string, entry: Record<string, unknown>) {
  mkdirSync(dirname(captureFile), { recursive: true });
  appendFileSync(
    captureFile,
    `${JSON.stringify({ ...entry, sentAt: new Date().toISOString() })}\n`,
  );
}

export async function sendMagicLinkEmail(options: {
  email: string;
  link: string;
  code: string;
  locale: Locale;
}) {
  const copy = magicLinkCopy[options.locale];

  const captureFile = getE2ECaptureFile(options.email);
  if (captureFile) {
    captureEmail(captureFile, { ...options, kind: "magic_link" });
    return;
  }

  const smtp = getSmtpConfig();
  const transporter = nodemailer.createTransport(smtp);

  await transporter.sendMail({
    from: process.env.ZOHO_SMTP_FROM ?? smtp.auth.user,
    to: options.email,
    subject: copy.subject,
    text: copy.text(options.code, options.link),
  });
}

const passwordResetCopy: Record<
  Locale,
  { subject: string; text: (link: string) => string }
> = {
  he: {
    subject: "איפוס הסיסמה שלך ל־Robust",
    text: (link) =>
      `קיבלנו בקשה לאיפוס הסיסמה שלך ל־Robust.\n\nכדי לבחור סיסמה חדשה, לחצו על הקישור הבא:\n${link}\n\nהקישור תקף ל־15 דקות וניתן לשימוש פעם אחת בלבד. אם לא ביקשת לאפס את הסיסמה, אפשר להתעלם מהמייל.`,
  },
  en: {
    subject: "Reset your Robust password",
    text: (link) =>
      `We received a request to reset your Robust password.\n\nTo choose a new password, use this link:\n${link}\n\nThe link expires in 15 minutes and can only be used once. If you did not request this, you can ignore this email.`,
  },
  ru: {
    subject: "Сброс пароля Robust",
    text: (link) =>
      `Мы получили запрос на сброс пароля вашей учётной записи Robust.\n\nЧтобы задать новый пароль, перейдите по ссылке:\n${link}\n\nСсылка действительна 15 минут и может быть использована только один раз. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.`,
  },
};

export async function sendPasswordResetEmail(options: {
  email: string;
  link: string;
  locale: Locale;
}) {
  const copy = passwordResetCopy[options.locale];

  const captureFile = getE2ECaptureFile(options.email);
  if (captureFile) {
    captureEmail(captureFile, { ...options, kind: "password_reset" });
    return;
  }

  const smtp = getSmtpConfig();
  const transporter = nodemailer.createTransport(smtp);

  await transporter.sendMail({
    from: process.env.ZOHO_SMTP_FROM ?? smtp.auth.user,
    to: options.email,
    subject: copy.subject,
    text: copy.text(options.link),
  });
}
