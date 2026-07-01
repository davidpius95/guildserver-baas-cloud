"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getToken, query } from "@/lib/api";
import ProjectTabs from "@/components/ProjectTabs";

interface Metric {
  collectedAt: string;
  cpuPercent: string | null;
  ramMbUsed: number | null;
  storageGbUsed: string | null;
  activeConnections: number | null;
  dbSizeMb: number | null;
}

const RANGES = [
  { label: "1h", minutes: 60 },
  { label: "6h", minutes: 360 },
  { label: "24h", minutes: 1440 },
  { label: "7d", minutes: 10080 },
];

export default function MetricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [rows, setRows] = useState<Metric[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(60);

  const load = useCallback(async () => {
    try {
      const data = await query<Metric[]>("metrics.range", { projectId: id, sinceMinutes: range });
      // API returns newest-first; charts want oldest-first.
      setRows([...data].reverse());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [id, range]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load, router]);

  const data = rows.map((r) => ({
    t: new Date(r.collectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    cpu: r.cpuPercent != null ? Number(r.cpuPercent) : null,
    ram: r.ramMbUsed ?? null,
    conns: r.activeConnections ?? null,
    dbMb: r.dbSizeMb ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <ProjectTabs id={id} />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Metrics</h1>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.minutes}
              onClick={() => setRange(r.minutes)}
              className={`rounded px-3 py-1 text-sm ${
                range === r.minutes ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-4 rounded bg-red-950 px-3 py-2 text-sm text-red-300">{error}</p>}
      {data.length === 0 ? (
        <p className="text-sm text-neutral-500">No metrics collected yet for this range.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Chart title="CPU %" data={data} dataKey="cpu" color="#34d399" />
          <Chart title="RAM used (MB)" data={data} dataKey="ram" color="#60a5fa" />
          <Chart title="Active connections" data={data} dataKey="conns" color="#fbbf24" />
          <Chart title="DB size (MB)" data={data} dataKey="dbMb" color="#c084fc" />
        </div>
      )}
    </div>
  );
}

function Chart({
  title,
  data,
  dataKey,
  color,
}: {
  title: string;
  data: Record<string, unknown>[];
  dataKey: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <p className="mb-3 text-sm font-medium text-neutral-300">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="3 3" />
          <XAxis dataKey="t" tick={{ fill: "#737373", fontSize: 11 }} minTickGap={40} />
          <YAxis tick={{ fill: "#737373", fontSize: 11 }} />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", borderRadius: 6, fontSize: 12 }}
            labelStyle={{ color: "#a3a3a3" }}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
