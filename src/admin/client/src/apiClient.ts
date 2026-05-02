export function buildApiRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return {
    ...init,
    credentials: "include",
    headers
  };
}

export async function api<T = { ok: boolean }>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, buildApiRequestInit(init));

  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body as T;
}
