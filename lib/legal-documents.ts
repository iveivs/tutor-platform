import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

export const legalDocuments = {
  terms: { title: "Пользовательское соглашение", file: "terms.md", pdf: "01-user-agreement.pdf" },
  privacy: { title: "Политика обработки персональных данных", file: "privacy.md", pdf: "02-privacy-policy.pdf" },
  "personal-data-consent": { title: "Согласие на обработку персональных данных", file: "personal-data-consent.md", pdf: "03-personal-data-consent.pdf" },
  "content-rules": { title: "Правила размещения контента и фотографий", file: "content-rules.md", pdf: "04-user-content-and-photo-rules.pdf" },
  "parental-consent": { title: "Согласие законного представителя", file: "parental-consent.md", pdf: "05-minor-representative-consent.pdf" },
} as const;

export type LegalDocumentSlug = keyof typeof legalDocuments;

export function isLegalDocumentSlug(value: string): value is LegalDocumentSlug {
  return Object.hasOwn(legalDocuments, value);
}

function legalDocumentsDirectory() {
  return process.env.LEGAL_DOCUMENTS_DIR ?? path.join(process.cwd(), "private", "legal-documents");
}

export function readLegalDocument(slug: LegalDocumentSlug) {
  return readFileSync(path.join(/* turbopackIgnore: true */ legalDocumentsDirectory(), legalDocuments[slug].file), "utf8");
}

export function readLegalDocumentPdf(slug: LegalDocumentSlug) {
  return readFileSync(path.join(/* turbopackIgnore: true */ legalDocumentsDirectory(), legalDocuments[slug].pdf));
}
