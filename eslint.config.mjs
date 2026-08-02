import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const ARCHITECTURE_TEST_IGNORES = [
  "src/**/*.test.ts",
  "src/**/*.test.tsx",
];

const FEATURE_NAMES = [
  "admin-customers",
  "admin-settings",
  "inhouse",
  "maintenance",
  "procurement",
  "staff-dashboard",
  "staff-operations",
];

const OPERATION_FEATURES = new Set([
  "inhouse",
  "maintenance",
  "staff-operations",
]);

const DOMAIN_CORE_FILES = [
  "src/lib/tank-operation.ts",
  "src/lib/tank-transition-policy.ts",
  "src/lib/tank-transition-projections.ts",
  "src/lib/tank-rules.ts",
  "src/lib/tank-action-status-codes.ts",
  "src/lib/tank-recovery-confirmation-validation.ts",
  "src/lib/tank-aggregation-revision.ts",
  "src/lib/tank-operation-limits.ts",
  "src/lib/tank-types.ts",
  "src/lib/tank-id.ts",
  "src/lib/customer-identity-read.ts",
  "src/lib/operation-context.ts",
  "src/lib/return-tag-rules.ts",
  "src/lib/billing-rules.ts",
  "src/lib/incentive-rules.ts",
  "src/lib/inspection-schedule.ts",
  "src/lib/inspection-settings.ts",
  "src/lib/portal/return-cycle-readiness.ts",
  "src/lib/billing/**",
  "src/lib/analytics/**",
];

const DOMAIN_UI_IMPORT_RESTRICTIONS = [{
  group: [
    "react",
    "react-dom",
    "next",
    "next/*",
    "@/hooks/*",
    "@/components/*",
    "@/app/*",
  ],
  message: "domain / adapter から React・Next・UI 層へ依存しないでください。",
}];

const DOMAIN_DISPLAY_IMPORT_RESTRICTIONS = [{
  group: [
    "@/lib/locale",
    "@/lib/staff-display",
    "@/lib/staff-operation-error",
    "@/lib/tank-recovery-confirmation-message",
    "@/lib/operation-messages",
    "@/lib/return-tag-labels",
    "@/lib/tank-action-status-labels",
    "@/lib/tank-action-status-display",
    "@/lib/order-types",
    "@/lib/admin/adminCapabilities",
    "@/lib/admin/adminPagesRegistry",
    "@/lib/admin/adminSectionTabs",
    "@/lib/admin/adminSettingsPresentation",
    "@/lib/admin/securityRulesOverview",
    "@/features/*/i18n",
    "@/features/*/*-i18n",
    "@/features/*/constants",
    "@/features/staff-operations/bulk-return-display",
    "./locale",
    "../locale",
    "./staff-display",
    "../staff-display",
    "./staff-operation-error",
    "../staff-operation-error",
    "./tank-recovery-confirmation-message",
    "../tank-recovery-confirmation-message",
    "./operation-messages",
    "../operation-messages",
    "./return-tag-labels",
    "../return-tag-labels",
    "./tank-action-status-labels",
    "../tank-action-status-labels",
    "./tank-action-status-display",
    "../tank-action-status-display",
    "./order-types",
    "../order-types",
  ],
  message: "domain core から locale・display boundary へ依存しないでください。",
}];

const OPERATION_BILLING_IMPORT_RESTRICTIONS = [{
  group: ["@/lib/billing/*"],
  message: "operation 層から billing 層へ依存しないでください。",
}];

const READ_MODEL_WRITE_IMPORT_RESTRICTIONS = [
  {
    group: ["@/lib/tank-operation"],
    allowTypeImports: true,
    message: "billing・analytics・read model から tank operation へ依存しないでください。",
  },
  {
    group: ["@/features/*/services/*"],
    allowTypeImports: true,
    message: "billing・analytics・read model から write workflow へ依存しないでください。",
  },
  {
    group: ["@/lib/firebase/*-service"],
    allowImportNames: ["listActiveCustomerSnapshots"],
    allowTypeImports: true,
    message: "billing・analytics・read model から Firebase write service へ依存しないでください。",
  },
];

const FIRESTORE_WRITE_PATH_RESTRICTIONS = [{
  name: "firebase/firestore",
  importNames: [
    "setDoc",
    "updateDoc",
    "addDoc",
    "deleteDoc",
    "runTransaction",
    "writeBatch",
  ],
  message: "page・component・hook から Firestore write SDK を直接使用しないでください。",
}];

function restrictedImports(patterns, paths = []) {
  return [
    "error",
    {
      ...(paths.length > 0 ? { paths } : {}),
      ...(patterns.length > 0 ? { patterns } : {}),
    },
  ];
}

function featureImportRestrictions(featureName) {
  const otherFeatures = FEATURE_NAMES.filter((name) => name !== featureName);
  const restrictions = [{
    group: otherFeatures.map((name) => `@/features/${name}/*`),
    message: "feature 間を直接 import せず、composition 層で組み合わせてください。",
  }];

  if (OPERATION_FEATURES.has(featureName)) {
    restrictions.push(...OPERATION_BILLING_IMPORT_RESTRICTIONS);
  }

  return restrictions;
}

