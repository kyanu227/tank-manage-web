# adminPermissions の decode 経路統一 — 設計note（F7）

- 作成日: 2026-07-29
- 対象commit: `ddb2e8fc81e92c0c0ef2c3ab591562c18ad5d0ce`
- 位置づけ: **設計note。実装は含まない。挙動変更を伴うため人間判断が必須**
- 関連: `docs/architecture/write-ownership.md` §6、`firestore.rules`


## 0. 反証レビューによる訂正（2026-07-29）

独立 reviewer（Codex, read-only）が本note を **NEEDS_CORRECTION** と判定した。

reviewer が成立を確認した主張（訂正不要）:

- `roles` が文字列 `"準管理者"` のとき `String.prototype.includes` により
  **実際に true になり allow される**（`AdminAuthGuard.tsx:201`）
- unknown path が除外されない（`AdminAuthGuard.tsx:58`）。さらに
  `findAdminPage` が null でも `canSubAdminUseRegisteredPage` は true を返す（同`:47`）
- pathname race（`AdminAuthGuard.tsx:175` に reset も cleanup も無い）
- service caller は `/admin/permissions` のみ（`permissions/page.tsx:25`）

### 訂正 1 — 「missing」と「malformed」を同じ default に落とすのは**危険**

本文 §6 は decoder が「doc 不在 / decode 失敗」を同じ default policy へ落とす設計だが、
これだと**変更対象が doc 不在だけではなくなる**。

現在 `pages=null` は catch で deny だが、default B を選ぶと
**破損 document から `/admin` allow へ変化する。**

→ decoder の結果を **`valid | missing | malformed` の tagged union** にし、
**missing は default policy、malformed は fail-closed** と分離すること。

### 訂正 2 — 「権限逸脱は生じない」は強すぎる

Rules に `adminPermissions` 参照が0件なのは正しいが、Rules は
**page 単位ではなく粗い role 単位**の権限しか持たない。

例: `orderMaster` は準管理者も create/update/delete 可能（`firestore.rules:1733`）で、
対応画面は実際に batch write する（`order-master/page.tsx:76`）。

→ **UI gate の変更は、準管理者が実行可能な実効機能を変える。**
「UI だけだから安全」とは言えない。

### 訂正 3 — 人間判断に投げすぎていた

reviewer 判定:

> malformed roles・unknown paths の fail-closed は**人間判断に投げる必要のない安全修正**。
> 人間判断が必要なのは **missing document 時の準管理者 `/admin` だけ**。

→ §7 の判断2（malformed の扱い）は**判断事項から外し、fail-closed へ修正する bug fix** とする。
   unknown path の除外も同様。

また `/admin/permissions` 自体が adminOnly（`adminPagesRegistry.ts:34`）なので、
**準管理者本人が不一致マトリクスを見るわけではない**。
影響を受けるのは管理者が見る表示である。

### 訂正 4 — pathname race を完成条件から外さない

本文 §8 は PR-d（race 修正）を最後に置いたが、reviewer 判定:

> decoder 統一後も旧結果表示が残るため、**権限変更の完成条件から外してはいけない**。

→ PR-c（decoder 統一）と PR-d（race 修正）を**セットで完成**とする。

## 1. 現状 — 同じ document を2経路が別々に decode している

`settings/adminPermissions` を読む経路が2つあり、**doc 不在時の意味が正反対**。

### 経路 1: `AdminAuthGuard.tsx:198-221`（生の `getDoc`）

```ts
const permDoc = await getDoc(doc(db, "settings", "adminPermissions"));
if (permDoc.exists()) {
  const pages = permDoc.data().pages as Record<string, string[]>;
  const allowedPaths = Object.entries(pages)
    .filter(([, roles]) => roles.includes("準管理者"))
    .map(([path]) => path);
  ...
} else {
  onPermissionsLoaded?.([]);
  setHasAccess(false);        // ← 全拒否
}
```

