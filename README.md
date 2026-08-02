# タンク管理 Web

ダイビングタンクのレンタル管理システム（Web版）。Next.js（静的エクスポート）+ Firebase Auth + Firestore。

**現在は実運用開始前。**

## どこから読むか

| 知りたいこと | 見る場所 |
|---|---|
| **画面がどのファイルから来ているか** | [SITEMAP.md](./SITEMAP.md) |
| **設計判断のしかた（なぜこう作るか）** | [docs/architecture/README.md](./docs/architecture/README.md) |
| **作業ルール・禁止事項・deploy手順** | [AGENTS.md](./AGENTS.md) / [CLAUDE.md](./CLAUDE.md) |
| 確定した設計判断の理由 | [docs/architecture/adr/](./docs/architecture/adr/) |

## 現状と target 設計の区別

```text
Architecture design:          approved
Clean-break implementation:   not started
Firestore reset:              not executed
Rules cutover:                not executed
```

`docs/architecture/` の設計は**承認済みの target** であり、現在のコードがそのとおりになっているとは限らない。
現在のコードとの差分は [docs/architecture/domain-map.md](./docs/architecture/domain-map.md) §8 の gap 表を見ること。

## Local development

```bash
npm install
npm run dev          # http://localhost:3000
```

`.env.local` に Firebase の設定が必要。**dev は現在 本番 Firestore へ直結している**（環境分離は clean-break の P0-C で実施予定）。書き込みを伴う動作確認は [docs/verification/full-app-flow-verification-plan.md](./docs/verification/full-app-flow-verification-plan.md) の検証 level に従うこと。

## Validation

```bash
npx tsc --noEmit --pretty false
npm run lint
npm run build
npm test
```

遷移まわりを触った場合は追加で:

```bash
npm run test:rules:transition
npm run test:transition-policy
npm run test:transition-projections
```

## Production safety

- 通常 deploy は `firebase deploy --only hosting` のみ
- **Firestore Rules の deploy は通常 deploy に含めない。** Rules-only の専用レビュー・operation で行う
- Hosting と Rules を同じ deploy コマンドへ混ぜない
- data reset / migration はユーザーの明示承認が必要
- 詳細は [AGENTS.md](./AGENTS.md) の deploy / commit 分離ルールと [docs/cutover/transition-plan-v1-runbook.md](./docs/cutover/transition-plan-v1-runbook.md)
