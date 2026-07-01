"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { mutate, setToken } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const path = mode === "register" ? "auth.register" : "auth.login";
      const input = mode === "register" ? { email, password, orgName: orgName || undefined } : { email, password };
      const data = await mutate<{ token: string }>(path, input);
      setToken(data.token);
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border border-neutral-800 bg-neutral-900 p-8">
        <div>
          <h1 className="text-xl font-semibold">GuildServer BaaS Cloud</h1>
          <p className="text-sm text-neutral-400">{mode === "register" ? "Create your account" : "Sign in"}</p>
        </div>
        {error && <p className="rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
        <input
          type="email" required placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        <input
          type="password" required placeholder="Password (min 8 chars)" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        {mode === "register" && (
          <input
            type="text" placeholder="Organization name (optional)" value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        )}
        <button
          type="submit" disabled={loading}
          className="w-full rounded bg-emerald-600 px-3 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {loading ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
        </button>
        <p className="text-center text-sm text-neutral-400">
          {mode === "register" ? (
            <>Already have an account? <Link href="/login" className="text-emerald-400">Sign in</Link></>
          ) : (
            <>No account? <Link href="/register" className="text-emerald-400">Register</Link></>
          )}
        </p>
      </form>
    </main>
  );
}
