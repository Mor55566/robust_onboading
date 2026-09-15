import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "Robust Onboarding",
  description: "Super-admin tool for onboarding new buildings into Robust",
  icons: {
    icon: [
      { url: "/Robust-favicon/favicon.ico" },
      {
        url: "/Robust-favicon/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
      },
      {
        url: "/Robust-favicon/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/Robust-favicon/favicon-48x48.png",
        sizes: "48x48",
        type: "image/png",
      },
    ],
    apple: "/Robust-favicon/apple-touch-icon.png",
  },
  manifest: "/Robust-favicon/site.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f5fe0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
