# Deploy / Firestore change rules

最終更新: 2026-07-18

この文書は、UI 系変更と Firestore 書き込み・認証・schema 変更を混在させないための開発ルールをまとめる。Codex / Claude Code / その他の AI エージェントは、実装前に本ルールを確認する。

## Deploy 方針

- 通常 deploy は `firebase deploy --only hosting` のみを使う。
- `firebase.json` は`firestore.rules`へ接続済み。現在の本番Rulesは2026-06-02のcommit
  `b7e853c8f38071937951b871cbe0e3281dd22876`と同じ本文を、2026-07-18のReset前abortで
  再deployしたreleaseとしてread-only確認済み。
- 2026-06-02 Git正本以後のRules差分は、自動的に本番反映済みだとみなさない。
- Rules deployは専用レビュー・専用operationに分離し、明示projectとrules-only configを使う。
- cutover freeze/normal Rulesは`docs/cutover/transition-plan-v1-runbook.md`に従う。
- Hosting deploy 前は、Firestore Rules / Functions が deploy 対象に含まれていないことを確認する。
- 無指定`firebase deploy`とHosting/Rules同時deployは禁止する。

## Commit 分離ルール

- UI-only commit と Firestore 書き込み / Firebase Auth / schema 変更 commit は分ける。
- docs-only commit は実装 commit と分ける。
- icon / PWA 画像更新は、UI やロジック変更と分ける。
- `.codex-logs` は commit 禁止。
- 未コミット WIP がある場合は、`git diff --cached --name-status` で staged ファイルを必ず確認する。

## UI-only として扱ってよいもの

以下は、Firestore 書き込み / Auth / schema 変更を含まない場合に限り UI-only として扱ってよい。

- 表示調整
- タブ UI
- スワイプ表示
- アイコン / PWA 画像
- レイアウト整理

ただし、同じ差分に Firestore write / Firebase Auth / schema 変更が混ざる場合は UI-only ではない。UI commit から分離する。

## UI-only に含めてはいけないもの

UI-only commit には、以下を含めない。

- `addDoc`
- `setDoc`
- `updateDoc`
- `writeBatch`
- `runTransaction`
- `deleteDoc`
- Firebase Auth 関連
- `transactions` / `tanks` / `logs` / `tankProcurements` / `customerUsers` の schema 変更
- `firestore.rules`
- `firebase.json`

## tank-operation.ts の方針

- 通常のタンク操作は `src/lib/tank-operation.ts` に寄せる。
- 状態更新と `logs` 書き込みは同じ batch / transaction で一貫させる。
- 既存の operation 境界を優先する。
  - `applyTankOperation`
  - `appendTankOperation`
  - `applyBulkTankOperations`
  - `voidLog`
  - `validateTransition`
- `tank-operation.ts` を迂回する `logs` 書き込みは要レビュー。
- 画面コンポーネント内に `writeBatch` を直書きしない。
- 既存の直接書き込みを見つけた場合も、別指示なしに大規模移行しない。

## 高リスク領域

以下の領域は UI に見える変更でも、Firestore 書き込み・Auth・schema 変更を含む可能性があるため要レビュー。

- `procurement` / `tank-register`
  - `tanks` / `logs` / `tankProcurements` に書く可能性がある。
- `staff/order`
  - `tank-operation.ts` 経由ではない `logs` 書き込みがある可能性がある。
- `portal/order`
  - `transactions` の status / schema を変更する可能性がある。
- order approval schema
  - `pending` / `pending_approval` / `approved` / `completed` / `pending_link` の混在に注意する。
- dashboard KPI
  - `pending_approval` を拾うかどうかを確認する。
- portal `customerUsers` / Firebase Auth
  - Firestore Rules とセットで設計レビューが必要。

## 検証ルール

commit 前に以下を確認する。

1. `git status --short`
2. 対象差分に禁止ワードが混入していないか確認する。
3. `npx tsc --noEmit`
4. 可能なら対象ファイル lint を実行する。
5. `npm run build`
6. 全体 lint に既存エラーがある場合は、新規変更由来か既存由来かを分けて報告する。

禁止ワード確認の例:

```bash
git show --format= --unified=0 HEAD | rg "addDoc|setDoc|updateDoc|writeBatch|runTransaction|deleteDoc|createUserWithEmailAndPassword|signInWithEmailAndPassword|onAuthStateChanged|getAuth|tankProcurements|customerUsers|transactions|pending_approval|pending_link|firestore\\.rules|firebase\\.json|\\.codex-logs"
```

WIP が多い場合は、作業ツリー全体ではなく対象 commit / staged diff に限定して確認する。
