import {
  verifyLiveFirestoreRulesBaseline,
  type FirestoreRulesBaselineManifest,
  type VerifiedLiveFirestoreRulesBaseline,
} from "./firestore-rules-baseline";
import {
  assertDistinctCutoverPrincipals,
  verifyRulesReaderCredential,
} from "./migration-credential";

export type RulesBaselineRuntimeResult = VerifiedLiveFirestoreRulesBaseline & {
  credential: {
    kind: "rules_reader";
    expectedRulesPrincipalConfirmed: true;
    distinctFromDataPrincipalConfirmed: true;
    requiredPermissionsConfirmed: true;
    requiredPermissionCount: number;
  };
};

export type RulesBaselineRuntimeDependencies = {
  verifyRulesCredential?: typeof verifyRulesReaderCredential;
  verifyLiveBaseline?: typeof verifyLiveFirestoreRulesBaseline;
};

/** Rules reader credentialだけでlive Rules APIを検証するread-only runtime。 */
export async function runRulesBaselineRuntime(
  input: {
    projectId: string;
    expectedDataPrincipal: string;
    expectedRulesPrincipal: string;
    manifest: FirestoreRulesBaselineManifest;
    baselineSource: string;
    gitSource: string;
  },
  dependencies: RulesBaselineRuntimeDependencies = {},
): Promise<RulesBaselineRuntimeResult> {
  assertDistinctCutoverPrincipals({
    expectedDataPrincipal: input.expectedDataPrincipal,
    expectedRulesPrincipal: input.expectedRulesPrincipal,
  });
  const credential = await (
    dependencies.verifyRulesCredential ?? verifyRulesReaderCredential
  )({
    expectedRulesPrincipal: input.expectedRulesPrincipal,
    expectedProjectId: input.projectId,
  });
  const result = await (
    dependencies.verifyLiveBaseline ?? verifyLiveFirestoreRulesBaseline
  )({
    projectId: input.projectId,
    rulesReaderCredential: credential,
    manifest: input.manifest,
    baselineSource: input.baselineSource,
    gitSource: input.gitSource,
  });
  return {
    ...result,
    credential: {
      kind: credential.kind,
      expectedRulesPrincipalConfirmed: true,
      distinctFromDataPrincipalConfirmed: true,
      requiredPermissionsConfirmed: true,
      requiredPermissionCount: credential.permissions.length,
    },
  };
}
