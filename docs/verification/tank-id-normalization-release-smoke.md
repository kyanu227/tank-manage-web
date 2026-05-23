# Tank ID Normalization Release Smoke Test

## Purpose

This document records the release and smoke-test result for the tank ID normalization phase.

The phase moved tank ID parsing and canonicalization into `src/lib/tank-id.ts`, connected the main staff-side write flows to that helper, deployed the static Hosting build, and verified production page rendering without performing Firestore writes.

This is a verification record only. It does not change implementation code, Firestore data, security rules, deploy configuration, or package files.

## Release Context

| Item | Value |
|---|---|
| main commit | `6767fd7fe90dd675e9754b5bac76f7475a47ba0c` |
| deploy command | `firebase deploy --only hosting` |
| deploy result | exit `0` |
| Hosting URL | `https://okmarine-tankrental.web.app` |
| Firestore data changes | not executed |
| Firestore deploy | not executed |
| Security Rules deploy | not executed |
| migration | not executed |

## Completed Scope

The following tank ID normalization work is complete and deployed to Hosting:

- tank ID audit / design documentation
- pure tank ID helper in `src/lib/tank-id.ts`
- `A-00` as valid numeric ID
- `A-OK` as the only reserved nonnumeric exception
- Firestore read-only audit for existing tank ID formats
- data model source-of-truth documentation
- operation boundary design documentation
- procurement / tank registration helper connection
- manual operation helper connection
- order fulfillment helper connection
- staff damage helper connection
- staff in-house helper connection
- return tag processing helper connection
- Hosting deploy
- production smoke test without Firestore writes

## Canonical Tank ID Rules

The deployed helper treats these as canonical equivalents:

| Input examples | Canonical ID |
|---|---|
| `A0`, `A00`, `A-00`, `a-00` | `A-00` |
| `A1`, `A01`, `A-01`, `A001`, `a-01` | `A-01` |
| `AOK`, `A-OK`, `a-ok`, `A-ok` | `A-OK` |
| `A100`, `A-100` | `A-100` |

Invalid examples remain invalid:

- `A-NG`
- `A-TEST`
- `A-SPARE`
- `A-O K`
- `A-0K`
- `A--01`
- `A01B`
- `A-01-2`
- empty input

## Data Compatibility Summary

The Firestore read-only audit completed before deployment found:

| Area | Result |
|---|---|
| `tanks` total | 144 |
| `tanks` canonical numeric | 143 |
| `tanks` valid OK exception | 1 |
| `tanks` legacy `A01` / raw `A1` / compact `A100` / compact `AOK` | 0 |
| `tanks` arbitrary suffix / parse unavailable | 0 |
| `logs` total | 31, all canonical numeric |
| `transactions` total | 8 |
| `transactions` canonical numeric | 4 |
| `transactions` missing tankId | 4 |

This means the existing production data does not currently require an `A01` legacy fallback for the deployed staff operation helper connections.

## Smoke Test Scope

Smoke test target:

- `https://okmarine-tankrental.web.app`

Checked pages:

- `/staff/dashboard`
- `/staff/lend`
- `/staff/return`
- `/staff/tank-register`
- `/staff/tank-purchase`
- `/staff/damage`
- `/staff/inhouse`
- `/admin`

The smoke test was display-only. It did not execute lend, return, damage report, in-house, tank registration, correction, void, migration, or any other Firestore write operation.

## Smoke Test Result

| Page | Result |
|---|---|
| `/staff/dashboard` | Displayed successfully. No obvious runtime console errors. |
| `/staff/lend` | Displayed successfully. Manual tank ID input / queue area rendered. No obvious runtime console errors. |
| `/staff/return` | Displayed successfully. Return list-driven flow rendered. No obvious runtime console errors. |
| `/staff/tank-register` | Displayed successfully. Tank registration input area rendered. No obvious runtime console errors. |
| `/staff/tank-purchase` | Displayed successfully. Tank procurement input area rendered. No obvious runtime console errors. |
| `/staff/damage` | Displayed successfully. Tank ID input / queue area rendered. No obvious runtime console errors. |
| `/staff/inhouse` | Displayed successfully. Tank ID input and in-house list rendered. No obvious runtime console errors. |
| `/admin` | Displayed successfully. No obvious runtime console errors. |

Additional observations:

- Manual, damage, in-house, and registration-style tank ID input UI displayed `A - OK` without layout failure.
- Return / bulk-return style list-driven flow rendered existing tank IDs without obvious display failure.
- Admin dashboard displayed normally.

## Validation Commands

Before Hosting deploy:

- `git status --short --branch`
- `git diff --check`
- `npx tsc --noEmit --pretty false`
- `npm run build`

Notes:

- The first build attempt failed while fetching Google Fonts.
- Re-running the same build with network access succeeded.
- Hosting deploy used only `firebase deploy --only hosting`.

After deploy:

- production smoke test in Chrome
- console error inspection for the checked pages

## Explicitly Not Executed

- Firestore data create / update / delete
- lend / return / damage / in-house / tank registration write smoke test
- migration
- Firestore deploy
- Security Rules deploy
- unscoped Firebase deploy
- `firestore.rules` change
- `firebase.json` change
- package file change
- additional implementation change
- actual `A-00` write operation confirmation

## Remaining Follow-up Candidates

These are not blockers for the completed tank ID normalization release, but remain useful next-phase candidates:

- write smoke test using clearly identified verification tanks
- portal-side tank ID helper connection
- dashboard edit / void / correction tank ID handling design
- `tank-operation.ts` defensive normalization
- repository exact-canonical-ID policy review
- logs typed field design, including fields such as `transactionId`, `returnCondition`, `source`, and `workflow`
- current loan projection design

Dashboard correction / void should remain separate from the staff operation helper rollout because it affects revision chains and restoration semantics.
