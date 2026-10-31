import express from "express";
import helmet from "helmet";

export function createApp({ checkDatabase, logger = console }) {
  // Passing in the database check lets tests simulate an outage safely.
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  // Liveness checks the server; readiness also checks its database.
  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "throTl" });
  });

  app.get("/ready", async (_request, response) => {
    try {
      await checkDatabase();
      response.json({ status: "ok", database: "connected" });
    } catch {
      logger.error("Database readiness check failed");
      response.status(503).json({ status: "unavailable", database: "unavailable" });
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: "NOT_FOUND" });
  });
  return app;
}
