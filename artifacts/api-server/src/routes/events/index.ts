// Server-Sent Events for live UI updates.
// Frontend subscribes once via EventSource; backend pushes whenever a
// webhook handler or background job touches relevant state.
import { Router, type IRouter } from "express";
import { subscribeQueueEvents, subscriberCount } from "../../lib/queueEvents";

const router: IRouter = Router();

// GET /events/queue — long-lived SSE connection
router.get("/events/queue", (_req, res) => {
  subscribeQueueEvents(res);
});

// GET /events/health — diagnostic
router.get("/events/health", (_req, res): void => {
  res.json({ subscribers: subscriberCount() });
});

export default router;
