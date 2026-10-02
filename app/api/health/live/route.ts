export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "tutor-platform" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

