# Tank ID Firestore Read-only Audit

## Purpose

This document records the read-only Firestore data audit plan for existing tank ID formats before connecting operation-side code to `src/lib/tank-id.ts`.

The audit is required because PR #89 made procurement registration write canonical IDs such as `A-01`, while PR #90 identified compatibility risks if existing production data still contains IDs such as `A01`, `A-100`, or non-standard suffixes.

After PR #92, `A-OK` is not an anomaly. It is the only reserved nonnumeric exception and must be classified as a valid OK exception. Arbitrary suffixes such as `A-NG`, `A-TEST`, and `A-SPARE` remain invalid.

After PR #93, this audit is explicitly a compatibility input before operation-side changes. `tanks` remains the source of truth for current tank state, `logs` remains the source of truth for past operation events and audit trails, and `transactions` remains the source of truth for workflow requests.

After PR #94, `A-00` is not an anomaly or blocker. It is a normal numeric tank ID with `number: 0`, and `A0` / `A00` / `A-00` normalize to `A-00`.

## Scope

The audit checks ID-like values only. It intentionally avoids business fields such as customer names, staff names, locations, notes, prices, or other unrelated data.

Collections in scope:

- `tanks` document ids
- `logs.tankId` and minimal log metadata needed for classification (`logKind`, `logStatus`)
- `transactions.tankId` / `transactions.tankIds` and minimal transaction metadata (`type`)

## Method

PR #91 adds `scripts/read-only-audit-tank-ids.mts`.

The script is intentionally read-only:

- `tanks` is read through `collection("tanks").listDocuments()` to inspect document ids.
- `logs` is read through `select("tankId", "logKind", "logStatus")`.
- `transactions` is read through `select("type", "tankId", "tankIds")`.
- The script does not import or call write APIs such as `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch`, or `runTransaction`.
- The script prints aggregate counts and small tankId examples only.

Because the repo does not have a TypeScript runner script and package files must not be changed, run it by compiling to an ignored local build directory:

```bash
npx tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --outDir .codex-logs/tank-id-firestore-audit-build scripts/read-only-audit-tank-ids.mts
node .codex-logs/tank-id-firestore-audit-build/read-only-audit-tank-ids.mjs
```

Credential options:

