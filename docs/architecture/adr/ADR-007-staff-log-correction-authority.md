# ADR-007 — Staff log correction authority（role 非依存）

- **Status**: Accepted
- **Date**: 2026-08-03
- **Affected domains**: staff-dashboard, tank-lifecycle (1), identity-access (8), Security Rules

## Context

現行の Staff dashboard は `StaffCorrectionRole = "管理者" | "準管理者" | "一般"` という日本語文字列でログ訂正・取消の権限を分岐し、管理者・準管理者は作成後 72 時間の制限を bypass できる。

この role 分岐は application（`src/app/staff/dashboard/page.tsx`）と Firestore Rules（`correctionWindowAllows()`）の2箇所に重複している。これは [design-principles.md](../design-principles.md) §8.1「権限判定に表示文字列を使わない」への違反である。さらに page が訂正・取消の可否判定を持つため、同 §5.2 の層責務にも違反する。

role ごとの条件を UI と Rules で一致させ続ける構造では、どちらか片方だけが緩んだ場合に fail-open となる。ログ訂正・取消は revision chain、tank snapshot 復元、transaction atomicity を伴う監査対象操作であり、この不一致を許容できない。

## Decision

Staff dashboard の staff log correction / void から**権限次元としての role を廃止する**。全ての active staff に、次の同一条件を適用する。

- 作成後 72 時間以内だけ訂正・取消できる
- 管理者・準管理者も 72 時間制限を回避できない
- 対象 tank の最新の active tank log だけを対象にする
- recovery log は直接訂正・取消できない
- `transitionReviewStatus` が `not_required` でない log は直接訂正・取消できない
- `superseded` / `voided` log は対象外とする
- 訂正・取消理由を必須とする
- actor の `staffId` / `staffName` / `staffEmail` 記録と Firestore Rules による actor 照合を維持する
- revision chain、tank snapshot 復元、transaction atomicity を維持する

訂正・取消の可否判定は page から外し、Staff dashboard feature 境界の pure policy 関数へ移す。UI の見た目は原則として維持し、role による利用可否差だけをなくす。`applyLogCorrection` / `voidLog` は引き続き唯一の write owner とする。

admin operation review（`/admin/operation-reviews`）の管理者制限は本 ADR の対象外であり維持する。`/admin/**` のアクセス制御、`settings/adminPermissions`、staff / customer / settings 管理、および管理機能に必要な Security Rules にこの決定を拡大しない。

## Decision drivers

1. 同じ不変条件を UI と Rules の2箇所で role 分岐込みで一致させ続けるのは現実的でない。片方だけ緩むと fail-open になる
2. 日本語 role 文字列を permission code として使う箇所を1つ減らせる
3. 72 時間は「直近の入力ミス訂正」という業務意図に対して十分であり、それ以上の訂正可能期間は監査上望ましくない
4. 管理者の是正手段は `/admin/operation-reviews` として別に存在する

## Rejected alternatives

**A. role を code 化して分岐だけ残す**

却下理由: 分岐の二重管理と fail-open リスクが残る。問題の本質である「page が権限を判定している」「Rules と UI の条件一致を保証できない」を解消しない。

**B. 全 staff が無期限に訂正・取消できるようにする**

却下理由: 監査可能性と revision chain の意味が薄れる。[design-principles.md](../design-principles.md) §2.2 の業務不変条件に反する。

**C. 管理者だけ無期限に訂正・取消できる現状を維持する**

却下理由: Decision drivers 1 の二重管理と fail-open リスクを残す。

## Consequences

- `StaffCorrectionRole`、`editedByRole`、`voidedByRole`、`PRIVILEGED_CORRECTION_ROLES`、`normalizeCorrectionRole`、`correctionRole` を削除する
- `editedByRole` / `voidedByRole` は log schema から消える。clean-break のため旧 field の互換維持は行わない
- `correctionWindowAllows()` から `isAdminStaff()` を削除し、UI と Rules の条件を単一の 72 時間規則で一致させる
- Staff dashboard の可否判定を feature-local な pure policy として単体検証できるようになる
- actor identity の記録・照合、revision chain、tank snapshot 復元、transaction atomicity は変わらない
- admin operation review（`/admin/operation-reviews`）の管理者制限は本 ADR の対象外であり維持する
