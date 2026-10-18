import type { MetadataRoute } from "next";

const legalSlugs = ["terms", "privacy", "content-rules", "personal-data-consent", "parental-consent"];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://tyuttori.ru", changeFrequency: "monthly", priority: 1 },
    { url: "https://tyuttori.ru/legal", changeFrequency: "yearly", priority: 0.4 },
    ...legalSlugs.map((slug) => ({ url: `https://tyuttori.ru/legal/${slug}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
