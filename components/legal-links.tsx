import Link from "next/link";

export function LegalLinks({ className = "" }: { className?: string }) {
  return <nav aria-label="Юридические документы" className={`flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-500 ${className}`}>
    <Link href="/legal/terms" className="hover:text-indigo-600">Соглашение</Link>
    <Link href="/legal/privacy" className="hover:text-indigo-600">Конфиденциальность</Link>
    <Link href="/legal/personal-data-consent" className="hover:text-indigo-600">Согласие на обработку данных</Link>
    <Link href="/legal/content-rules" className="hover:text-indigo-600">Правила контента</Link>
  </nav>;
}
