"use client";

import { use } from "react";
import StudioEmbed from "@/components/StudioEmbed";

export default function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StudioEmbed id={id} section="logs" title="Logs" />;
}
