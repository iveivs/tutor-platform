import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin", "/invite/", "/teacher-invite/"] },
    sitemap: "https://tyuttori.ru/sitemap.xml",
  };
}
