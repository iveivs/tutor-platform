import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { CookieNotice } from "@/components/cookie-notice";
import "./globals.css";

export const metadata: Metadata = {
  title: "Тьюттори — платформа репетитора",
  description: "Расписание, ученики и оплаты частного преподавателя в Тьюттори.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/favicon-32.png",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased"><ThemeProvider><LanguageProvider>{children}<CookieNotice /></LanguageProvider></ThemeProvider></body>
    </html>
  );
}
