"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Save } from "lucide-react";
import { auth, db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import {
  linkCustomerUsersToCustomers,
  listCustomerUsers,
  type CustomerUserAssignment,
  type PortalCustomerUser,
} from "@/lib/firebase/customer-linking-service";
import { findStaffProfileByEmailReadOnly } from "@/lib/firebase/staff-auth";
import { getStaffIdentity } from "@/hooks/useStaffSession";
import type { OperationActor } from "@/lib/operation-context";

interface Customer {
  id: string;
  name?: string;
  email?: string;
  companyName?: string;
  isActive?: boolean;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 12px", fontSize: 13, fontWeight: 500,
  border: "1px solid #e2e8f0", borderRadius: 8, outline: "none",
  background: "#fff", color: "#1e293b", transition: "border-color 0.15s",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: "none" as const, paddingRight: 28,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 10px center",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 20px", borderRadius: 10, border: "none",
  background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 700,
  cursor: "pointer", transition: "all 0.15s",
};

export default function PortalUsersPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [customerUserList, setCustomerUserList] = useState<PortalCustomerUser[]>([]);
  const [dirtyCustomerUserIds, setDirtyCustomerUserIds] = useState<string[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const custSnap = await getDocs(collection(db, "customers"));
      const custs: Customer[] = [];
      custSnap.forEach((c) => custs.push({ id: c.id, ...c.data() } as Customer));
      setCustomerList(custs.length > 0 ? custs : []);

      const customerUsers = await listCustomerUsers();
      setCustomerUserList(customerUsers);
      setDirtyCustomerUserIds([]);
    } catch (e) {
      console.error("Fetch portal users error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getCustomerDisplayName = (customer?: Customer) => (
    customer?.name || customer?.companyName || customer?.email || customer?.id || ""
  );

  const updateCustomerUser = (id: string, field: keyof PortalCustomerUser, value: any) => {
    setDirtyCustomerUserIds((prev) => prev.includes(id) ? prev : [...prev, id]);
    setCustomerUserList((prev) => prev.map((u) => (u.id === id ? { ...u, [field]: value } : u)));
  };

  const saveCustomerUsers = async () => {
    if (!confirm("ポータル利用者の紐付けを保存しますか？")) return;
    setSaving(true);
    try {
      const actor = await resolveAdminOperationActor();
      const assignments: CustomerUserAssignment[] = customerUserList
        .filter((u) => dirtyCustomerUserIds.includes(u.id))
        .map((u) => {
          const customerId = u.customerId || "";
          const linkedCustomer = customerList.find((c) => c.id === customerId);
          return {
            id: u.id,
            uid: u.uid,
            email: u.email,
            customerId,
            customerName: customerId ? getCustomerDisplayName(linkedCustomer) : "",
            status: u.status,
            setupCompleted: u.setupCompleted,
            updatedAt: u.updatedAt,
          };
        });

      await linkCustomerUsersToCustomers({ assignments, actor });
      await fetchAll();
      alert("ポータル利用者の紐付けを保存しました。");
    } catch (e: any) {
      alert("保存エラー: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>
        <RefreshCw size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
        <p style={{ fontSize: 14, fontWeight: 600 }}>データを読み込み中…</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
          ※ Google登録した利用者を既存の顧客マスタに紐付けます。紐付けると未紐付けの発注も承認待ちに移動します。
        </p>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e8eaed" }}>
              {["状態", "登録会社/氏名", "Google Email", "Google名", "紐付け先"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textAlign: "left", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customerUserList.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
                  Google登録済みのポータル利用者がいません。
                </td>
              </tr>
            ) : (
              customerUserList.map((u) => {
                const statusLabel =
                  u.status === "active" ? "紐付け済"
                    : u.status === "disabled" ? "停止中"
                      : u.status === "pending" ? "未紐付け"
                        : "初期設定中";
                const statusColor =
                  u.status === "active" ? "#10b981"
                    : u.status === "disabled" ? "#ef4444"
                      : u.status === "pending" ? "#f59e0b"
                        : "#94a3b8";
                return (
                <tr key={u.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center",
                      padding: "4px 8px", borderRadius: 999,
                      background: `${statusColor}14`, color: statusColor,
                      fontSize: 11, fontWeight: 800,
                    }}>
                      {statusLabel}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ fontWeight: 700, color: "#1e293b", fontSize: 13 }}>
                      {u.selfCompanyName || "会社名未入力"}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>
                      {u.selfName || "氏名未入力"}{u.lineName ? ` / LINE: ${u.lineName}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, fontFamily: "monospace", color: u.email ? "#1e293b" : "#94a3b8" }}>
                    {u.email || "メール未取得"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b" }}>
                    {u.displayName || "未取得"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <select
                      style={{ ...selectStyle, paddingRight: 32 }}
                      value={u.customerId || ""}
                      onChange={(e) => updateCustomerUser(u.id, "customerId", e.target.value)}
                    >
                      <option value="">-- 未紐付け --</option>
                      {customerList.filter(c => c.isActive !== false).map((c) => (
                        <option key={c.id} value={c.id}>
                          {getCustomerDisplayName(c)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20 }}>
        <button onClick={saveCustomerUsers} disabled={saving} style={btnPrimary}>
          <Save size={16} />
          {saving ? "保存中…" : "ポータル利用者の紐付けを保存"}
        </button>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

async function resolveAdminOperationActor(): Promise<OperationActor> {
  const cached = getStaffIdentity();
  if (cached) return cached;

  const email = auth.currentUser?.email?.trim();
  if (!email) {
    throw new Error("操作者を取得できませんでした。再ログインしてください。");
  }

  const profile = await findStaffProfileByEmailReadOnly(email);
  if (!profile || !profile.isActive) {
    throw new Error("操作者を取得できませんでした。再ログインしてください。");
  }

  return {
    staffId: profile.staffId,
    staffName: profile.name,
    ...(profile.email ? { staffEmail: profile.email } : {}),
    ...(profile.role ? { role: profile.role } : {}),
    ...(profile.rank ? { rank: profile.rank } : {}),
  };
}
