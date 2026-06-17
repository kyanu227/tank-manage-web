import { logsRepository, tanksRepository } from "@/lib/firebase/repositories";
import type { LogDoc, TankDoc } from "@/lib/firebase/repositories";
import type { LinkedPortalIdentity } from "@/lib/portal";

const PORTAL_LENT_STATUS = "lent";

type PortalCustomerIdentity = Pick<
  LinkedPortalIdentity,
  "customerId" | "customerName"
>;

function normalizePortalCustomerIdentity(
  identity: PortalCustomerIdentity,
): PortalCustomerIdentity | null {
  const customerId = identity.customerId.trim();
  const customerName = identity.customerName.trim();

  if (!customerId || !customerName) return null;
  return { customerId, customerName };
}

function mergeTanksById(primary: TankDoc[], fallback: TankDoc[]): TankDoc[] {
  const merged = new Map<string, TankDoc>();

  primary.forEach((tank) => {
    merged.set(tank.id, tank);
  });
  fallback.forEach((tank) => {
    if (!merged.has(tank.id)) merged.set(tank.id, tank);
  });

  return Array.from(merged.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function mergeLogsById(primary: LogDoc[], fallback: LogDoc[]): LogDoc[] {
  const merged = new Map<string, LogDoc>();

  primary.forEach((log) => {
    merged.set(log.id, log);
  });
  fallback.forEach((log) => {
    if (!merged.has(log.id)) merged.set(log.id, log);
  });

  return Array.from(merged.values());
}

function logTimestampMillis(log: LogDoc): number {
  const timestamp = log.timestamp;
  if (!timestamp) return 0;
  return timestamp.toMillis();
}

export async function getPortalCurrentLentTanks(
  identity: PortalCustomerIdentity,
): Promise<TankDoc[]> {
  const normalized = normalizePortalCustomerIdentity(identity);
  if (!normalized) return [];

  const [primaryTanks, legacyTanks] = await Promise.all([
    tanksRepository.getTanks({ customerId: normalized.customerId }),
    tanksRepository.getTanks({
      location: normalized.customerName,
      status: PORTAL_LENT_STATUS,
    }),
  ]);

  return mergeTanksById(
    primaryTanks.filter((tank) => tank.status === PORTAL_LENT_STATUS),
    legacyTanks,
  );
}

export async function getPortalRecentLogs(
  identity: PortalCustomerIdentity,
  limit: number,
): Promise<LogDoc[]> {
  const normalized = normalizePortalCustomerIdentity(identity);
  if (!normalized) return [];

  const [primaryLogs, legacyLogs] = await Promise.all([
    logsRepository.getActiveLogsByCustomerId(normalized.customerId, { limit }),
    logsRepository.getActiveLogs({
      location: normalized.customerName,
      limit,
    }),
  ]);

  return mergeLogsById(primaryLogs, legacyLogs)
    .sort((a, b) => logTimestampMillis(b) - logTimestampMillis(a))
    .slice(0, limit);
}
