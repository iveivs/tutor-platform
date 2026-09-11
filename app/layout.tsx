import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Репетитор — расписание занятий",
  description: "Расписание, ученики и оплаты частного преподавателя.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className="antialiased"><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
