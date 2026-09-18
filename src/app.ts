import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./api/routes.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "256kb" }));

  app.get("/health", (_request, response) => {
    response.json({ success: true, status: "ok" });
  });

  app.use("/api", apiRouter);

  app.use((_request, response) => {
    response.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested endpoint does not exist."
      }
    });
  });

  app.use(errorHandler);
  return app;
}