"use client";

import AdminSettingsPageShell from "@/components/admin/AdminSettingsPageShell";
import BusinessRulesSettings from "@/features/admin-settings/components/BusinessRulesSettings";

export default function SettingsPage() {
  return (
    <AdminSettingsPageShell activeTab="businessRules">
      <BusinessRulesSettings />
    </AdminSettingsPageShell>
  );
}
