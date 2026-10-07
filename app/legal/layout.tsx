import { ThemeToggle } from "@/components/theme-toggle";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <><div className="fixed right-4 top-4 z-50"><ThemeToggle compact /></div>{children}</>;
}
