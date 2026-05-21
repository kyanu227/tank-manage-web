# Tank ID Firestore Read-only Audit

## Purpose

This document records the read-only Firestore data audit plan for existing tank ID formats before connecting operation-side code to `src/lib/tank-id.ts`.

The audit is required because PR #89 made procurement registration write canonical IDs such as `A-01`, while PR #90 identified compatibility risks if existing production data still contains IDs such as `A01`, `A-100`, or `A-OK`.

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
| `canonical_hyphen_numeric` | `A-01` | Current canonical 2-digit display form. |
| `compact_numeric` | `A01` | No-hyphen 2-digit form. Helper would normalize to `A-01`. |
| `raw_no_zero` | `A1` | One-digit no-zero form. Helper would normalize to `A-01`. |
| `canonical_three_or_more` | `A-100` | Canonical 3+ digit form. Domain helper accepts it, but some operation UI does not yet. |
| `compact_three_or_more` | `A100` | No-hyphen 3+ digit form. Helper would normalize to `A-100`. |
| `helper_parseable_other` | `A-1` | Helper can parse it, but it is outside the primary display categories. |
| `zero_number_invalid` | `A-00` | Numeric model rejects zero. |
| `nonnumeric_special` | `A-OK` | Outside the prefix + positive number model. |
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

No Firestore data was created, updated, deleted, migrated, or deployed. No aggregate production counts were obtained in this run because both available credential paths lacked read permission.

## Collections checked

The script is prepared to check:

- `tanks`
- `logs`
- `transactions`

However, because the available credentials were denied before data was returned, the current PR does not contain production counts.

## Tanks document id results

Not available from this execution. Firestore read permission is required.

The next successful run should report:

- count of canonical hyphen numeric ids such as `A-01`;
- count of compact ids such as `A01`;
- count of raw no-zero ids such as `A1`;
- count of 3+ digit ids such as `A-100` and `A100`;
- count of nonnumeric / special ids such as `A-OK`;
- count of helper-parseable ids that would normalize to a different document id.

## Logs tankId results

Not available from this execution. Firestore read permission is required.

The next successful run should report:

- `logs.tankId` format counts;
- counts by `logKind`;
- active tank lifecycle logs whose `logs.tankId` does not exactly match a current `tanks` document id;
- examples of summary / non-single-tank values, especially procurement logs such as `A-01 他N本`.

## Transactions tankId-related results

Not available from this execution. Firestore read permission is required.

The next successful run should report:

- `transactions.tankId` format counts;
- `transactions.tankIds[]` format counts if present;
- counts by `transactions.type`;
- nonnumeric or helper-unparseable examples.

## Noncanonical examples

Not available from this execution. The script is prepared to show minimal tankId examples only, capped per category.

## Nonnumeric / special examples

Not available from this execution. This remains important because `A-OK` is outside the prefix + number helper model.

## Operation normalize risk

Do not connect `tank-operation.ts` to `src/lib/tank-id.ts` until the read-only audit has successfully run.

The critical risk remains:

- if `tanks/A01` exists and operation input is normalized to `A-01`, exact reads of `tanks/A-01` will not find the existing `tanks/A01` document;
- if `logs.tankId` contains `A01` while `tanks` contains `A-01`, trace and history queries can split;
- if `A-100` exists, current manual/order input and `PrefixNumberPicker` may not be able to operate it;
- if `A-OK` or another nonnumeric ID exists, it needs a legacy/special ID policy before numeric helper connection.

## Recommendation before operation connection

Before any operation-side helper connection:

1. Obtain a read-only credential for production Firestore.
2. Re-run `scripts/read-only-audit-tank-ids.mts`.
3. Record the aggregate counts in this document or a follow-up verification document.
4. Decide whether existing data requires:
   - no migration because all active IDs are already canonical;
   - compatibility reads such as canonical-first plus legacy fallback;
   - a separate Firestore data migration plan;
   - a temporary procurement creation limit until operation UI supports 100+ IDs.

Until this data audit succeeds, operation-side normalization should remain blocked.

## Explicit non-goals

- No implementation behavior change.
- No Firestore data create/update/delete.
- No migration.
- No deploy.
- No `firestore.rules`, `firebase.json`, or package file changes.
- No operation / manual operation / bulk return / return tag processing / portal / repository connection.
- No billing / sales / reward behavior change.
