import app from "./app";
import { logger } from "./lib/logger";
import { seedDatabase } from "./lib/dataManager";
import { loadConstants } from "./lib/complianceConstantsService";
import { startUntaggedSweep } from "./routes/aircall";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedDatabase()
  .then(async () => {
    const constants = await loadConstants();
    if (constants.length === 0) {
      logger.error("FATAL: compliance_constants table is empty after seed. Halting startup.");
      process.exit(1);
    }
    logger.info({ count: constants.length }, "Compliance constants loaded into cache");
    startUntaggedSweep();
    logger.info("Untagged-conversation sweep scheduled (every 5 min)");
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to seed database");
    app.listen(port, (err2) => {
      if (err2) {
        logger.error({ err: err2 }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening (seed failed, continuing)");
    });
  });
