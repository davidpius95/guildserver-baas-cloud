"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, mutate, query } from "@/lib/api";
import ProjectTabs from "@/components/ProjectTabs";

interface Branch {
  id: string;
  name: string;
  slug: string;
  status: string;
  branchName: string | null;
  createdAt: string;
}

export default function BranchesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBranches(await query<Branch[]>("branch.list", { projectId: id }));
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
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, router]);

  async function create() {
    const branchName = newName.trim();
    if (!branchName) return;
    setError(null);
    setBusy(true);
    try {
      await mutate("branch.create", { projectId: id, branchName });
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function merge(branchProjectId: string) {
    if (!confirm("Merge this branch into the parent? The parent database will be replaced (a pre-merge snapshot is taken first).")) return;
    setError(null);
    try {
      await mutate("branch.merge", { branchProjectId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    }
  }

  async function remove(branchProjectId: string) {
    if (!confirm("Delete this branch and all its data?")) return;
    setError(null);
    try {
      await mutate("branch.delete", { branchProjectId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <ProjectTabs id={id} />
      <h1 className="mb-6 text-xl font-semibold">Branches</h1>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}

      <div className="mb-6 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="branch name (e.g. staging)"
          className="flex-1 rounded bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-600"
        />
        <button
          onClick={create}
          disabled={busy || !newName.trim()}
          className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create branch"}
        </button>
      </div>

      {branches.length === 0 ? (
        <p className="text-sm text-neutral-500">No branches. A branch is a full copy of this project&apos;s database in an isolated stack.</p>
      ) : (
        <div className="space-y-2">
          {branches.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div>
                <Link href={`/dashboard/project/${b.id}`} className="font-medium hover:text-emerald-400">
                  {b.branchName ?? b.name}
                </Link>
                <p className="font-mono text-xs text-neutral-500">{b.slug} · {b.status}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => merge(b.id)}
                  disabled={b.status !== "active"}
                  className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40"
                >
                  Merge to parent
                </button>
                <button
                  onClick={() => remove(b.id)}
                  className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