### 経路 2: `admin-permissions-service.ts:6-33`（service）

```ts
export async function getAdminPermissions(controlledPagePaths) {
  const snap = await getDoc(doc(db, "settings", "adminPermissions"));
  if (snap.exists()) return snap.data().pages;
  return buildDefaultAdminPermissions(controlledPagePaths);   // ← default を返す
}

function buildDefaultAdminPermissions(paths) {
  const defaults = {};
  paths.forEach((p) => { defaults[p] = ["管理者"]; });
  defaults["/admin"] = ["管理者", "準管理者"];               // ← /admin は準管理者も許可
  return defaults;
}
```

caller は `src/app/admin/permissions/page.tsx` のみ（権限マトリクスの表示・編集）。

## 2. Rules との関係

`firestore.rules` に **`adminPermissions` への参照は0件**（`rg` で確認）。
Rules 側の判定は `isAdmin()` / `isAdminStaff()` = `staffByEmail/{email}` の `role` のみ。

→ **`adminPermissions` は完全に UI 専用の gate である。**
データアクセスの実効的な制御は Rules が独立に行っており、
本note の変更で**権限逸脱は生じない**。

## 3. 挙動マトリクス（コードから導出）

| doc 状態 | role | `/admin` | controlled child | adminOnly / devOnly child |
|---|---|---|---|---|
| valid | 管理者 | allow | allow | allow |
| valid | 準管理者 | `pages["/admin"]` に role があれば allow | 対応 path に role があれば allow | **deny**（registry filter） |
| valid | 一般 | deny | deny | deny |
| **不在** | 管理者 | allow | allow | allow |
| **不在** | 準管理者 | **deny**（Guard） / **allow**（service 表示） ← **不一致** | deny | deny |
| **不在** | 一般 | deny | deny | deny |
| malformed | 管理者 | allow | allow | allow |
| malformed | 準管理者 | shape 依存（§4 参照） | 同左 | deny |
| malformed | 一般 | deny | deny | deny |

**doc 不在時、`/admin/permissions` 画面（service 経由）は
「準管理者は `/admin` にアクセス可」と表示するが、Guard は実際には拒否する。**

管理者が見る権限マトリクスと enforcement が食い違う。
方向は fail-closed（Guard が厳しい側）なので安全ではあるが、
「設定したとおりに動かない」という信頼性の問題がある。

## 4. malformed document のリスク（追加で判明した問題）

両経路とも **runtime validation を持たない**。

```ts
roles.includes("準管理者")
```

`roles` が配列でなく**文字列 `"準管理者"` だった場合**、
`String.prototype.includes` が存在するため `true` を返す。
→ **誤って allow される可能性がある。**

その他:

| malformed の形 | 現行の結果 |
|---|---|
| `pages` が `null` / 未定義 | `Object.entries(null)` が throw → catch されて deny（`AdminAuthGuard.tsx:227`） |
| `roles` が number 等 | `.includes` が無く throw → deny |
| `roles` が string `"準管理者"` | **誤 allow** |
| `pages` に未登録 path が含まれる | `filterSubAdminAllowedPaths` は `ADMIN_PAGES` に無い path を除外しない<br>（`ADMIN_PAGES.find(...)` が `undefined` → `!page?.adminOnly` が `true`）→ 通る余地 |

## 5. 追加で判明した問題 — pathname 変更時の async race

`AdminAuthGuard` の permission check effect は deps に `pathname` を含むが、

- `pathname` が変わったときに `permChecked` / `hasAccess` を**リセットしない**
- 進行中の `getDoc` を**無効化しない**

したがって:

- allowed route → denied route へ遷移した瞬間、
  古い `hasAccess = true` のまま新 route の children が一瞬描画され得る
- 複数の `getDoc` が out-of-order で完了すると、古い結果が後から適用され得る

Rules 上の突破ではないが、UI gate としては test 対象にすべき欠陥。

## 6. 設計方針

**pure policy module を正本にし、両経路をそこへ寄せる。**

