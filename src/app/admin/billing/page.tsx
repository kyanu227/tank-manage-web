"use client";

import { useState, useEffect } from "react";
import { Printer } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { logsRepository } from "@/lib/firebase/repositories";
import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
  type CustomerIdentityGroup,
} from "@/lib/customer-identity-read";
import { isLendTankLogAction } from "@/lib/tank-action-status-codes";

type CustomerMaster = {
  customerId: string;
  customerName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
};

interface BillItem {
  key: string;
  customerId?: string;
  customerName: string;
  count: number;
  total10: number;
  total12: number;
  totalPrice: number;
  isLegacy: boolean;
  pricingResolved: boolean;
}

type BillingGroup = CustomerIdentityGroup & {
  count: number;
  pricing?: CustomerMaster;
  pricingResolved: boolean;
};

function addCustomerNameIndex(
  index: Map<string, CustomerMaster[]>,
  name: unknown,
  customer: CustomerMaster,
) {
  const normalized = normalizeCustomerIdentityText(name);
  if (!normalized) return;
  const current = index.get(normalized) ?? [];
  if (!current.some((item) => item.customerId === customer.customerId)) {
    current.push(customer);
  }
  index.set(normalized, current);
}

export default function BillingPage() {
  const [bills, setBills] = useState<BillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    (async () => {
      try {
        // Get log data to aggregate by customer
        const logs = await logsRepository.getActiveLogs();
        // Get customer pricing
        const custSnap = await getDocs(collection(db, "customers"));
        const customerById = new Map<string, CustomerMaster>();
        const customersByName = new Map<string, CustomerMaster[]>();
        custSnap.forEach((d) => {
          const data = d.data();
          const customerName =
            normalizeCustomerIdentityText(data.name)
            ?? normalizeCustomerIdentityText(data.companyName)
            ?? d.id;
          const customer: CustomerMaster = {
            customerId: d.id,
            customerName,
            price10: Number(data.price10) || 0,
            price12: Number(data.price12) || 0,
            priceAluminum: Number(data.priceAluminum) || 0,
          };
          customerById.set(customer.customerId, customer);
          addCustomerNameIndex(customersByName, data.name, customer);
          addCustomerNameIndex(customersByName, data.companyName, customer);
          addCustomerNameIndex(customersByName, customer.customerName, customer);
        });

        const [y, m] = period.split("-").map(Number);
        const groups = new Map<string, BillingGroup>();
        logs.forEach((log) => {
          if (!isLendTankLogAction(log.action, log.transitionAction) || !log.timestamp?.toDate) return;
          const dt = log.timestamp.toDate();
          if (dt.getFullYear() !== y || dt.getMonth() + 1 !== m) return;
          const customerId = normalizeCustomerIdentityText(log.customerId);
          const customerMaster = customerId ? customerById.get(customerId) : undefined;
          const group = buildCustomerIdentityGroup(
            {
              customerId: log.customerId,
              customerName: log.customerName,
              location: log.location,
            },
            { currentCustomerName: customerMaster?.customerName },
          );
          const existing = groups.get(group.key);
          if (existing) {
            existing.count += 1;
            return;
          }

          let pricing: CustomerMaster | undefined;
          if (group.customerId) {
            pricing = customerById.get(group.customerId);
          } else {
            const candidates = customersByName.get(group.displayName) ?? [];
            pricing = candidates.length === 1 ? candidates[0] : undefined;
          }

          groups.set(group.key, {
            ...group,
            count: 1,
            pricing,
            pricingResolved: Boolean(pricing),
          });
        });

        const items: BillItem[] = Array.from(groups.values()).map((group) => {
          const p = group.pricing || { price10: 0, price12: 0 };
          return {
            key: group.key,
            customerId: group.customerId,
            customerName: group.displayName,
            count: group.count,
            total10: group.count,
            total12: 0,
            totalPrice: group.count * p.price10,
            isLegacy: group.isLegacy,
            pricingResolved: group.pricingResolved,
          };
        }).sort((a, b) => b.count - a.count);
        setBills(items);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [period]);

  const grandTotal = bills.reduce((s, b) => s + b.totalPrice, 0);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>請求書発行</h1>
          <p style={{ fontSize: 14, color: "#94a3b8" }}>月次の貸出先別請求データ</p>
        </div>
        <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, fontWeight: 600, color: "#334155", outline: "none" }} />
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
      ) : bills.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
          {period} の貸出データがありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {bills.map((b) => (
            <div key={b.key} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "20px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>{b.customerName}</h3>
                  {b.isLegacy && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 7px" }}>
                      旧形式データ
                    </span>
                  )}
                  {!b.pricingResolved && (
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "3px 7px" }}>
                      単価未設定
                    </span>
                  )}
                </div>
                <button onClick={() => window.print()}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Printer size={14} /> 印刷
                </button>
              </div>
              <div style={{ display: "flex", gap: 20 }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>貸出件数</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#6366f1" }}>{b.count}<span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8" }}> 本</span></p>
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>請求額</p>
                  <p style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>¥{b.totalPrice.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 14, padding: "20px 20px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>合計請求額</span>
            <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace" }}>¥{grandTotal.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
