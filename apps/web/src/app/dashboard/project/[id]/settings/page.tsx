"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, mutate, query } from "@/lib/api";
import ProjectTabs from "@/components/ProjectTabs";

interface Project {
  id: string;
  name: string;
  status: string;
  scalingMode: string | null;
  idleTimeoutMinutes: number | null;
  backupEnabled: boolean | null;
}

export default function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [scalingMode, setScalingMode] = useState("manual");
  const [idleTimeout, setIdleTimeout] = useState("");
  const [backupEnabled, setBackupEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await query<Project>("project.get", { id });
      setProject(p);
      setName(p.name);
      setScalingMode(p.scalingMode ?? "manual");
      setIdleTimeout(p.idleTimeoutMinutes != null ? String(p.idleTimeoutMinutes) : "");
      setBackupEnabled(Boolean(p.backupEnabled));
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

  async function save() {
    setError(null);
    setSaved(false);
    const trimmed = idleTimeout.trim();
    try {
      await mutate("project.update", {
        id,
        name: name.trim() || undefined,
        scalingMode,
        idleTimeoutMinutes: trimmed === "" ? null : Number(trimmed),
        backupEnabled,
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <ProjectTabs id={id} />
      <h1 className="mb-6 text-xl font-semibold">Settings</h1>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {saved && <p className="mb-4 rounded bg-emerald-950 px-3 py-2 text-sm text-emerald-300">Saved.</p>}
      {!project ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <div className="space-y-5 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <Row label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </Row>
          <Row label="Scaling mode" hint="auto evaluates CPU/RAM every 10 min and resizes within tier bounds">
            <select
              value={scalingMode}
              onChange={(e) => setScalingMode(e.target.value)}
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-600"
            >
              <option value="manual">manual</option>
              <option value="auto">auto</option>
            </select>
          </Row>
          <Row label="Idle timeout (min)" hint="blank disables auto-pause; the project pauses after this many minutes with no DB connections">
            <input
              type="number"
              min={1}
              value={idleTimeout}
              onChange={(e) => setIdleTimeout(e.target.value)}
              placeholder="disabled"
              className="w-40 rounded bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </Row>
          <Row label="Automatic backups" hint="nightly pg_dump retained per backup policy">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={backupEnabled} onChange={(e) => setBackupEnabled(e.target.checked)} />
              enabled
            </label>
          </Row>
          <div className="pt-2">
            <button onClick={save} className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium hover:bg-emerald-600">
              Save changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-neutral-300">{label}</p>
      {hint && <p className="mb-2 text-xs text-neutral-500">{hint}</p>}
      {children}
    </div>
  );
}