- Preferred: set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`.
- Local fallback: `./firebase-service-account.json` if present.

The credential must have read access to the production Firestore project `okmarine-tankrental`.

Service account JSON files and other credential files must stay local. Do not commit them, print their private key contents, or paste them into PRs / docs. The existing `.gitignore` excludes `firebase-service-account.json`, `*-firebase-adminsdk-*.json`, `.env*`, and generic `*.json` except allowed project metadata files.

For this audit, Firebase Admin SDK with a service account credential is the recommended execution path. Web SDK execution is not recommended for this audit because it depends on Firebase Auth login state and Security Rules, which makes it unsuitable for a deterministic production data-shape inventory.

## Credential and permission triage

If the script returns `PERMISSION_DENIED`, check the credential and IAM setup before changing code:

1. Confirm the credential belongs to the intended Firebase / Google Cloud project.
   - The expected project is `okmarine-tankrental`.
   - Check the local JSON `project_id` field without printing `private_key`.
2. Confirm the service account email is the expected audit or admin service account.
   - Check the local JSON `client_email` field.
   - Do not commit or paste the JSON file.
3. Confirm the service account has Firestore read permissions.
   - For a read-only audit, an IAM role such as Firestore / Datastore Viewer is expected to be sufficient.
   - If a narrower custom role is used, it must allow collection/document reads for `tanks`, `logs`, and `transactions`.
4. Confirm the Admin SDK initializes against the expected `projectId`.
   - `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` can override defaults.
   - The script falls back to `okmarine-tankrental`.
5. Confirm the expected Firestore database is being read.
   - The script currently uses the Admin SDK default Firestore database.
   - If the project uses a non-default database, the script must be adjusted deliberately before use.
6. Avoid using Web SDK as the primary audit path.
   - Web SDK reads can fail because of Security Rules or missing Firebase Auth state even when Admin SDK read access would be valid.
   - A Web SDK permission error does not prove the production data is unreadable by an authorized Admin SDK credential.

The credential issue is resolved as of the successful 2026-05-23 audit run. PR #91 should remain draft only until the team reviews the updated result and decides whether to accept it as the verification record.

## Safety constraints

- No Firestore data create/update/delete.
- No migration.
- No Hosting deploy.
- No Firestore deploy.
- No Security Rules deploy.
- No `firebase deploy`.
- No `firestore.rules`, `firebase.json`, or package file changes.
- No operation / manual operation / bulk return / return tag processing / portal / repository connection changes.

## Classification rules

The script classifies each tankId-like value into these buckets:

| Bucket | Example | Meaning |
|---|---|---|
| `canonical_numeric` | `A-00`, `A-01` | Current canonical numeric display form. |
| `compact_numeric` | `A00`, `A01` | No-hyphen 2-digit form. Helper would normalize to `A-00` / `A-01`. |
| `raw_numeric` | `A0`, `A1` | One-digit compact form. Helper would normalize to `A-00` / `A-01`. |
| `canonical_ok_exception` | `A-OK` | Valid reserved OK exception. |
| `compact_ok_exception` | `AOK` | Compact OK exception. Helper would normalize to `A-OK`. |
| `canonical_three_or_more_numeric` | `A-100` | Canonical 3+ digit form. Domain helper accepts it, but some operation UI does not yet. |
| `compact_three_or_more_numeric` | `A100` | No-hyphen 3+ digit form. Helper would normalize to `A-100`. |
| `helper_parseable_other` | `A-1` | Helper can parse it, but it is outside the primary display categories. |
| `arbitrary_suffix_invalid` | `A-NG` | Non-OK arbitrary suffix. Helper rejects it. |
| `invalid_helper_parse_unavailable` | `A-01 他1本` | Not parseable as a single structured tank ID. |
| `empty_or_missing` | missing | Empty or absent tankId field. |

The script also reports values that are parseable by the helper but would normalize to a different document id, such as `A01 -> A-01`.

## Execution status

Audit attempted on 2026-05-21.

Validation completed:

- `npx tsc --noEmit --pretty false` passed with the read-only script included.
- Temporary compile command to `.codex-logs/tank-id-firestore-audit-build` passed.

Execution attempts:

| Method | Result |
|---|---|
| Admin SDK, sandbox network | Failed before data read: DNS / Firestore API name resolution unavailable in sandbox. |
| Admin SDK, network allowed, local `firebase-service-account.json` | Failed before data read: `PERMISSION_DENIED: Missing or insufficient permissions`. |
| Web SDK using `.env.local` config, network allowed, `limit(1)` read | Failed before data read: `permission-denied`. |
| Admin SDK, network allowed, `GOOGLE_APPLICATION_CREDENTIALS` service account | Succeeded on 2026-05-23T04:58:33.891Z. |

Branch update on 2026-05-23:

- PR #91 branch was updated against latest `main` after PR #92 and PR #93.
- The audit script and this document now classify `A-OK` / `AOK` as the valid OK exception.
- Arbitrary suffixes such as `A-NG`, `A-TEST`, and `A-SPARE` remain invalid.
- No new Firestore read was executed during this branch update because `GOOGLE_APPLICATION_CREDENTIALS` was unset and the available local fallback credential had already failed with `PERMISSION_DENIED`.
- After PR #94, this branch was updated again so `A-00` is treated as valid canonical numeric data rather than an unresolved blocker.

Successful data audit on 2026-05-23:

- The script was run with `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account for `okmarine-tankrental`.
- The first sandboxed run failed with Firestore API DNS resolution failure, then the same read-only script succeeded with network access allowed.
- No Firestore data was created, updated, deleted, migrated, or deployed.

This PR should still remain draft until the team reviews the results and decides the operation-side compatibility policy.

## Collections checked

The script is prepared to check:

- `tanks`
- `logs`
- `transactions`

The successful run returned aggregate counts for all in-scope collections.

## Tanks document id results

Total `tanks` documents: 144.

| Category | Count | Examples / notes |
|---|---:|---|
| `canonical_numeric` | 143 | Includes the 142 existing positive numeric examples plus `A-00`. Other examples include `A-02`, `A-04`, `A-05`, `A-06`, `A-07`, `A-09`, `A-10`, `A-11`, `A-12`, `A-13`, `A-32`, `A-36`. |
| `compact_numeric` | 0 | No `A01` style ids found. |
| `raw_numeric` | 0 | No `A1` style ids found. |
| `canonical_ok_exception` | 1 | `A-OK`. |
| `compact_ok_exception` | 0 | No `AOK` style ids found. |
| `canonical_three_or_more_numeric` | 0 | No `A-100` style ids found. |
| `compact_three_or_more_numeric` | 0 | No `A100` style ids found. |
| `helper_parseable_other` | 0 | None found. |
| `arbitrary_suffix_invalid` | 0 | No `A-NG` / `A-TEST` style ids found. |
| `invalid_helper_parse_unavailable` | 0 | None found. |
| `empty_or_missing` | 0 | Not applicable for document ids. |

Parseable-but-different document ids: 0.

Main finding:

