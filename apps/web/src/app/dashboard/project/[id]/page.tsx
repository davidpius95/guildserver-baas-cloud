"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getToken, mutate, query } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusMessage: string | null;
  apiUrl: string | null;
  realtimeUrl: string | null;
  storageUrl: string | null;
  studioUrl: string | null;
  hostPortBase: number | null;
  ramMbLimit: number | null;
  vcpuLimit: string | null;
}
interface ConnInfo {
  apiUrl: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  db: { host: string | null; port: number | null; database: string | null; user: string | null; password: string | null };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [conn, setConn] = useState<ConnInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await query<Project>("project.get", { id });
      setProject(p);
      if (p.status === "active") {
        try {
          setConn(await query<ConnInfo>("project.connectionInfo", { id }));
        } catch {
          /* not ready */
        }
      }
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

  async function action(path: string) {
    setError(null);
    try {
      await mutate(path, { id });
      if (path === "project.delete") {
        router.replace("/dashboard");
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    }
  }

  if (!project) {
    return <div className="mx-auto max-w-4xl px-6 py-8 text-neutral-400">{error ?? "Loading…"}</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">← Projects</Link>
      <header className="mt-3 mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="font-mono text-xs text-neutral-500">{project.slug} · {project.status}</p>
        </div>
        <div className="flex gap-2">
          {project.status === "active" && (
            <button onClick={() => action("project.pause")} className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">Pause</button>
          )}
          {project.status === "paused" && (
            <button onClick={() => action("project.resume")} className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800">Resume</button>
          )}
          <button onClick={() => { if (confirm("Delete this project and all its data?")) action("project.delete"); }}
            className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950">Delete</button>
        </div>
      </header>

      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {project.statusMessage && <p className="mb-4 text-sm text-neutral-400">{project.statusMessage}</p>}

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="vCPU" value={project.vcpuLimit ?? "—"} />
        <Stat label="RAM (MB)" value={String(project.ramMbLimit ?? "—")} />
        <Stat label="Port base" value={String(project.hostPortBase ?? "—")} />
      </section>

      {conn ? (
        <section className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="text-sm font-semibold text-neutral-300">Connection</h2>
          <Field label="API URL" value={conn.apiUrl ?? project.apiUrl ?? ""} />
          <Field label="anon key" value={conn.anonKey ?? ""} mono />
          <Field label="service_role key" value={conn.serviceRoleKey ?? ""} mono secret />
          <Field label="DB" value={`postgres://${conn.db.user}:••••@${conn.db.host}:${conn.db.port}/${conn.db.database}`} mono />
        </section>
      ) : (
        <p className="text-sm text-neutral-500">
          {project.status === "provisioning" ? "Provisioning… connection details appear once active." : "Connection details unavailable."}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium">{value}</p>
    </div>
  );
}

function Field({ label, value, mono, secret }: { label: string; value: string; mono?: boolean; secret?: boolean }) {
  const [show, setShow] = useState(!secret);
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">{label}</p>
      <div className="flex items-center gap-2">
        <code className={`flex-1 overflow-x-auto rounded bg-neutral-800 px-3 py-1.5 text-xs ${mono ? "font-mono" : ""}`}>
          {show ? value : "•".repeat(Math.min(48, value.length))}
        </code>
        {secret && (
          <button onClick={() => setShow((v) => !v)} className="text-xs text-neutral-400 hover:text-neutral-200">
            {show ? "hide" : "show"}
          </button>
        )}
        <button onClick={() => navigator.clipboard?.writeText(value)} className="text-xs text-neutral-400 hover:text-neutral-200">copy</button>
      </div>
    </div>
  );
}
