export type RulesStatus = "pass" | "caution" | "broad" | "not-deployed";

export type RulesCurrentState = {
  label: string;
  value: string;
  detail: string;
  status: RulesStatus;
};

export type AuthRoleOverview = {
  role: string;
  rulesTreatment: string;
  accessSummary: string;
  caution?: string;
  status: RulesStatus;
};

export type CollectionAccess = {
  collection: string;
  read: string;
  create: string;
  update: string;
  delete: string;
  note: string;
  status: RulesStatus;
};

export type WorkflowOverview = {
  name: string;
  actor: string;
  collection: string;
  operation: string;
  helper: string;
  status: RulesStatus;
  note: string;
};

export type RulesCaution = {
  title: string;
  detail: string;
  status: RulesStatus;
};

export type NextHardeningItem = {
  title: string;
  target: string;
  reason: string;
};

export const RULES_CURRENT_STATE: RulesCurrentState[] = [
  {
    label: "firestore.rules",
    value: "repo draft",
    detail: "リポジトリ上の下書きとして管理中。本番 Security Rules にはまだ反映していません。",
    status: "not-deployed",
  },
  {
    label: "Security Rules deploy",
    value: "未実行",
    detail: "Rules 本番化は別PR・別手順で扱います。この overview は deploy 状態を変えません。",
    status: "not-deployed",
  },
  {
    label: "firebase.json",
    value: "Rules deploy 用には未接続",
    detail: "Hosting と Rules deploy を分離するため、firestore.rules 接続はまだ入れていません。",
    status: "caution",
  },
  {
    label: "Hosting deploy",
    value: "Security Rules と分離",
    detail: "UI deploy と Security Rules deploy は混ぜない方針です。",
    status: "pass",
  },
  {
    label: "transactions staff update",
    value: "allowlist 導入済み",
    detail: "PR #37 までで order approve / fulfill / return completion / customer linking の helper に寄せています。",
    status: "pass",
  },
  {
    label: "tanks / logs staff write",
    value: "broad staff write が残存",
    detail: "active staff なら broad に create / update / delete できるため、次の hardening 候補です。",
    status: "broad",
  },
];

export const AUTH_ROLE_OVERVIEW: AuthRoleOverview[] = [
  {
    role: "anonymous",
    rulesTreatment: "request.auth == null",
    accessSummary: "明示的に許可された create/read はなく、portal/staff/admin write は拒否されます。",
    status: "pass",
  },
  {
    role: "signed-in customer user",
    rulesTreatment: "Firebase Auth + customerUsers/{uid}",
    accessSummary: "自分の customerUsers 作成/更新と、portal transaction create の入口になります。",
    caution: "disabled=true の customer user は transaction create を許可しない前提です。",
    status: "pass",
  },
  {
    role: "linked customer user",
    rulesTreatment: "customerUsers.customerId / customerName が有効",
    accessSummary: "自社 customerId/customerName に紐づく tanks/logs/transactions の参照と portal create が可能です。",
    status: "pass",
  },
  {
    role: "staff",
    rulesTreatment: "Firebase Auth email + staffByEmail/{email}.isActive == true",
    accessSummary: "staff workflow の read/write を許可します。transactions update は helper 化済みです。",
    caution: "tanks/logs write はまだ広めです。transactions delete は adminOnly に寄せています。",
    status: "caution",
  },
  {
    role: "sub admin",
    rulesTreatment: "staffByEmail.role == \"準管理者\"",
    accessSummary: "adminStaff として設定・履歴・マスタ参照などの一部管理操作を許可します。",
    status: "pass",
  },
  {
    role: "admin",
    rulesTreatment: "staffByEmail.role == \"管理者\"",
    accessSummary: "管理用 collection の create/update/delete とスタッフ管理を許可します。",
    status: "pass",
  },
  {
    role: "passcode localStorage session",
    rulesTreatment: "Firestore Rules では staff として扱えない",
    accessSummary: "localStorage の passcode session は request.auth に出ないため、Rules 上の staff write は許可されません。",
    caution: "Rules 本番化時は passcode-only staff operation を disabled 前提にするか、認証方式を分けて設計が必要です。",
    status: "caution",
  },
];

