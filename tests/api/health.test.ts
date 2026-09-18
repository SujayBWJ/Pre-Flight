import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("health endpoint", () => {
  it("reports that the backend is running", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, status: "ok" });
  });

  it("returns a stable error for unknown routes", async () => {
    const response = await request(createApp()).get("/unknown");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});