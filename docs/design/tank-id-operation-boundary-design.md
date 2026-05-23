# Tank ID Operation Boundary Design

## Purpose

This document defines where operation-side tank ID validation and normalization should happen before connecting `src/lib/tank-id.ts` to staff operation flows.

The goal is to avoid another broad, implicit meaning for `tankId`. UI may keep raw input while a user is typing, but confirmed operation data should become a canonical tank identity before it is used for lookup, queuing, logging, or writes.

This is a docs-only design note. It does not change implementation code, Firestore data, migration scripts, security rules, package files, or deploy configuration.

## Current context

The current `tankId` work is split across these merged changes:

| PR | Status | Meaning |
|---|---|---|
| #87 | merged | Added tank ID audit / design docs. |
| #88 | merged | Added pure helpers in `src/lib/tank-id.ts`. |
| #89 | merged | Connected procurement / tank registration to the helper. Hosting deploy has not been run. |
| #90 | merged | Added operation-side compatibility audit before helper connection. |
| #91 | merged | Added Firestore read-only audit results for existing tank ID formats. |
| #92 | merged | Made `A-OK` the only reserved nonnumeric exception. |
| #93 | merged | Documented collection source-of-truth responsibilities. |
| #94 | merged | Made `A-00` a valid numeric ID, not a blocker or exception. |

The current canonical model is:

- numeric tank IDs are `Prefix-number`;
- numeric `number >= 0` is valid;
- numeric display uses at least two digits;
- `A0`, `A00`, `A-00`, and `a-00` normalize to `A-00`;
- `A1`, `A01`, `A-01`, and `A001` normalize to `A-01`;
- `A100` and `A-100` normalize to `A-100`;
- `AOK`, `A-OK`, and `a-ok` normalize to `A-OK`;
- `OK` is the only valid nonnumeric suffix;
- arbitrary suffixes such as `A-NG`, `A-TEST`, and `A-SPARE` are invalid.

## Audit findings from PR #91

The read-only Firestore audit found that existing production data is already close to the canonical model.

| Area | Result |
|---|---|
| `tanks` total | 144 |
| `tanks` canonical numeric | 143 |
| `tanks` valid OK exception | 1 |
| `tanks` compact legacy such as `A01` | 0 |
| `tanks` raw numeric such as `A1` | 0 |
| `tanks` compact 100+ such as `A100` | 0 |
| `tanks` compact OK such as `AOK` | 0 |
| `tanks` arbitrary suffix / parse unavailable | 0 |
| `logs` total | 31, all canonical numeric |
| `transactions` total | 8 |
| `transactions` canonical numeric | 4 |
| `transactions` missing tankId | 4 |

The important conclusion is that an `A01` legacy fallback is not currently required by observed data. The remaining risks are no longer existing-ID compatibility blockers; they are implementation boundary risks in operation UI, hooks, repositories, and future 100+ support.

## Operation entry points

| Entry point | Current tankId source | Current shape | Boundary risk |
|---|---|---|---|
| Manual operation | `useManualTankOperation` composes `activePrefix` + hidden numeric input, or `OK` | `A-00` through `A-99`, `A-OK` | Free/composed input should be normalized before queueing and before `tankMap` lookup. Current input cannot enter 100+. |
| Order fulfillment | `useOrderFulfillment` composes `orderActivePrefix` + hidden numeric input, or `OK` | `A-00` through `A-99`, `A-OK` | Same as manual operation. It should canonicalize before duplicate checks, tank lookup, and order quantity checks. |
| Shared `TankIdInput` consumers | `TankIdInput` emits prefix + numeric input, default `digits=2`, or `OK` | `A-00` through `A-99`, `A-OK` by default | Damage / in-house flows should not reimplement tank ID validation with local regex. |
| Damage report | `TankIdInput` result is queued and later sent to bulk operation | `A-00` through `A-99`, `A-OK` | Needs confirmed canonical ID at queue boundary. |
| In-house operation | `TankIdInput` plus local regex and `tankMap[tankId]` lookup | `A-00` through `A-99`, `A-OK` only | Local regex should eventually be replaced with helper validation. |
| Bulk return by location | Uses existing `TankDoc.id` from Firestore lists | Existing document ID | It is list-driven and already preserves canonical IDs. It should not invent new normalization rules. |
| Return tag processing | Uses `transactions.items[].tankId` / `transactions.tankId`, then exact `tanksRepository.getTank` | Existing transaction value | The safe boundary is transaction creation / approval, not an implicit repository rewrite. |
| Repair / inspection | Mostly list-driven `tank.id` from Firestore | Existing document ID | Low normalization risk. Preserve existing canonical ID. |
| Portal return | User selects currently lent `tank.id` from list | Existing document ID | Low normalization risk. It should continue sending canonical IDs selected from Firestore. |
| Portal unfilled | `PrefixNumberPicker` selects from existing lent tank IDs | Existing ID, but picker parses two digits only | 100+ tanks would be hidden until picker supports variable digits. |
| Dashboard correction | `PrefixNumberPicker` selects from existing tank IDs | Existing ID, but picker parses two digits only | Correction affects revision / snapshots and should be handled after simpler operation paths. |
| Dashboard void | Starts from existing log and tank snapshots | Historical `logs.tankId` | Must preserve exact historical chain semantics. Do not normalize old log IDs blindly. |

