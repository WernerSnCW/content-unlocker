import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware } from "./lib/auth/session";

const app: Express = express();

// Behind Replit's proxy / any TLS-terminating proxy — trust it so that
// req.protocol reflects the original scheme (matters for Secure cookies).
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: if APP_URL is set we restrict to it and allow credentials (required
// for cookie-based auth). If unset (early dev), fall back to permissive.
const appUrl = process.env.APP_URL;
if (appUrl) {
  app.use(
    cors({
      origin: appUrl,
      credentials: true,
    }),
  );
} else {
  app.use(cors());
}

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware is lazy-loaded because it needs env vars at construction.
// If SESSION_SECRET is missing we skip it and only /api/auth/* will fail —
// the rest of the API continues to work (useful during incremental rollout).
try {
  app.use(buildSessionMiddleware());
} catch (err: any) {
  logger.warn({ err: err.message }, "Session middleware disabled");
}

app.use("/api", router);

export default app;
