import Link from "next/link";
import { BrandIcon } from "@/components/brand-icon";
import { legalDocuments } from "@/lib/legal-documents";

export default function LegalIndexPage() {
  return <main className="min-h-screen bg-background px-4 py-10 text-foreground">
    <section className="mx-auto max-w-3xl">
      <Link href="/" className="inline-flex items-center gap-3"><BrandIcon className="size-11" /><span className="text-xl font-bold">Тьюттори</span></Link>
      <h1 className="mt-10 text-3xl font-bold">Юридические документы</h1>
      <div className="mt-7 grid gap-3">{Object.entries(legalDocuments).map(([slug, document]) => <Link key={slug} href={`/legal/${slug}`} className="rounded-2xl border border-border bg-card p-5 font-medium shadow-sm hover:border-indigo-400">{document.title}</Link>)}</div>
    </section>
  </main>;
}
