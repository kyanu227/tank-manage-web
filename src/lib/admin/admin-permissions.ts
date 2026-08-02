export type AdminPermissionPages = Readonly<Record<string, readonly string[]>>;

export type AdminPermissionsDecodeResult =
  | { kind: "valid"; pages: AdminPermissionPages }
  | { kind: "missing" }
  | { kind: "malformed"; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeAdminPermissions(raw: unknown): AdminPermissionsDecodeResult {
  if (!isRecord(raw)) {
    return { kind: "missing" };
  }

  if (!Object.prototype.hasOwnProperty.call(raw, "pages")) {
    return { kind: "malformed", reason: "pages property is missing" };
  }

  const rawPages = raw.pages;
  if (!isRecord(rawPages)) {
    return { kind: "malformed", reason: "pages must be an object" };
  }

  const pages: Record<string, readonly string[]> = {};
  for (const [path, rawRoles] of Object.entries(rawPages)) {
    if (!Array.isArray(rawRoles)) {
      return { kind: "malformed", reason: `pages[${JSON.stringify(path)}] must be an array` };
    }

    const roles: string[] = [];
    for (const rawRole of rawRoles) {
      if (typeof rawRole !== "string") {
        return {
          kind: "malformed",
          reason: `pages[${JSON.stringify(path)}] must contain only strings`,
        };
      }
      roles.push(rawRole);
    }
    pages[path] = roles;
  }

  return { kind: "valid", pages };
}

export function isRoleAllowed(roles: readonly string[], role: string): boolean {
  return roles.some((candidate) => candidate === role);
}
