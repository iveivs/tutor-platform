import "server-only";

import type { PoolClient } from "pg";
import { getPostgresPool } from "@/db/postgres";

type RealtimeChange = { memberId: string; cursor: number; sections: string };
type RealtimeListener = (change: RealtimeChange) => void;
type RealtimeState = {
  client?: PoolClient;
  connecting?: Promise<void>;
  listeners: Map<string, Set<RealtimeListener>>;
  reconnectTimer?: NodeJS.Timeout;
};

const globalRealtime = globalThis as typeof globalThis & { tutorRealtimeState?: RealtimeState };
const state = globalRealtime.tutorRealtimeState ?? { listeners: new Map<string, Set<RealtimeListener>>() };
globalRealtime.tutorRealtimeState = state;

function scheduleReconnect() {
  if (state.reconnectTimer || state.listeners.size === 0) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    void ensureRealtimeListener();
  }, 2_000);
}

async function ensureRealtimeListener() {
  if (state.client || state.connecting) return state.connecting;
  state.connecting = (async () => {
    const client = await getPostgresPool().connect();
    try {
      const disconnect = () => {
        if (state.client !== client) return;
        state.client = undefined;
        client.release(true);
        scheduleReconnect();
      };
      client.on("notification", (message) => {
        if (message.channel !== "tutor_data_changes" || !message.payload) return;
        try {
          const change = JSON.parse(message.payload) as RealtimeChange;
          if (!change.memberId || !Number.isFinite(change.cursor)) return;
          for (const listener of state.listeners.get(change.memberId) ?? []) listener(change);
        } catch {
          // Ignore malformed database notifications; cursor polling remains the fallback.
        }
      });
      client.on("error", disconnect);
      client.on("end", disconnect);
      await client.query("LISTEN tutor_data_changes");
      state.client = client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  })().catch(() => {
    scheduleReconnect();
  }).finally(() => {
    state.connecting = undefined;
  });
  return state.connecting;
}

export function subscribeToRealtimeChanges(memberId: string, listener: RealtimeListener) {
  const listeners = state.listeners.get(memberId) ?? new Set<RealtimeListener>();
  listeners.add(listener);
  state.listeners.set(memberId, listeners);
  void ensureRealtimeListener();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) state.listeners.delete(memberId);
  };
}