```
Firestore document
  → shared decoder（runtime validation 付き）
      → 正規化された AdminPermissionPolicy
          → allowed paths evaluator（ADMIN_PAGES を入力に取る pure 関数）
              → AdminAuthGuard      （enforcement）
              → /admin/permissions  （表示・編集）
```

責務:

| 層 | 責務 |
|---|---|
| decoder | `unknown` → `AdminPermissionPolicy \| null`。`roles` が **配列であること**を検証し、string を弾く。未知 path を除外する |
| default policy | doc 不在 / decode 失敗時の policy を**1箇所で**定義する |
| evaluator | policy + `ADMIN_PAGES` + pathname + role → allow / deny。pure 関数、unit test 可能 |

`admin-permissions-service.ts` は decoder + default を使う薄い IO ラッパにする。
`AdminAuthGuard` の生 `getDoc` は service 呼び出しへ置き換える。

## 7. 人間判断が必要な事項（Claude だけで決めない）

### 判断 1（必須）— doc 不在時、準管理者は `/admin` に入れるべきか

| 選択肢 | 挙動 | 影響を受けるユーザー |
|---|---|---|
| **A. deny を正とする**（Guard に合わせる） | doc 不在時は準管理者を全拒否。`/admin/permissions` の表示も deny に合わせる | 準管理者。**表示が変わる**（現在「/admin 可」と出ているものが「不可」になる） |
| **B. allow を正とする**（service に合わせる） | doc 不在時も準管理者は `/admin` トップに入れる。子 route は deny | 準管理者。**enforcement が変わる**（現在入れないものが入れるようになる） |

**変わるのは「doc 不在時の準管理者の `/admin`」だけ。**
管理者と一般スタッフの挙動、および doc が存在する場合の挙動は
どちらを選んでも変わらない。

`settings/adminPermissions` が本番に存在するかは未確認。
存在するなら、この判断の実運用上の影響は**ゼロ**（doc 不在パスに入らない）。
→ **まず doc の存在確認（L0 read）を行うことを推奨する。**

Claude の意見: **A（deny）を推奨**。理由は fail-closed が権限の既定として妥当で、
現行 enforcement を変えないため。ただし「初期状態で準管理者が何も見られない」ため
セットアップ体験は B のほうが良い。**業務判断としてユーザーに委ねる。**

### 判断 2 — malformed 時の扱い

`roles` が string の場合の誤 allow は明確なバグであり、修正は挙動変更を伴う。
**deny へ倒す**ことを推奨するが、これも承認事項とする。

### 判断 3 — async race の修正範囲

`pathname` 変更時の state リセット / stale request cancellation を
同じ PR に含めるか、別 PR にするか。
**別 PR を推奨**（decode 統一と race 修正は変更理由が異なる）。

## 8. 推奨する PR 分割

```
PR-a  L0  settings/adminPermissions の存在確認（read-only 監査）
          → 判断 1 の実運用影響を確定させる

PR-b      pure decoder + default policy + evaluator の新設と unit test
          この時点では既存2経路の呼び出しを変えない（純粋な追加）
          behavior change なし

PR-c      AdminAuthGuard と service を新 module へ寄せる
          behavior change あり（判断 1・2 の結果が反映される）
          → 判断 1・2 の承認が前提

PR-d      pathname 変更時の state リセットと stale request cancellation
          behavior change あり（UI gate のちらつき解消）
```

## 9. 必要な test

- decoder: valid / 不在 / `pages=null` / `roles` が string / `roles` が number /
  未登録 path / 空 object の 7 ケース以上
- evaluator: §3 の 9 セルマトリクス全件
- Guard: `pathname` 変更時に古い結果が適用されないこと（PR-d）

## 10. 本note で扱わないこと

- Rules 側の権限モデル（`staffByEmail` mirror）の変更
- `ADMIN_PAGES` registry の構造変更
- 準管理者というロール自体の見直し
