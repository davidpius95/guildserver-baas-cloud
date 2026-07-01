"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clearToken, getToken, mutate, query } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusMessage: string | null;
  apiUrl: string | null;
  createdAt: string;
}
interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  provisioning: "bg-amber-500 animate-pulse",
  paused: "bg-neutral-500",
  error: "bg-red-500",
  deleting: "bg-red-700 animate-pulse",
};

export default function Dashboard() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("small");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const o = await query<Org[]>("organization.list");
      setOrgs(o);
      const org = activeOrg ?? o[0]?.id ?? null;
      setActiveOrg(org);
      const p = await query<Project[]>("project.list");
      setProjects(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [activeOrg]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, router]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await mutate("project.create", { name, organizationId: activeOrg, tier });
      setName("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  function logout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-neutral-400">{orgs.find((o) => o.id === activeOrg)?.name ?? "—"}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowCreate((v) => !v)} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">
            New project
          </button>
          <button onClick={logout} className="rounded border border-neutral-700 px-4 py-2 text-sm hover:bg-neutral-800">
            Sign out
          </button>
        </div>
      </header>

      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      {showCreate && (
        <form onSubmit={createProject} className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-neutral-400">Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-400">Tier</label>
            <select value={tier} onChange={(e) => setTier(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm outline-none">
              <option value="micro">micro</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          </div>
          <button type="submit" className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500">Create</button>
        </form>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <Link key={p.id} href={`/dashboard/project/${p.id}`}
            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition hover:border-neutral-700">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">{p.name}</h3>
              <span className="flex items-center gap-1.5 text-xs text-neutral-400">
                <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[p.status] ?? "bg-neutral-500"}`} />
                {p.status}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-neutral-500">{p.slug}</p>
            {p.statusMessage && <p className="mt-2 text-xs text-neutral-500">{p.statusMessage}</p>}
          </Link>
        ))}
        {projects.length === 0 && <p className="text-sm text-neutral-500">No projects yet. Create your first one.</p>}
      </div>
    </div>
  );
}
