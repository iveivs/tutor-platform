import { isLegalDocumentSlug, legalDocuments, readLegalDocumentPdf } from "@/lib/legal-documents";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isLegalDocumentSlug(slug)) return new Response("Not found", { status: 404 });

  try {
    const pdf = readLegalDocumentPdf(slug);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="${legalDocuments[slug].pdf}"`,
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
