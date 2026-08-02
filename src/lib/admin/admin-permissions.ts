import {
  ALL_ADMIN_CAPABILITIES,
  isAdminCapability,
  type AdminCapability,
} from "@/lib/admin/adminCapabilities";
import { LEGACY_ADMIN_PATH_CAPABILITY_MAP } from "@/lib/admin/adminPagesRegistry";

export type AdminCapabilityGrants = Readonly<
  Partial<Record<AdminCapability, readonly string[]>>
>;

export type AdminPermissionsDecodeResult =
  | {
      kind: "valid";
      capabilities: AdminCapabilityGrants;
      source: "capabilities" | "legacy-paths";
      ignoredLegacyPaths: readonly string[];
    }
  | { kind: "missing" }
  | { kind: "malformed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeRoleMap(
  rawMap: unknown,
  keyLabel: string,
): { kind: "valid"; values: Readonly<Record<string, readonly string[]>> }
  | { kind: "malformed"; reason: string } {
  if (!isRecord(rawMap)) {
    return { kind: "malformed", reason: `${keyLabel} must be an object` };
  }

  const values: Record<string, readonly string[]> = {};
  for (const [key, rawRoles] of Object.entries(rawMap)) {
    if (!Array.isArray(rawRoles)) {
      return { kind: "malformed", reason: `${keyLabel}[${JSON.stringify(key)}] must be an array` };
    }

    const roles: string[] = [];
    for (const rawRole of rawRoles) {
      if (typeof rawRole !== "string") {
        return {
          kind: "malformed",
          reason: `${keyLabel}[${JSON.stringify(key)}] must contain only strings`,
        };
      }
      roles.push(rawRole);
    }
    values[key] = roles;
  }

  return { kind: "valid", values };
}

export function convertLegacyAdminPathPermissions(
  pages: Readonly<Record<string, readonly string[]>>,
): {
  capabilities: AdminCapabilityGrants;
  ignoredLegacyPaths: readonly string[];
} {
  const grants = new Map<AdminCapability, Set<string>>();
  const ignoredLegacyPaths: string[] = [];

  Object.entries(pages).forEach(([path, roles]) => {
    const capabilities = LEGACY_ADMIN_PATH_CAPABILITY_MAP[path];
    if (!capabilities) {
      ignoredLegacyPaths.push(path);
      return;
    }

    capabilities.forEach((capability) => {
      const roleSet = grants.get(capability) ?? new Set<string>();
      roles.forEach((role) => roleSet.add(role));
      grants.set(capability, roleSet);
    });
  });

  const capabilities: Partial<Record<AdminCapability, readonly string[]>> = {};
  ALL_ADMIN_CAPABILITIES.forEach((capability) => {
    const roles = grants.get(capability);
    if (roles && roles.size > 0) capabilities[capability] = [...roles];
  });

  return { capabilities, ignoredLegacyPaths };
}

export function decodeAdminPermissions(raw: unknown): AdminPermissionsDecodeResult {
  if (raw === undefined) return { kind: "missing" };
  if (!isRecord(raw)) {
    return { kind: "malformed", reason: "document must be an object" };
  }

  if (Object.prototype.hasOwnProperty.call(raw, "capabilities")) {
    const decoded = decodeRoleMap(raw.capabilities, "capabilities");
    if (decoded.kind === "malformed") return decoded;

    const capabilities: Partial<Record<AdminCapability, readonly string[]>> = {};
    for (const [key, roles] of Object.entries(decoded.values)) {
      if (!isAdminCapability(key)) {
        return { kind: "malformed", reason: `unknown capability: ${JSON.stringify(key)}` };
      }
      capabilities[key] = roles;
    }
    return {
      kind: "valid",
      capabilities,
      source: "capabilities",
      ignoredLegacyPaths: [],
    };
  }

  if (Object.prototype.hasOwnProperty.call(raw, "pages")) {
    const decoded = decodeRoleMap(raw.pages, "pages");
    if (decoded.kind === "malformed") return decoded;
    const converted = convertLegacyAdminPathPermissions(decoded.values);
    return {
      kind: "valid",
      capabilities: converted.capabilities,
      source: "legacy-paths",
      ignoredLegacyPaths: converted.ignoredLegacyPaths,
    };
  }

  return { kind: "malformed", reason: "capabilities or legacy pages property is required" };
}

export function normalizeAdminCapabilityGrantsForSave(
  grants: AdminCapabilityGrants,
): AdminCapabilityGrants {
  const normalized: Partial<Record<AdminCapability, readonly string[]>> = {};
  ALL_ADMIN_CAPABILITIES.forEach((capability) => {
    const roles = grants[capability] ?? [];
    normalized[capability] = [
      "管理者",
      ...(roles.some((role) => role === "準管理者") ? ["準管理者"] : []),
    ];
  });
  return normalized;
}

export function isRoleAllowed(roles: readonly string[], role: string): boolean {
  return roles.some((candidate) => candidate === role);
}
