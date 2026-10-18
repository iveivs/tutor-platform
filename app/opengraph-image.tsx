import { ImageResponse } from "next/og";

export const alt = "Тьюттори — платформа репетитора";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ display: "flex", width: "100%", height: "100%", padding: 72, color: "#f8fafc", background: "linear-gradient(135deg, #111827 0%, #1e1b4b 55%, #312e81 100%)", fontFamily: "sans-serif" }}>
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 96, height: 96, borderRadius: 28, background: "#f8fafc", color: "#312e81", fontSize: 62, fontWeight: 800 }}>Т</div><div style={{ fontSize: 46, fontWeight: 750 }}>Тьюттори</div></div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}><div style={{ fontSize: 72, lineHeight: 1.05, fontWeight: 800, letterSpacing: -2 }}>Уроки под контролем.<br />Общение — рядом.</div><div style={{ fontSize: 32, color: "#c7d2fe" }}>Расписание, ученики, материалы и оплаты в одном кабинете</div></div>
    </div>
  </div>, size);
}
