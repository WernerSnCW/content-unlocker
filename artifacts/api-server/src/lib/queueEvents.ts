// Lightweight SSE broadcaster for call-queue updates.
// Webhook handlers and the untagged-sweep call notifyQueueChanged() to push
// a "refresh your queue" signal to all currently-connected Call Command pages.
//
// One process, in-memory only — fine for Replit's single-instance setup.
// If we ever scale horizontally we'd swap this for a Redis pub/sub.

import type { Response } from "express";

export interface QueueEvent {
  event: string;             // "call.ended" | "call.tagged" | "untagged-sweep" | "ping"
  contactId?: string;
  contactName?: string;      // populated on call.tagged so the frontend can add a tray entry for out-of-band taggings (Power Dialer, simulator, etc.) where handleCallEnded didn't run
  callId?: string;
  at?: string;               // ISO timestamp
}

const subscribers = new Set<Response>();

// Express handler: subscribe a response stream to queue events.
export function subscribeQueueEvents(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx: don't buffer
  res.flushHeaders?.();

  // Initial hello so the EventSource readyState transitions to OPEN immediately
  res.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);

  subscribers.add(res);

  // Keepalive ping every 25s — reverse proxies often kill idle connections at 30-60s
  const keepalive = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {"at":"${new Date().toISOString()}"}\n\n`);
    } catch {
      clearInterval(keepalive);
      subscribers.delete(res);
    }
  }, 25_000);

  res.on("close", () => {
    clearInterval(keepalive);
    subscribers.delete(res);
  });
}

// Push an event to every connected client.
export function notifyQueueChanged(event: QueueEvent): void {
  const payload = JSON.stringify({ ...event, at: event.at ?? new Date().toISOString() });
  const message = `event: ${event.event}\ndata: ${payload}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(message);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function subscriberCount(): number {
  return subscribers.size;
}
