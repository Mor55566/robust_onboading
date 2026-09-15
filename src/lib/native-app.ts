export const APPLE_TEAM_ID = "858CT29SDS";
export const IOS_BUNDLE_ID = "app.robust.mobile";
export const ANDROID_PACKAGE_NAME = "app.robust.mobile";
export const IOS_APP_STORE_ID = "6800617405";
export const IOS_APP_STORE_URL = `https://apps.apple.com/us/app/robust/id${IOS_APP_STORE_ID}`;
export const NATIVE_APP_HOST = "app.withrobust.com";
export const NATIVE_APP_SCHEME = "robust";

/** SHA-256 of the upload/release cert that signs public/robust.apk */
export const ANDROID_CERT_SHA256 =
  "6A:BF:70:14:5F:AA:97:DB:75:66:8A:3A:73:99:7B:3F:F3:3F:AC:F1:17:1D:A7:5F:0F:5A:E1:4A:B8:BC:80:55";

const QR_RETURN_PATHS = new Set(["/location-scan", "/missions/scan"]);

export function appleAppSiteAssociation() {
  const appID = `${APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;
  return {
    applinks: {
      apps: [] as string[],
      details: [
        {
          appID,
          paths: ["/location-scan*", "/missions/scan*"],
          appIDs: [appID],
          components: [{ "/": "/location-scan*" }, { "/": "/missions/scan*" }],
        },
      ],
    },
  };
}

export function androidAssetLinks() {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: ANDROID_PACKAGE_NAME,
        sha256_cert_fingerprints: [ANDROID_CERT_SHA256],
      },
    },
  ];
}

export function associationFileHeaders() {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600",
  };
}

/** Relative QR scan paths only — never an open redirect. */
export function safeQrReturnPath(value: string | null | undefined): string | null {
  if (!value) return null;

  let decoded = value.trim();
  try {
    decoded = decodeURIComponent(decoded).trim();
  } catch {
    return null;
  }

  if (!decoded.startsWith("/")) return null;
  if (decoded.startsWith("//") || decoded.includes("://") || decoded.includes("\\")) {
    return null;
  }

  const path = decoded.split("?")[0]?.split("#")[0] ?? "";
  if (!QR_RETURN_PATHS.has(path)) return null;
  return decoded;
}

export function postLoginPath(next: string | null | undefined): string {
  return safeQrReturnPath(next) ?? "/";
}

export function loginHref(next?: string | null): string {
  const returnPath = safeQrReturnPath(next);
  if (!returnPath) return "/login";
  return `/login?next=${encodeURIComponent(returnPath)}`;
}

export function passwordLoginHref(next?: string | null): string {
  const returnPath = safeQrReturnPath(next);
  if (!returnPath) return "/login/password";
  return `/login/password?next=${encodeURIComponent(returnPath)}`;
}

/** Custom-scheme URL the native apps convert back to https://app.withrobust.com/... */
export function nativeAppSchemeUrl(returnPath: string): string | null {
  const safePath = safeQrReturnPath(returnPath);
  if (!safePath) return null;
  return `${NATIVE_APP_SCHEME}://${safePath.replace(/^\//, "")}`;
}
