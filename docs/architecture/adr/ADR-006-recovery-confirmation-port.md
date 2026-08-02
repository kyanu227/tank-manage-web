# ADR-006 — Recovery confirmation port（domain と locale / browser の境界）

- **Status**: Accepted
- **Date**: 2026-08-02
- **Affected domains**: tank-lifecycle (1), 全 workflow domain, display/i18n (15)

## Context

staff 英語化（PR #176〜#182）の結果、atomic writer が browser と locale に依存するようになった。

```text
src/lib/tank-operation.ts:63
  → import { getStaffLocale } from "@/hooks/useStaffSession"
    → react (useMemo / useSyncExternalStore)
    → localStorage
```

さらに深刻なのは locale ではなく、**domain が UI 対話そのものを行っている**点である。

```text
tank-operation.ts:789  window.confirm(buildTankRecoveryConfirmationMessage(...))
```

`runPlannedOperationsWithRecoveryConfirmation` は transaction を試行 → `TankRecoveryConfirmationRequiredError` を catch → **`window.confirm()` で解決** → `recoveryConfirmation` を付けて再試行、というループを domain 内部で回している。

これは design-principles §5.2（domain は React / browser API を import しない）と §12.4（domain は locale を知らない）への違反であり、加えて内蔵ブラウザや Emulator など `confirm()` が使えない環境で自動検証が不可能になる。

## Decision

**confirmation resolver port を採用する。**

- domain / atomic writer から React import を排除する
- domain / atomic writer から Next.js import を排除する
- domain / atomic writer から `localStorage` 参照を排除する
- domain / atomic writer から `window.*` 参照を排除する
- domain は locale 別文言を生成しない
- domain は**構造化された confirmation requirement** を生成する
- application / workflow boundary が resolver を渡す
- UI adapter が ja/en 文言を作り、dialog / modal を表示する
- **resolver 未注入時は fail-closed**（確認が必要になったら例外。黙って続行しない）
- transaction 再実行時は fingerprint と stale state を再検証する
- single / bulk operation で**同じ contract** を使用する

## Decision drivers

1. contract の骨格は**既に存在する** — `TankRecoveryConfirmationRequiredError`（fingerprint + requirements）と、公開入力の `TankOperationInput.recoveryConfirmation`。domain は既に「構造化要求を投げ、確認結果を受け取る」形になっており、**自分で解決している点だけが問題**
2. retry ループを domain に残せる。public writer の呼び出し元は**9箇所**あり、ループを各 caller へ複製すると §18（共通化）に反する
3. resolver を注入すれば test で確定的に制御でき、Emulator / 非ブラウザ caller にも対応できる
4. transaction 再実行・fingerprint 再検証という繊細な semantics を1箇所に保てる

## Rejected alternatives

**A. 構造化要求を caller へ throw し、caller が解決して再呼び出しする**
却下理由: public writer の呼び出し元が9箇所ある。retry ループ・fingerprint 再検証・stale 再取得を9重複させることになり、共通化原則に反する。1箇所で間違えると安全機構が壊れる。

**C. application service で operation transaction を包み、domain と UI を仲介する新レイヤを作る**
却下理由: 1つの関心事のために層を1つ増やす。design-principles §3 Non-goals（YAGNI）。resolver port で足りる。

## Consequences

- 全 workflow が resolver を渡す必要が出る（9箇所。ただし共有 UI resolver を1つ用意すれば1行ずつ）
- resolver 未注入の caller は recovery が必要になった時点で失敗する（意図した fail-closed）
- `TankRecoveryConfirmationRequiredError` に `code` の付与が必要。現在 plain `Error` 継承で code を持たない**唯一の domain error** であり、§12.3 違反でもある

## Implementation boundary

**完了条件**（これを満たさない限り違反は解消していない）:

```text
src/lib/tank-operation.ts
  React import           0
  Next import            0
  useStaffSession import 0
  localStorage reference 0
  window reference       0
```

**重要**: 「locale import を消す」だけでは不十分。`window.confirm` が残っていれば違反は継続している。完了条件は **`window.` 参照0件**である。

あわせて: `staff-operation-error.ts` から translation catalog を display boundary へ分離する（domain error code と翻訳は変更理由が異なる）。`isStaffOperationError` の class 名文字列判定を brand field 判定へ寄せる。

## Verification

- architecture test / ESLint: `src/lib/tank-*.ts` から `react` / `next` / `@/hooks/**` の import 禁止
- grep ベースの完了条件チェック（上記5項目が0件）
- resolver 未注入時に fail-closed することの unit test
- recovery 確認の payload・文言が現行と完全一致すること（characterization test）
- bulk / single で同じ contract が使われることのテスト

## Reconsideration trigger

- recovery 確認以外に domain 途中でのユーザー対話が必要になる（その場合も port を増やす形で対応し、`window` を domain へ戻さない）

## Related documents

- [design-principles.md](../design-principles.md) §12.4, §17, §21.4
- [clean-break-cutover-plan.md](../clean-break-cutover-plan.md) Phase 1
