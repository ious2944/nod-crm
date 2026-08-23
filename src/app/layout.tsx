import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { APP_NAME, MODULE_NAME } from "@/lib/config";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: `${APP_NAME} — module ${MODULE_NAME}.`,
  // Une instance auto-hébergée n'a rien à faire dans un index public : la
  // seule page atteignable sans session est l'écran de connexion.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-dvh bg-bg text-ink">{children}</body>
    </html>
  );
}
