const KEYCHAIN_SERVICE = "tank-manage-cutover";

export function snapshotKeychainIdentity(projectId: string, keyId: string): {
  service: string;
  account: string;
} {
  return {
    service: KEYCHAIN_SERVICE,
    account: `${projectId}:${keyId}`,
  };
}
