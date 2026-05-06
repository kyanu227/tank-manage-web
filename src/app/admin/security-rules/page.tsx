"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Info,
  LockKeyhole,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import {
  AUTH_ROLE_OVERVIEW,
  COLLECTION_ACCESS_MATRIX,
  NEXT_SECURITY_RULES_HARDENING,
  RULES_CURRENT_STATE,
  SECURITY_RULES_CAUTIONS,
  WORKFLOW_RULES_OVERVIEW,
  type RulesStatus,
} from "@/lib/admin/securityRulesOverview";

const statusLabels: Record<RulesStatus, string> = {
  pass: "pass",
  caution: "caution",
  broad: "broad",
  "not-deployed": "not deployed",
};

const statusStyles: Record<RulesStatus, { bg: string; color: string; border: string }> = {
  pass: { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0" },
  caution: { bg: "#fffbeb", color: "#b45309", border: "#fde68a" },
  broad: { bg: "#fff7ed", color: "#c2410c", border: "#fed7aa" },
  "not-deployed": { bg: "#eef2ff", color: "#4338ca", border: "#c7d2fe" },
};

function StatusBadge({ status }: { status: RulesStatus }) {
  const style = statusStyles[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        width: "fit-content",
        padding: "3px 9px",
        borderRadius: 999,
        background: style.bg,
        color: style.color,
        border: `1px solid ${style.border}`,
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: style.color,
        }}
      />
      {statusLabels[status]}
    </span>
  );
}

function SectionHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "#eef2ff",
          color: "#4f46e5",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{title}</h2>
        <p style={{ margin: "5px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
          {description}
        </p>
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e8eaed",
        borderRadius: 10,
        padding: 18,
      }}
    >
      {children}
    </section>
  );
}

function TextCell({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "12px 14px", verticalAlign: "top", fontSize: 13, lineHeight: 1.55 }}>{children}</td>;
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: "left",
        fontSize: 11,
        fontWeight: 800,
        color: "#64748b",
        background: "#f8fafc",
        borderBottom: "1px solid #e8eaed",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

