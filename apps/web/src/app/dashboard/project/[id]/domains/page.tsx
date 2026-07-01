"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, mutate, query } from "@/lib/api";
import ProjectTabs from "@/components/ProjectTabs";

interface Domain {
  id: string;
  hostname: string;
  status: string;
  verified: boolean;
  cfOwnershipTxtName: string | null;
  cfOwnershipTxtValue: string | null;
  cfSslStatus: string | null;
}

export default function DomainsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDomains(await query<Domain[]>("domain.list", { projectId: id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    void load();
  }, [load, router]);

  async function add() {
    const h = hostname.trim();
    if (!h) return;
    setError(null);
    setBusy(true);
    try {
      await mutate("domain.add", { projectId: id, hostname: h });
      setHostname("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  async function check(domainId: string) {
    setError(null);
    try {
      await mutate("domain.checkVerification", { id: domainId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    }
  }

  async function remove(domainId: string) {
    if (!confirm("Remove this custom domain?")) return;
    setError(null);
    try {
      await mutate("domain.remove", { id: domainId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <ProjectTabs id={id} />
      <h1 className="mb-6 text-xl font-semibold">Custom domains</h1>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="mb-6 flex gap-2">
        <input
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="api.example.com"
          className="flex-1 rounded bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-600"
        />
        <button
          onClick={add}
          disabled={busy || !hostname.trim()}
          className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add domain"}
        </button>
      </div>

      {domains.length === 0 ? (
        <p className="text-sm text-neutral-500">No custom domains. Add one, then create the shown DNS records to verify.</p>
      ) : (
        <div className="space-y-3">
          {domains.map((d) => (
            <div key={d.id} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm">{d.hostname}</p>
                  <p className="text-xs text-neutral-500">
                    {d.status}
                    {d.verified ? " · verified" : " · unverified"}
                    {d.cfSslStatus ? ` · SSL ${d.cfSslStatus}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!d.verified && (
                    <button onClick={() => check(d.id)} className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">
                      Check
                    </button>
                  )}
                  <button onClick={() => remove(d.id)} className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950">
                    Remove
                  </button>
                </div>
              </div>
              {!d.verified && d.cfOwnershipTxtName && (
                <div className="mt-3 rounded bg-neutral-800 p-3 text-xs">
                  <p className="mb-1 text-neutral-400">Add this TXT record to verify ownership:</p>
                  <p className="font-mono break-all">{d.cfOwnershipTxtName}</p>
                  <p className="font-mono break-all text-neutral-400">{d.cfOwnershipTxtValue}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
