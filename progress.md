# Phase 2 進捗

## TankSnapshot 型追加 / tanks.latestLogId 導入 完了
- 変更ファイル: src/lib/tank-operation.ts, src/lib/tank-types.ts
- 内容: TankSnapshot を export し、TankDoc に latestLogId?: string | null を追加した。

## 新規ログ書き込み経路刷新 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: applyTankOperation / applyBulkTankOperations を runTransaction 化し、active revision v1 と latestLogId を原子的に書く経路へ更新した。

## applyLogCorrection（Case A 同一 tankId） 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: 同一タンク編集で旧 prevTankSnapshot を継承し、supersedes チェーンの新 active revision を作る処理を追加した。

## applyLogCorrection（Case B tankId 変更） 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: oldTank を prev snapshot に復元し、newTank の現在 snapshot から新 revision を作る処理を追加した。

## voidLog 刷新 完了
- 変更ファイル: src/lib/tank-operation.ts
- 内容: voided boolean / delete_history を廃止し、active 最新ログだけを voided にして prevTankSnapshot へ復元する transaction 処理へ更新した。

## Dashboard ログ一覧 / 編集モーダル 完了
- 変更ファイル: src/app/staff/dashboard/page.tsx
- 内容: active ログ一覧を originalAt desc で取得し、PrefixNumberPicker と transitionAction ベースの編集モーダルへ置き換えた。

## Dashboard 取消モーダル / 履歴展開 完了
- 変更ファイル: src/app/staff/dashboard/page.tsx
- 内容: 取消理由必須モーダル、rootLogId 履歴展開、過去 revision への復元処理を追加した。

## logs active フィルタ更新 完了
- 変更ファイル: src/lib/tank-trace.ts, src/app/admin/billing/page.tsx, src/app/admin/sales/page.tsx, src/app/admin/staff-analytics/page.tsx, src/app/admin/page.tsx, src/app/portal/page.tsx, src/app/staff/mypage/page.tsx
- 内容: 通常表示・集計・追跡の logs 取得に where("logStatus", "==", "active") を追加した。

## 非タンクログ分離 完了
- 変更ファイル: src/app/staff/order/page.tsx
- 内容: 資材発注ログに logStatus: "active" と logKind: "order" を付与し、tank snapshot を持つログと分離した。

## Firestore index 確認事項 完了
- 変更ファイル: progress.md
- 内容: 必要になる可能性が高い index は logs(logStatus, originalAt desc), logs(logStatus, timestamp desc), logs(rootLogId, revision asc), logs(logStatus, tankId, timestamp desc), logs(logStatus, tankId, action, timestamp desc)。

## tsc 通過 完了
- 変更ファイル: なし
- 内容: npx tsc --noEmit --pretty false がエラーゼロで完了した。

## build 安定化 完了
- 変更ファイル: src/app/layout.tsx, package.json
- 内容: build 時の Google Fonts 取得と Turbopack sandbox bind 問題を避けるため、system font fallback と webpack build を明示した。

## build 通過 完了
- 変更ファイル: なし
- 内容: npm run build が成功し、全 32 route の静的生成が完了した。
