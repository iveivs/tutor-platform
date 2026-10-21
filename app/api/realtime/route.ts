import { getAuthMember } from "@/lib/auth";
import { subscribeToRealtimeChanges } from "@/lib/realtime-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });

  let close: () => void = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (value: string) => {
        if (!closed) controller.enqueue(encoder.encode(value));
      };
      const unsubscribe = subscribeToRealtimeChanges(auth.memberId, (change) => {
        send(`data: ${JSON.stringify({ cursor: change.cursor, sections: change.sections })}\n\n`);
      });
      const heartbeat = setInterval(() => send(": keep-alive\n\n"), 20_000);
      close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener("abort", close, { once: true });
      send("retry: 3000\n\n");
    },
    cancel() { close(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