export const COLLECTION_ACCESS_MATRIX: CollectionAccess[] = [
  {
    collection: "staffByEmail",
    read: "本人 email の get / admin list",
    create: "admin",
    update: "admin",
    delete: "admin",
    note: "email casing は lowercase 運用前提。Rules 側で lowercase 正規化はできません。",
    status: "caution",
  },
  {
    collection: "staff",
    read: "adminStaff または本人 active staff",
    create: "admin",
    update: "admin",
    delete: "admin",
    note: "staff 管理は admin 境界に閉じています。",
    status: "pass",
  },
  {
    collection: "customerUsers",
    read: "adminStaff または本人",
    create: "本人 first login helper",
    update: "admin helper または本人 update helper",
    delete: "admin",
    note: "status 既存 field 問題は caution。将来的には派生値へ寄せる方針です。",
    status: "caution",
  },
  {
    collection: "customers",
    read: "staff",
    create: "admin",
    update: "admin",
    delete: "admin",
    note: "portal user から直接 customers を読む設計ではありません。",
    status: "pass",
  },
  {
    collection: "settings",
    read: "staff / portal setting は signed-in user",
    create: "admin",
    update: "admin",
    delete: "admin",
    note: "adminPermissions などの管理設定を含みます。",
    status: "pass",
  },
  {
    collection: "tanks",
    read: "staff または linked customer resource",
    create: "staff",
    update: "staff",
    delete: "staff",
    note: "staff write は broad。field allowlist は未導入です。",
    status: "broad",
  },
  {
    collection: "logs",
    read: "staff または linked customer resource",
    create: "staff",
    update: "staff",
    delete: "staff",
    note: "staff write は broad。revision/void/superseded の schema guard は future scope です。",
    status: "broad",
  },
  {
    collection: "transactions",
    read: "staff または own customer transaction",
    create: "staff または portal create helper",
    update: "staff transaction workflow helpers",
    delete: "admin",
    note: "staff update は helper 化済み。delete は adminOnly に hardening 済みで、完全 deny は将来方針です。",
    status: "caution",
  },
  {
    collection: "tankProcurements",
    read: "staff",
    create: "staff",
    update: "staff",
    delete: "admin",
    note: "procurement workflow は別 hardening 候補です。",
    status: "caution",
  },
  {
    collection: "orders",
    read: "staff",
    create: "staff",
    update: "staff",
    delete: "staff",
    note: "資材発注データ。今回の Security Rules hardening 主対象ではありません。",
    status: "caution",
  },
  {
    collection: "edit_history",
    read: "adminStaff",
    create: "adminStaff",
    update: "false",
    delete: "false",
    note: "監査ログとして追記のみ許可する方針です。",
    status: "pass",
  },
  {
    collection: "delete_history",
    read: "adminStaff",
    create: "adminStaff",
    update: "false",
    delete: "false",
    note: "削除監査ログとして追記のみ許可する方針です。",
    status: "pass",
  },
];

export const WORKFLOW_RULES_OVERVIEW: WorkflowOverview[] = [
  {
    name: "customerUsers first login create",
    actor: "signed-in customer user",
    collection: "customerUsers",
    operation: "create",
    helper: "isOwnCustomerUserCreate(uid)",
    status: "pass",
    note: "uid/email/初期 setup fields を制限し、status 保存を拒否します。",
  },
  {
    name: "customerUsers self update",
    actor: "signed-in customer user",
    collection: "customerUsers",
    operation: "update",
    helper: "isOwnCustomerUserUpdate(uid)",
    status: "caution",
    note: "本人更新 field は制限済み。既存 status field 問題は別方針が必要です。",
  },
  {
    name: "portal order create",
    actor: "active customer user",
    collection: "transactions",
    operation: "create",
    helper: "isPortalOrderCreate()",
    status: "pass",
    note: "linked pending / unlinked pending_link の両方を現行 payload に合わせています。",
  },
  {
    name: "portal return create",
    actor: "linked customer user",
    collection: "transactions",
    operation: "create",
    helper: "isPortalReturnCreate()",
    status: "pass",
    note: "pending_return と normal/unused/uncharged/keep の condition を許可します。",
  },
  {
    name: "portal uncharged_report create",
    actor: "linked customer user",
    collection: "transactions",
    operation: "create",
    helper: "isPortalUnchargedReportCreate()",
    status: "pass",
    note: "completed の uncharged_report create を現行 payload に合わせています。",
  },
  {
    name: "staff order approve",
    actor: "active staff",
    collection: "transactions",
    operation: "update",
    helper: "isStaffOrderApproveUpdate()",
    status: "pass",
    note: "approved status と required actor snapshot を allowlist 化しています。",
  },
  {
    name: "staff order fulfill",
    actor: "active staff",
    collection: "transactions / tanks / logs",
    operation: "update + batch write",
    helper: "isStaffOrderFulfillUpdate() + tanks/logs isStaff broad",
    status: "caution",
    note: "transaction completion は helper 化済み。tanks/logs は broad staff write が残ります。",
  },
  {
    name: "return tag processing",
    actor: "active staff",
    collection: "transactions / tanks / logs",
    operation: "update + batch write",
    helper: "isStaffReturnCompletionUpdate() + tanks/logs isStaff broad",
    status: "caution",
    note: "pending_return -> completed は helper 化済み。tanks/logs は future hardening です。",
  },
  {
    name: "customer linking pending_link order update",
    actor: "active staff",
    collection: "transactions",
    operation: "update",
    helper: "isStaffPendingLinkOrderUpdate()",
    status: "pass",
    note: "customerId/customerName と linkedBy* を non-empty にしています。",
  },
];