export default function SecurityRulesOverviewPage() {
  return (
    <div style={{ padding: "24px 24px 40px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 10px",
            borderRadius: 999,
            background: "#eef2ff",
            color: "#4338ca",
            fontSize: 12,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          <ShieldCheck size={14} />
          開発者向け read-only overview
        </div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#0f172a", letterSpacing: 0 }}>
          Security Rules Overview
        </h1>
        <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14, lineHeight: 1.7 }}>
          repo 上の <code>firestore.rules</code> draft を人間が確認しやすい粒度に整理した静的 overview です。
          Firestore data は読まず、Security Rules deploy も実行しません。
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: 14,
          border: "1px solid #fed7aa",
          borderRadius: 10,
          background: "#fff7ed",
          color: "#9a3412",
          marginBottom: 18,
        }}
      >
        <AlertTriangle size={18} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 13, lineHeight: 1.65 }}>
          <strong>本番 Security Rules には未反映です。</strong>
          このページは static config を表示するだけで、<code>firestore.rules</code> の自動解析や Firestore 読み取りは行いません。
          Hosting deploy と Security Rules deploy は分離して扱います。
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginBottom: 18 }}>
        {RULES_CURRENT_STATE.map((item) => (
          <div key={item.label} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 10, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>{item.label}</div>
              <StatusBadge status={item.status} />
            </div>
            <div style={{ marginTop: 8, fontSize: 17, fontWeight: 900, color: "#0f172a" }}>{item.value}</div>
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>{item.detail}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gap: 18 }}>
        <Panel>
          <SectionHeader
            icon={<LockKeyhole size={18} />}
            title="認証ロール"
            description="Rules 上で actor がどう解釈されるかを整理しています。passcode localStorage session は Firebase Auth ではないため、Rules 上 staff としては扱われません。"
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {AUTH_ROLE_OVERVIEW.map((role) => (
              <div key={role.role} style={{ border: "1px solid #e8eaed", borderRadius: 8, padding: 14, background: "#f8fafc" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>{role.role}</div>
                  <StatusBadge status={role.status} />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 800, color: "#475569" }}>{role.rulesTreatment}</div>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{role.accessSummary}</p>
                {role.caution && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#b45309", lineHeight: 1.6 }}>{role.caution}</p>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            icon={<Database size={18} />}
            title="Collection Access Matrix"
            description="細かい Rules 式ではなく、誰が read / create / update / delete できるかを運用判断しやすい粒度でまとめています。"
          />
          <div style={{ overflowX: "auto", border: "1px solid #e8eaed", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <HeaderCell>collection</HeaderCell>
                  <HeaderCell>read</HeaderCell>
                  <HeaderCell>create</HeaderCell>
                  <HeaderCell>update</HeaderCell>
                  <HeaderCell>delete</HeaderCell>
                  <HeaderCell>status</HeaderCell>
                  <HeaderCell>note</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {COLLECTION_ACCESS_MATRIX.map((row) => (
                  <tr key={row.collection} style={{ borderBottom: "1px solid #eef2f7" }}>
                    <TextCell><strong style={{ color: "#0f172a" }}>{row.collection}</strong></TextCell>
                    <TextCell>{row.read}</TextCell>
                    <TextCell>{row.create}</TextCell>
                    <TextCell>{row.update}</TextCell>
                    <TextCell>{row.delete}</TextCell>
                    <TextCell><StatusBadge status={row.status} /></TextCell>
                    <TextCell><span style={{ color: "#64748b" }}>{row.note}</span></TextCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            icon={<Workflow size={18} />}
            title="Workflow Overview"
            description="主要 workflow がどの helper / allow 条件に乗っているかを確認するための一覧です。tanks/logs を含む staff workflow は一部 broad な write が残っています。"
          />
          <div style={{ overflowX: "auto", border: "1px solid #e8eaed", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <HeaderCell>workflow</HeaderCell>
                  <HeaderCell>actor</HeaderCell>
                  <HeaderCell>collection</HeaderCell>
                  <HeaderCell>operation</HeaderCell>
                  <HeaderCell>helper / summary</HeaderCell>
                  <HeaderCell>status</HeaderCell>
                  <HeaderCell>note</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {WORKFLOW_RULES_OVERVIEW.map((workflow) => (
                  <tr key={workflow.name} style={{ borderBottom: "1px solid #eef2f7" }}>
                    <TextCell><strong style={{ color: "#0f172a" }}>{workflow.name}</strong></TextCell>
                    <TextCell>{workflow.actor}</TextCell>
                    <TextCell>{workflow.collection}</TextCell>
                    <TextCell>{workflow.operation}</TextCell>
                    <TextCell><code style={{ fontSize: 12 }}>{workflow.helper}</code></TextCell>
                    <TextCell><StatusBadge status={workflow.status} /></TextCell>
                    <TextCell><span style={{ color: "#64748b" }}>{workflow.note}</span></TextCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            icon={<AlertTriangle size={18} />}
            title="Caution / Blocker"
            description="Security Rules 本番化前に見落としたくない注意点です。ここにある項目を今回の画面追加PRでは修正しません。"
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {SECURITY_RULES_CAUTIONS.map((item) => (
              <div key={item.title} style={{ border: "1px solid #e8eaed", borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{item.title}</h3>
                  <StatusBadge status={item.status} />
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{item.detail}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <SectionHeader
            icon={<CheckCircle2 size={18} />}
            title="Next Hardening"
            description="次に切る rules-only / policy PR の候補です。firebase.json 接続と Security Rules deploy 手順は最後に回します。"
          />
          <div style={{ display: "grid", gap: 10 }}>
            {NEXT_SECURITY_RULES_HARDENING.map((item, index) => (
              <div
                key={item.title}
                style={{
                  display: "grid",
                  gridTemplateColumns: "44px minmax(0, 1fr)",
                  gap: 12,
                  alignItems: "start",
                  padding: 12,
                  border: "1px solid #e8eaed",
                  borderRadius: 8,
                  background: "#f8fafc",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "#e0f2fe",
                    color: "#0369a1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  {index + 1}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{item.title}</div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#64748b" }}>{item.target}</div>
                  <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{item.reason}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: 14,
            borderRadius: 10,
            background: "#f8fafc",
            border: "1px solid #e8eaed",
            color: "#475569",
            fontSize: 13,
            lineHeight: 1.65,
          }}
        >
          <Info size={17} style={{ marginTop: 2, flexShrink: 0 }} />
          <div>
            このページの内容は <code>src/lib/admin/securityRulesOverview.ts</code> の静的 config から表示しています。
            <code>firestore.rules</code> を自動解析しないため、Rules draft を変更した場合は overview config も同じPRで更新してください。
          </div>
        </div>
      </div>
    </div>
  );
}
