import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalDocument } from "@/components/legal-document";
import { isLegalDocumentSlug, legalDocuments, readLegalDocument } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return isLegalDocumentSlug(slug) ? { title: `${legalDocuments[slug].title} — Тьюттори` } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isLegalDocumentSlug(slug)) notFound();
  return <main className="min-h-screen bg-background px-4 py-10 text-foreground">
    <section className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/legal" className="text-sm font-medium text-indigo-600">← Все документы</Link>
        <Link href={`/legal/${slug}/pdf`} target="_blank" className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:border-indigo-400">Открыть PDF</Link>
      </div>
      <LegalDocument markdown={readLegalDocument(slug)} />
    </section>
  </main>;
}