export const SECURITY_RULES_CAUTIONS: RulesCaution[] = [
  {
    title: "Security Rules deploy は未実行",
    detail: "この overview は repo 上の draft rules を説明するだけで、本番 Security Rules の状態は変えません。",
    status: "not-deployed",
  },
  {
    title: "firebase.json は Rules deploy 用に未接続",
    detail: "Rules 本番化時は firebase.json 接続と deploy 手順を専用PRで扱う必要があります。",
    status: "caution",
  },
  {
    title: "tanks / logs staff write はまだ broad",
    detail: "active staff なら field 制限なしに write できるため、logs/tanks allowlist が次の hardening 候補です。",
    status: "broad",
  },
  {
    title: "transactions delete は adminOnly",
    detail: "active staff による transaction 物理削除は閉じています。完全 deny にするかは運用方針として別途判断します。",
    status: "pass",
  },
  {
    title: "staffByEmail casing は未解決",
    detail: "Rules は email lowercase 変換を行えないため、Auth email と staffByEmail doc id の運用方針が必要です。",
    status: "caution",
  },
  {
    title: "passcode localStorage session は Rules 上 staff ではない",
    detail: "Firebase Auth を伴わない passcode-only session は request.auth に出ないため、Rules 本番化時は扱いを分ける必要があります。",
    status: "caution",
  },
  {
    title: "customerUsers.status 既存 field 問題",
    detail: "現行方針は status を保存せず派生値に寄せることですが、既存 field との整合確認が残っています。",
    status: "caution",
  },
  {
    title: "Security Rules deploy 手順は別PR",
    detail: "Hosting deploy と混ぜず、manual verification と deploy procedure を固めてから扱います。",
    status: "not-deployed",
  },
];

export const NEXT_SECURITY_RULES_HARDENING: NextHardeningItem[] = [
  {
    title: "logs create/update allowlist",
    target: "logs",
    reason: "malformed log / missing required field / invalid revision を Rules 側で拒否するため。",
  },
  {
    title: "tanks update allowlist",
    target: "tanks",
    reason: "status / location / latestLogId など、workflow が触る field を段階的に制限するため。",
  },
  {
    title: "transaction delete full-deny policy",
    target: "transactions",
    reason: "delete は adminOnly に寄せています。管理者にも物理削除を許可しない完全 deny 方針は別途検討します。",
  },
  {
    title: "staffByEmail casing policy",
    target: "staffByEmail",
    reason: "Firebase Auth email と doc id の大文字小文字ズレを deploy 前に潰すため。",
  },
  {
    title: "passcode session policy",
    target: "staff auth",
    reason: "passcode-only session は Rules 上 staff にならないため、本番化時の扱いを明文化するため。",
  },
  {
    title: "customerUsers.status existing field policy",
    target: "customerUsers",
    reason: "status を派生値に寄せる方針と既存 field の整合を取るため。",
  },
  {
    title: "firebase.json / Security Rules deploy procedure",
    target: "deploy",
    reason: "Rules 本番化は Hosting deploy と分離した専用手順で進めるため。",
  },
];
