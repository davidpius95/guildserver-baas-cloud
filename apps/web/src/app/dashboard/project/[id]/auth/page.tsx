"use client";

import { use } from "react";
import StudioEmbed from "@/components/StudioEmbed";

export default function AuthenticationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StudioEmbed id={id} section="auth" title="Authentication" />;
}
