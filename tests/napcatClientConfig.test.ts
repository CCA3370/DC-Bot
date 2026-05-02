import { afterEach, describe, expect, it, vi } from "vitest";
import { NapCatClient } from "../src/napcat/napcatClient.js";

describe("NapCatClient runtime config", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses updated endpoint and access token for subsequent calls", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ retcode: 0, data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: "old-token"
    });

    await client.testConnection();
    client.updateConfig({
      endpoint: "http://127.0.0.1:3001",
      accessToken: "new-token"
    });
    await client.testConnection();

    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/get_status");
    expect((firstRequest?.headers as Record<string, string>).authorization).toBe("Bearer old-token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3001/get_status");
    expect((secondRequest?.headers as Record<string, string>).authorization).toBe("Bearer new-token");
  });

  it("loads and normalizes the current QQ group list", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            retcode: 0,
            data: [
              { group_id: 10002, group_name: "Beta", member_count: 12, max_member_count: 200 },
              { group_id: "10001", group_name: "Alpha" }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: ""
    });

    await expect(client.listGroups()).resolves.toEqual([
      { groupId: "10001", name: "Alpha", memberCount: null, maxMemberCount: null },
      { groupId: "10002", name: "Beta", memberCount: 12, maxMemberCount: 200 }
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/get_group_list");
  });
});