const featureZoneConfigs = FEATURE_NAMES.flatMap((featureName) => {
  const featureRestrictions = featureImportRestrictions(featureName);

  return [
    {
      files: [`src/features/${featureName}/**`],
      ignores: ARCHITECTURE_TEST_IGNORES,
      rules: {
        "no-restricted-imports": restrictedImports(featureRestrictions),
      },
    },
    {
      files: [`src/features/${featureName}/queries/**`],
      ignores: ARCHITECTURE_TEST_IGNORES,
      rules: {
        "no-restricted-imports": restrictedImports([
          ...featureRestrictions,
          ...READ_MODEL_WRITE_IMPORT_RESTRICTIONS,
        ]),
      },
    },
    {
      files: [
        `src/features/${featureName}/components/**`,
        `src/features/${featureName}/hooks/**`,
      ],
      ignores: ARCHITECTURE_TEST_IGNORES,
      rules: {
        "no-restricted-imports": restrictedImports(
          featureRestrictions,
          FIRESTORE_WRITE_PATH_RESTRICTIONS,
        ),
      },
    },
  ];
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/lib/**"],
    ignores: ARCHITECTURE_TEST_IGNORES,
    rules: {
      "no-restricted-imports": restrictedImports(DOMAIN_UI_IMPORT_RESTRICTIONS),
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
      ],
    },
  },
  {
    files: DOMAIN_CORE_FILES,
    ignores: ARCHITECTURE_TEST_IGNORES,
    rules: {
      "no-restricted-imports": restrictedImports([
        ...DOMAIN_UI_IMPORT_RESTRICTIONS,
        ...DOMAIN_DISPLAY_IMPORT_RESTRICTIONS,
      ]),
    },
  },
  {
    files: ["src/lib/billing/**", "src/lib/analytics/**"],
    ignores: ARCHITECTURE_TEST_IGNORES,
    rules: {
      "no-restricted-imports": restrictedImports([
        ...DOMAIN_UI_IMPORT_RESTRICTIONS,
        ...DOMAIN_DISPLAY_IMPORT_RESTRICTIONS,
        ...READ_MODEL_WRITE_IMPORT_RESTRICTIONS,
      ]),
    },
  },
  {
    files: ["src/lib/tank-operation.ts"],
    ignores: ARCHITECTURE_TEST_IGNORES,
    rules: {
      "no-restricted-imports": restrictedImports([
        ...DOMAIN_UI_IMPORT_RESTRICTIONS,
        ...DOMAIN_DISPLAY_IMPORT_RESTRICTIONS,
        ...OPERATION_BILLING_IMPORT_RESTRICTIONS,
      ]),
    },
  },
  ...featureZoneConfigs,
  {
    files: ["src/app/**", "src/components/**", "src/hooks/**"],
    ignores: ARCHITECTURE_TEST_IGNORES,
    rules: {
      "no-restricted-imports": restrictedImports(
        [],
        FIRESTORE_WRITE_PATH_RESTRICTIONS,
      ),
    },
  },
  // Architecture allowlist: 1エントリを1ファイルに限定し、解消時はここから削除する。
  // 暫定: P1-A で解消。@/hooks/useStaffSession・確認表示2 module・window のみ許可する。
  {
    files: ["src/lib/tank-operation.ts"],
    rules: {
      "no-restricted-imports": restrictedImports([
        {
          ...DOMAIN_UI_IMPORT_RESTRICTIONS[0],
          group: [
            ...DOMAIN_UI_IMPORT_RESTRICTIONS[0].group,
            "!@/hooks/useStaffSession",
          ],
        },
        {
          ...DOMAIN_DISPLAY_IMPORT_RESTRICTIONS[0],
          group: [
            ...DOMAIN_DISPLAY_IMPORT_RESTRICTIONS[0].group,
            "!./tank-recovery-confirmation-message",
            "!./staff-operation-error",
          ],
        },
        ...OPERATION_BILLING_IMPORT_RESTRICTIONS,
      ]),
      "no-restricted-globals": [
        "error",
        "document",
        "localStorage",
        "sessionStorage",
      ],
    },
  },
  // 暫定: P1-A で解消。@/hooks/useStaffSession のみ許可する。
  {
    files: ["src/lib/firebase/staff-locale-service.ts"],
    rules: {
      "no-restricted-imports": restrictedImports([{
        ...DOMAIN_UI_IMPORT_RESTRICTIONS[0],
        group: [
          ...DOMAIN_UI_IMPORT_RESTRICTIONS[0].group,
          "!@/hooks/useStaffSession",
        ],
      }]),
    },
  },
  // 意図的例外: portal session adapter。window・localStorage のみ許可する。design-principles §25。
  {
    files: ["src/lib/portal/identity.ts"],
    rules: {
      "no-restricted-globals": ["error", "document", "sessionStorage"],
    },
  },
  // 意図的例外: portal session adapter。window・localStorage のみ許可する。design-principles §25。
  {
    files: ["src/lib/firebase/customer-user.ts"],
    rules: {
      "no-restricted-globals": ["error", "document", "sessionStorage"],
    },
  },
]);

export default eslintConfig;
