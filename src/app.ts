import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRouter } from "./api/routes.js";

export function createApp() {
  const app = express();

  app.use(express.json({ limit: "256kb" }));

  app.get("/", (_request, response) => {
    response.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pre-Flight</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f4f7ff; margin: 0; min-height: 100vh; display: grid; place-items: center; color: #1d2a3a; }
      .card { max-width: 640px; background: white; border-radius: 20px; padding: 2rem 2.25rem; box-shadow: 0 18px 50px rgba(31, 41, 55, 0.12); }
      h1 { margin: 0 0 0.75rem; font-size: clamp(2rem, 4vw, 3rem); }
      p { margin: 0 0 1.25rem; line-height: 1.6; color: #425466; }
      a { display: inline-block; padding: 0.8rem 1.1rem; border-radius: 999px; background: #2f5cff; color: #fff; text-decoration: none; font-weight: 700; }
      code { background: #eef3ff; padding: 0.12rem 0.35rem; border-radius: 6px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Pre-Flight</h1>
      <p>This is the application prep API. Open the frontend at <strong>http://localhost:5173</strong> to use the dashboard, or use the API endpoints on <code>http://localhost:3000</code>.</p>
      <p>To start the full app locally, run <code>npm run dev</code>.</p>
      <a href="http://localhost:5173">Open frontend</a>
    </main>
  </body>
</html>`);
  });

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