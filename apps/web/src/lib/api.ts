"use client";

const API_URL =
  process.env.NEXT_PUBLIC_BAAS_API_URL ??
  (typeof window !== "undefined" ? window.location.origin : "http://localhost:4001");

const TOKEN_KEY = "baas_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

class TRPCError extends Error {}

async function unwrap(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ?? `Request failed (${res.status})`;
    throw new TRPCError(typeof msg === "string" ? msg : "Request failed");
  }
  return body?.result?.data;
}

/** tRPC query (GET with input as ?input=<json>). */
export async function query<T = unknown>(path: string, input?: unknown): Promise<T> {
  const qs = input !== undefined ? `?input=${encodeURIComponent(JSON.stringify(input))}` : "";
  const res = await fetch(`${API_URL}/trpc/${path}${qs}`, {
    headers: { ...authHeaders() },
    cache: "no-store",
  });
  return unwrap(res);
}

/** tRPC mutation (POST with raw input body). */
export async function mutate<T = unknown>(path: string, input?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(input ?? {}),
  });
  return unwrap(res);
}

export { TRPCError, API_URL };
