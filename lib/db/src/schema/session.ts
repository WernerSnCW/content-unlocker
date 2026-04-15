import { pgTable, varchar, json, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Session table — runtime storage for express-session + connect-pg-simple.
 *
 * This table is populated and read exclusively by connect-pg-simple at
 * runtime. It is declared here ONLY so that drizzle-kit doesn't try to
 * drop it on schema push (drizzle-kit deletes any unknown tables by
 * default, and the session data would be lost — all users logged out).
 *
 * The column names + types MUST match connect-pg-simple's expectations:
 *   https://github.com/voxpelli/node-connect-pg-simple/blob/HEAD/table.sql
 *
 * Do NOT modify this table structure without also updating connect-pg-simple
 * (unlikely to ever happen).
 */
export const sessionTable = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (t) => ({
    expireIdx: index("IDX_session_expire").on(t.expire),
  }),
);