## Boundary options

### UI input boundary

UI components should help users type valid IDs and show validation messages, but UI should not be the only correctness boundary.

UI state may keep raw strings such as `numberInput: "01"` while a user is typing. This is not a source-of-truth value. Once the user confirms a tank ID, the next layer should parse and normalize it with `src/lib/tank-id.ts`.

UI should not maintain its own competing rules such as custom `^[A-Z]+-(\d{2}|OK)$` checks after helper connection.

### Hook / workflow boundary

The hook or workflow layer is the recommended primary boundary for operation input.

Examples:

- `useManualTankOperation.addToQueue`
- `useOrderFulfillment.addScannedTank`
- damage queue add
- in-house single operation add
- portal transaction creation when the value comes from an input rather than an existing tank list

This layer can:

- convert confirmed input to `canonicalTankId`;
- dedupe by canonical ID;
- perform `tankMap[canonicalTankId]` lookup;
- pass canonical IDs to operation services;
- keep UI error messages close to the user action.

### `tank-operation.ts` boundary

`tank-operation.ts` should eventually become a defensive final boundary for tank lifecycle writes. It writes `tanks` and `logs` together, so it is the last place to ensure lifecycle operations are using canonical tank IDs.

However, it should not be changed first in isolation. It affects manual operation, order fulfillment, damage, repair, inspection, in-house, bulk return, return tag processing, dashboard correction, and void / revision behavior.

When it is updated, the important distinction is:

- new operation inputs should be canonicalized defensively;
- historical log IDs used for void / revision restore should not be reinterpreted blindly;
- correction that moves a log to a new tank should normalize the new target, while preserving exact old snapshot references.

### Repository boundary

Repositories should generally expect canonical IDs.

Do not silently normalize every `tanksRepository.getTank` or `logsRepository.getActiveLogsByTank` call. Silent normalization hides migration problems, makes exact historical lookups harder to reason about, and can blur the difference between raw input handling and canonical data access.

The caller that crosses from UI / workflow code into repository or operation service code is responsible for providing a canonical ID. For composed operation inputs, that caller is normally the hook / workflow layer. For list-driven flows, the canonical guarantee comes from selecting an existing `TankDoc.id` loaded from Firestore.

If a compatibility read is ever needed, it should be explicit, for example:

- canonical lookup first;
- optional legacy fallback only where documented;
- return metadata showing whether fallback was used.

PR #91 indicates that such fallback is not currently needed for existing production data.

## Recommended boundary

The recommended boundary model is:

1. UI keeps input-progress strings and may use helper validation for user feedback.
2. Hook / workflow layer normalizes confirmed tank IDs before queueing, dedupe, lookup, and operation submission.
3. `tank-operation.ts` later performs defensive normalization for new lifecycle operation inputs.
4. Repositories accept canonical IDs and do not silently rewrite caller input.
5. List-driven flows preserve `TankDoc.id` selected from Firestore.

This means the canonical ID is introduced before business validation, not after writes. A queued operation item should hold `tankId: "A-00"`, `tankId: "A-01"`, or `tankId: "A-OK"`, not raw input such as `A0`, `A01`, or `a-ok`.

## Canonical guarantee before repository and operation calls

Because repositories should not silently normalize, each operation workflow must make the canonical guarantee explicit before it calls repositories or operation services.

| Flow type | Canonical guarantee owner | Expected handoff |
|---|---|---|
| Manual operation | `useManualTankOperation` at add-to-queue / submit boundary | Queue item and `applyBulkTankOperations` input use canonical `tankId`. |
| Order fulfillment | `useOrderFulfillment` at scanned-tank add boundary | Scanned item, duplicate check, quantity check, and operation input use canonical `tankId`. |
| Damage / in-house `TankIdInput` flows | Page or hook that accepts the confirmed `TankIdInput` value | Local queue / single operation uses canonical `tankId`; local regex is not the long-term authority. |
| Return tag processing | Transaction creation / approval workflow that writes or consumes `transactions.tankId` | Processing service receives canonical tank IDs from transaction data. |
| Bulk return / repair / inspection / portal return | Firestore list selection | Existing `TankDoc.id` is already the canonical handoff value. |
| Dashboard correction | Correction workflow before creating a new revision | New target tank ID is canonical; historical old log ID remains exact. |

After this boundary, downstream code should be allowed to assume canonical ID shape. `tank-operation.ts` can still add defensive normalization later, but that is a final guard, not a replacement for workflow-level ownership.

## Invalid input policy

Invalid input should be stopped before it reaches tank state writes.