- There is no evidence of existing `A01` / `A1` / `A100` / `AOK` document ids in `tanks`.
- `A-OK` exists and is compatible with the PR #92 helper model.
- `A-00` exists and is compatible with the PR #94 helper model as canonical numeric `number: 0`.

## Logs tankId results

Total `logs` documents checked: 31.

| Category | Count | Examples / notes |
|---|---:|---|
| `canonical_numeric` | 31 | Examples include `F-32`, `F-12`, `F-43`, `F-14`, `F-16`, `F-13`, `D-40`, `F-34`. |
| all other categories | 0 | No compact, raw, OK exception, 3+ digit, arbitrary suffix, helper-unparseable, or missing tankId values found. |

Additional log checks:

- `byLogKind`: `tank` has 31 `canonical_numeric` records.
- Active tank lifecycle logs whose `logs.tankId` does not exactly match a current `tanks` document id: 0.
- Parseable-but-different `logs.tankId` values: 0.

## Transactions tankId-related results

Total `transactions` documents checked: 8.

| Category | Count | Examples / notes |
|---|---:|---|
| `canonical_numeric` | 4 | Examples include `F-32`, `F-12`. |
| `empty_or_missing` | 4 | Four transactions had no `tankId` / `tankIds` value in the checked fields. |
| all other categories | 0 | No compact, raw, OK exception, 3+ digit, arbitrary suffix, or helper-unparseable values found. |

Additional transaction checks:

- `fieldsSeen`: `tankId` 4, `none` 4.
- `byType`: `order` has 4 `empty_or_missing` records, `return` has 2 `canonical_numeric` records, and `uncharged_report` has 2 `canonical_numeric` records.

## Noncanonical examples

No noncanonical / helper-invalid values were found in the audited fields after applying the PR #94 rule that treats `A-00` as valid numeric data.

No `A01`, `A1`, `A100`, `AOK`, arbitrary suffix, or helper-unparseable values were found in the audited fields.

## OK exception / arbitrary suffix examples

`A-OK` exists as a `tanks` document id and should be treated as the valid OK exception.

No compact OK exception (`AOK`) values were found.

No arbitrary suffix values such as `A-NG`, `A-TEST`, or `A-SPARE` were found.

## Operation normalize risk

Do not connect `tank-operation.ts` to `src/lib/tank-id.ts` in this PR. The read-only audit has now run, but operation-side connection is still a separate implementation change.

Known connection risks to carry forward:

- if `tanks/A01` exists and operation input is normalized to `A-01`, exact reads of `tanks/A-01` will not find the existing `tanks/A01` document;
- if `logs.tankId` contains `A01` while `tanks` contains `A-01`, trace and history queries can split;
- if `A-100` exists, current manual/order input and `PrefixNumberPicker` may not be able to operate it;
- if `A-OK` exists, operation boundaries should treat it as the reserved OK exception;
- if arbitrary suffix ids such as `A-NG` exist, they need a legacy/special cleanup policy before helper connection.

The successful audit reduces the existing-ID compatibility risk:

- No `tanks/A01` document ids were found.
- No parseable-but-different `tanks` document ids were found.
- No active tank logs had `tankId` values missing from the current `tanks` document ids.
- `A-00` is now valid canonical numeric data after PR #94.

The remaining risks are implementation-scope risks, not current data-shape blockers:

- operation / UI / repository boundaries are not connected to `src/lib/tank-id.ts` yet;
- operation UI and picker controls still need an explicit 100+ handling decision before broad deployment of 100+ creation;
- future audits should be rerun if new import paths or manual data edits can introduce compact or arbitrary-suffix IDs.

## Recommendation before operation connection

Before any operation-side helper connection:

1. Treat `A-00` as normal canonical numeric data.
2. Keep `A-OK` as the only valid nonnumeric reserved exception.
3. Keep arbitrary suffixes invalid.
4. Decide whether procurement should temporarily block 100+ numeric ids until operation UI supports them, even though no existing `A-100` / `A100` ids were found.
5. Existing `A01` / `A1` / `A100` fallback reads are not supported by current evidence because no such `tanks` document ids were found. Add fallback only if a future audit finds those values.

The main existing-data blocker for operation-side normalization is now cleared. The operation connection still belongs in a separate implementation PR because it changes runtime behavior and touches operation / UI / repository boundaries.

PR #91 should move from draft to ready only after one of these happens:

- the team reviews the successful audit result and accepts PR #91 as the verification record;
- or the team decides to keep PR #91 draft until the operation connection plan is documented separately.

## Explicit non-goals

- No implementation behavior change.
- No Firestore data create/update/delete.
- No migration.
- No deploy.
- No `firestore.rules`, `firebase.json`, or package file changes.
- No operation / manual operation / bulk return / return tag processing / portal / repository connection.
- No billing / sales / reward behavior change.
