"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, mutate, query } from "@/lib/api";
import ProjectTabs from "@/components/ProjectTabs";

interface Backup {
  id: string;
  status: string;
  backupType: string;
  sizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  error: string | null;
}

export default function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBackups(await query<Backup[]>("backup.list", { projectId: id }));
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

  async function createBackup() {
    setError(null);
    setBusy(true);
    try {
      await mutate("backup.createManual", { projectId: id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function restore(backupId: string) {
    if (!confirm("Restore this backup? The current database will be replaced.")) return;
    setError(null);
    try {
      await mutate("backup.restore", { backupId });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <ProjectTabs id={id} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Backups</h1>
        <button
          onClick={createBackup}
          disabled={busy}
          className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create backup"}
        </button>
      </div>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {backups.length === 0 ? (
        <p className="text-sm text-neutral-500">No backups yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-left text-xs text-neutral-500">
              <tr>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Expires</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id} className="border-t border-neutral-800">
                  <td className="px-4 py-2">{fmtDate(b.createdAt)}</td>
                  <td className="px-4 py-2 text-neutral-400">{b.backupType}</td>
                  <td className="px-4 py-2">
                    <span className={statusColor(b.status)}>{b.status}</span>
                    {b.error && <span className="ml-2 text-xs text-red-400">{b.error}</span>}
                  </td>
                  <td className="px-4 py-2 text-neutral-400">{fmtSize(b.sizeBytes)}</td>
                  <td className="px-4 py-2 text-neutral-400">{b.expiresAt ? fmtDate(b.expiresAt) : "—"}</td>
                  <td className="px-4 py-2 text-right">
                    {b.status === "completed" && (
                      <button onClick={() => restore(b.id)} className="text-xs text-emerald-400 hover:text-emerald-300">
                        restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusColor(s: string): string {
  if (s === "completed") return "text-emerald-400";
  if (s === "failed") return "text-red-400";
  return "text-amber-400";
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleString();
}
function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}
