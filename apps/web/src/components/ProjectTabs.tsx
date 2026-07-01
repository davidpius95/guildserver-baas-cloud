"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { label: string; seg: string }[] = [
  { label: "Overview", seg: "" },
  { label: "Editor", seg: "editor" },
  { label: "Auth", seg: "auth" },
  { label: "Storage", seg: "storage" },
  { label: "Functions", seg: "functions" },
  { label: "Logs", seg: "logs" },
  { label: "Metrics", seg: "metrics" },
  { label: "Backups", seg: "backups" },
  { label: "Branches", seg: "branches" },
  { label: "Domains", seg: "domains" },
  { label: "Settings", seg: "settings" },
];

/** Shared tab bar rendered at the top of every project sub-page. */
export default function ProjectTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/dashboard/project/${id}`;
  return (
    <div className="mb-6">
      <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
        ← Projects
      </Link>
      <nav className="mt-3 flex flex-wrap gap-1 border-b border-neutral-800">
        {TABS.map((t) => {
          const href = t.seg ? `${base}/${t.seg}` : base;
          const active = pathname === href;
          return (
            <Link
              key={t.seg || "overview"}
              href={href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                active
                  ? "border-emerald-500 text-neutral-100"
                  : "border-transparent text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
