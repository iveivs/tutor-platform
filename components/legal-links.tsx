import Link from "next/link";

export function LegalLinks({ className = "" }: { className?: string }) {
  return <nav aria-label="Юридические документы" className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-ink-muted ${className}`}>
    <Link href="/legal/terms" className="hover:text-brand-text">Соглашение</Link>
    <Link href="/legal/privacy" className="hover:text-brand-text">Конфиденциальность</Link>
    <Link href="/legal/personal-data-consent" className="hover:text-brand-text">Согласие на обработку данных</Link>
    <Link href="/legal/content-rules" className="hover:text-brand-text">Правила контента</Link>
  </nav>;
}