| Input class | Policy |
|---|---|
| `A0`, `A00`, `A-00` | Valid numeric, normalize to `A-00`. |
| `A1`, `A01`, `A-01`, `A001` | Valid numeric, normalize to `A-01`. |
| `AOK`, `A-OK`, `a-ok` | Valid reserved OK exception, normalize to `A-OK`. |
| `A-NG`, `A-TEST`, `A-SPARE` | Invalid arbitrary suffix. |
| `A-0K`, `A-O K`, `A--01`, `A01B`, `A-01-2` | Invalid malformed ID. |
| empty / prefix-only / number-only | Invalid incomplete ID. |

UI messages can explain what the user should enter, but `src/lib/tank-id.ts` should remain the source for parse / normalize / validate rules.

## A-00 / A-OK policy

`A-00` and `A-OK` are both valid, but they have different meanings in the model.

| ID | Classification | Internal meaning |
|---|---|---|
| `A-00` | canonical numeric | `{ prefix: "A", kind: "numeric", number: 0 }` |
| `A-OK` | canonical reserved exception | `{ prefix: "A", kind: "ok" }` |

`A-00` sorts before `A-01`. `A-OK` sorts after numeric IDs for the same prefix.

Operation code should not special-case `00` as an exception. Operation code may need an explicit OK action shortcut in UI, but the confirmed value should still be normalized through the helper.

## 100+ policy

The domain helper intentionally allows 100+ tank numbers so the model does not break when the fleet grows.

Current operation UI is still mostly 2-digit oriented:

- manual operation hidden numeric entry commits at 2 digits;
- order fulfillment hidden numeric entry commits at 2 digits;
- `TankIdInput` defaults to `digits=2`;
- `PrefixNumberPicker` currently parses exactly two digits;
- in-house has a local two-digit-or-OK regex.

Current operation policy:

- do not introduce 100+ IDs through normal operations yet;
- keep helper/domain support for 100+;
- treat 100+ UI / picker support as a future implementation note, not a blocker for connecting current 00-99 / OK operation flows;
- before operationally using `A-100` or higher, update the input and picker components to support variable-length numeric IDs.

## logs.tankId policy

Lifecycle operation logs should store the canonical tank ID as `logs.tankId`.

Examples:

- `A0` input becomes `logs.tankId = "A-00"`;
- `A01` input becomes `logs.tankId = "A-01"`;
- `a-ok` input becomes `logs.tankId = "A-OK"`.

Do not add `logs.prefix`, `logs.number`, or `logs.sortKey` as duplicated operation data. Those are tank identity parsing / sorting concerns, not event history source fields.

If a past display label is needed later, use a clearly named snapshot field such as `tankLabelSnapshot`; do not use logs as the current-state source of truth.

## tanks read/write policy

Operation writes should target `tanks/{canonicalTankId}`.

Operation reads should use canonical IDs once a value crosses the hook / workflow boundary. Based on PR #91, legacy fallback for `A01` document IDs is not currently required.

List-driven flows that already start from `TankDoc.id` should continue passing that ID through unchanged. Because existing data is canonical, that means they should naturally pass canonical IDs without extra conversion.

Repository functions should remain exact canonical accessors unless a future data audit proves a compatibility fallback is needed.

## Implementation PR order

Do not connect every operation path at once. A safe sequence is:

1. Connect manual operation input boundary.
   - Normalize in `useManualTankOperation` before queueing.
   - Dedupe and lookup by canonical ID.
   - Preserve current 2-digit / OK UI behavior.
   - Do not broaden to 100+ in this PR unless explicitly chosen.
2. Connect order fulfillment input boundary.
   - Normalize before scanned-tank dedupe, tank lookup, and quantity checks.
   - Keep order transaction behavior otherwise unchanged.
3. Connect shared `TankIdInput` consumers.
   - Replace local regex / ad hoc checks in damage and in-house with helper validation.
   - Preserve current UI range unless 100+ support is intentionally included.
4. Review list-driven flows.
   - Bulk return, repair, inspection, and portal return mostly pass existing `TankDoc.id`; they may need little or no normalization.
   - Confirm return tag processing writes canonical transaction tank IDs at creation / approval boundaries.
5. Add `tank-operation.ts` defensive normalization.
   - Do this after simpler callers are canonical.
   - Be careful with dashboard correction, void, revision, `prevTankSnapshot`, `nextTankSnapshot`, and historical `logs.tankId`.
6. Update picker / 100+ UI support when operationally needed.
   - `PrefixNumberPicker` should parse canonical IDs with 2+ digits.
   - Manual / order numeric input should have an explicit confirmation model for 3+ digits.

Dashboard edit / void should be later than manual / order because it affects revision chains and restoration semantics.

## Explicit non-goals

- No implementation code changes.
- No Firestore data create / update / delete.
- No migration.
- No Hosting, Firestore, Security Rules, or unscoped Firebase deploy.
- No `firestore.rules`, `firebase.json`, or package file changes.
- No operation / UI / repository connection in this PR.
- No change to billing, sales, reward, trace, revision, void, or correction behavior.
