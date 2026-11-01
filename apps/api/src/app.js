import express from "express";
import helmet from "helmet";
import { createAuthRouter } from "./auth/routes.js";

export function createApp({ checkDatabase, db, authConfig, logger = console }) {
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

  if (db && authConfig) {
    app.use("/auth", createAuthRouter(db, authConfig));
  }

  app.use((_request, response) => {
    response.status(404).json({ error: "NOT_FOUND" });
  });
  app.use((error, _request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.type === "entity.parse.failed") {
      return response.status(400).json({ error: "Invalid JSON" });
    }
    if (error.type === "entity.too.large") {
      return response.status(413).json({ error: "Request body is too large" });
    }
    logger.error("Request failed");
    response.status(503).json({ error: "Service unavailable. Try again later." });
  });
  return app;
}
