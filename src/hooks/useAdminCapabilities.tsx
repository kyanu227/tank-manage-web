"use client";

import { createContext, useContext } from "react";
import {
  hasAdminCapability,
  type AdminCapability,
} from "@/lib/admin/adminCapabilities";

export type AdminCapabilitiesContextValue = {
  role: string;
  capabilities: readonly AdminCapability[];
};

const AdminCapabilitiesContext = createContext<AdminCapabilitiesContextValue>({
  role: "",
  capabilities: [],
});

export function AdminCapabilitiesProvider({
  value,
  children,
}: {
  value: AdminCapabilitiesContextValue;
  children: React.ReactNode;
}) {
  return (
    <AdminCapabilitiesContext.Provider value={value}>
      {children}
    </AdminCapabilitiesContext.Provider>
  );
}

export function useAdminCapabilities(): AdminCapabilitiesContextValue & {
  can: (capability: AdminCapability) => boolean;
} {
  const value = useContext(AdminCapabilitiesContext);
  return {
    ...value,
    can: (capability) => hasAdminCapability(value.capabilities, capability),
  };
}
