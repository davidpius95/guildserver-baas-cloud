"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, query } from "@/lib/api";
import ProjectTabs from "./ProjectTabs";

interface StudioConfig {
  slug: string;
  status: string;
  studioUrl: string | null;
}

/**
 * Embeds the tenant's Supabase Studio in an iframe. `section` maps to a Studio
 * route (editor/auth/storage/logs/functions); empty renders Studio's home.
 */
export default function StudioEmbed({ id, section, title }: { id: string; section: string; title: string }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<StudioConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    query<StudioConfig>("project.get", { id })
      .then((p) => setCfg({ slug: p.slug, status: p.status, studioUrl: p.studioUrl }))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [id, router]);

  const src = cfg?.studioUrl
    ? `${cfg.studioUrl.replace(/\/$/, "")}${sectionPath(section)}`
    : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <ProjectTabs id={id} />
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {!cfg && !error && <p className="text-sm text-neutral-400">Loading…</p>}
      {cfg && cfg.status !== "active" && (
        <p className="text-sm text-neutral-500">
          Studio is available once the project is active (current: {cfg.status}).
        </p>
      )}
      {cfg && cfg.status === "active" && src && (
        <div className="overflow-hidden rounded-lg border border-neutral-800">
          <iframe
            src={src}
            title={title}
            className="h-[75vh] w-full bg-white"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          />
        </div>
      )}
      {cfg && cfg.status === "active" && !src && (
        <p className="text-sm text-neutral-500">Studio URL not yet available for this project.</p>
      )}
    </div>
  );
}

function sectionPath(section: string): string {
  switch (section) {
    case "editor":
      return "/project/default/sql/new";
    case "auth":
      return "/project/default/auth/users";
    case "storage":
      return "/project/default/storage/buckets";
    case "logs":
      return "/project/default/logs/explorer";
    case "functions":
      return "/project/default/functions";
    default:
      return "";
  }
}
