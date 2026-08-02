"use client";

import type { AdminCapability } from "@/lib/admin/adminCapabilities";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";

export default function AdminCapabilityGate({
  capability,
  children,
  fallback = null,
}: {
  capability: AdminCapability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useAdminCapabilities();
  return can(capability) ? children : fallback;
}
