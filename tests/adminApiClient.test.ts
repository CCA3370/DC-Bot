import { describe, expect, it } from "vitest";
import { buildApiRequestInit } from "../src/admin/client/src/apiClient.js";

describe("admin API client", () => {
  it("does not send a JSON content-type for requests without a body", () => {
    const request = buildApiRequestInit({ method: "POST" });
    const headers = new Headers(request.headers);

    expect(headers.has("content-type")).toBe(false);
    expect(request.credentials).toBe("include");
  });

  it("adds JSON content-type for requests with a body", () => {
    const request = buildApiRequestInit({
      method: "POST",
      body: JSON.stringify({ ok: true })
    });
    const headers = new Headers(request.headers);

    expect(headers.get("content-type")).toBe("application/json");
  });

  it("preserves explicit content-type headers", () => {
    const request = buildApiRequestInit({
      method: "POST",
      body: "plain text",
      headers: {
        "content-type": "text/plain"
      }
    });
    const headers = new Headers(request.headers);

    expect(headers.get("content-type")).toBe("text/plain");
  });
});
