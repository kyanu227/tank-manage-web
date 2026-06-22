"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { db } from "@/lib/firebase/config";
import { collection, getDocs } from "firebase/firestore";
import { logsRepository } from "@/lib/firebase/repositories";
import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
  type CustomerIdentityGroup,
} from "@/lib/customer-identity-read";
import { calculateBillingLineBreakdown, type BillingLineBreakdown } from "@/lib/billing/calculate";
import {
  DEFAULT_BILLING_INVOICE_SETTINGS,
  normalizeBillingInvoiceSettings,
  type BillingInvoiceSettings,
  type BillingRoundingMode,
  type BillingTaxMode,
} from "@/lib/billing/settings";
import {
  getBillingInvoiceSettings,
  saveBillingInvoiceSettings,
} from "@/lib/firebase/billing-settings-service";
import { isLendTankLogAction } from "@/lib/tank-action-status-codes";

type BillingTab = "list" | "settings";

type CustomerMaster = {
  customerId: string;
  customerName: string;
  formalName: string;
  price10: number;
  price12: number;
  priceAluminum: number;
};

interface BillItem {
  key: string;
  customerId?: string;
  customerName: string;
  recipientName: string;
  count: number;
  isLegacy: boolean;
  pricingResolved: boolean;
  breakdown: BillingLineBreakdown;
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

function money(value: number): string {
  return `¥${Math.round(value).toLocaleString()}`;
}

function percentLabel(taxRate: number): string {
  return `${Math.round(taxRate * 1000) / 10}%`;
}

function fieldStyle(multiline = false): CSSProperties {
  return {
    width: "100%",
    minHeight: multiline ? 86 : undefined,
    padding: "9px 11px",
    borderRadius: 9,
    border: "1px solid #e2e8f0",
    fontSize: 13,
    color: "#334155",
    outline: "none",
    boxSizing: "border-box",
    resize: multiline ? "vertical" : undefined,
    background: "#fff",
  };
}

function labelStyle(): CSSProperties {
  return {
    display: "block",
    fontSize: 11,
    fontWeight: 800,
    color: "#64748b",
    marginBottom: 5,
  };
}

export default function BillingPage() {
  const [bills, setBills] = useState<BillItem[]>([]);
  const [settings, setSettings] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [activeTab, setActiveTab] = useState<BillingTab>("list");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [logs, custSnap, invoiceSettings] = await Promise.all([
          logsRepository.getActiveLogs(),
          getDocs(collection(db, "customers")),
          getBillingInvoiceSettings().catch((error) => {
            console.error("Fetch billing invoice settings error:", error);
            return DEFAULT_BILLING_INVOICE_SETTINGS;
          }),
        ]);
        const normalizedSettings = normalizeBillingInvoiceSettings(invoiceSettings);
        setSettings(normalizedSettings);
        setSettingsDraft(normalizedSettings);

        const customerById = new Map<string, CustomerMaster>();
        const customersByName = new Map<string, CustomerMaster[]>();
        custSnap.forEach((d) => {
          const data = d.data();
          const customerName =
            normalizeCustomerIdentityText(data.name)
            ?? normalizeCustomerIdentityText(data.companyName)
            ?? d.id;
          const formalName = normalizeCustomerIdentityText(data.formalName) ?? "";
          const customer: CustomerMaster = {
            customerId: d.id,
            customerName,
            formalName,
            price10: Number(data.price10) || 0,
            price12: Number(data.price12) || 0,
            priceAluminum: Number(data.priceAluminum) || 0,
          };
          customerById.set(customer.customerId, customer);
          addCustomerNameIndex(customersByName, data.name, customer);
          addCustomerNameIndex(customersByName, data.companyName, customer);
          addCustomerNameIndex(customersByName, data.formalName, customer);
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
          const p = group.pricing;
          const breakdown = calculateBillingLineBreakdown(
            {
              count: group.count,
              unitPrice10: p?.price10 ?? 0,
              unitPrice12: p?.price12 ?? 0,
              unitPriceAluminum: p?.priceAluminum ?? 0,
            },
            normalizedSettings,
          );
          return {
            key: group.key,
            customerId: group.customerId,
            customerName: group.displayName,
            recipientName: p?.formalName || p?.customerName || group.displayName,
            count: group.count,
            breakdown,
            isLegacy: group.isLegacy,
            pricingResolved: group.pricingResolved,
          };
        }).sort((a, b) => b.count - a.count || a.recipientName.localeCompare(b.recipientName));
        setBills(items);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  const grandSubtotal = bills.reduce((s, b) => s + b.breakdown.subtotal, 0);
  const grandTax = bills.reduce((s, b) => s + b.breakdown.tax, 0);
  const grandTotal = bills.reduce((s, b) => s + b.breakdown.total, 0);

  const updateDraft = <K extends keyof BillingInvoiceSettings>(
    key: K,
    value: BillingInvoiceSettings[K],
  ) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    const normalized = normalizeBillingInvoiceSettings(settingsDraft);
    if (!normalized.invoiceTitle) {
      alert("請求書タイトルを入力してください。");
      return;
    }
    if (!confirm("請求書設定を保存しますか？")) return;

    setSavingSettings(true);
    try {
      await saveBillingInvoiceSettings(normalized);
      const saved = await getBillingInvoiceSettings();
      setSettings(saved);
      setSettingsDraft(saved);
      alert("請求書設定を保存しました。");
    } catch (error: unknown) {
      console.error(error);
      alert(`保存に失敗しました: ${errorMessage(error)}`);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em", marginBottom: 4 }}>請求書発行</h1>
          <p style={{ fontSize: 14, color: "#94a3b8" }}>月次の貸出先別請求データ / 請求書設定</p>
        </div>
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 14, fontWeight: 600, color: "#334155", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <TabButton active={activeTab === "list"} onClick={() => setActiveTab("list")}>
          請求一覧
        </TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          請求書設定
        </TabButton>
      </div>

      <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", marginBottom: 16, color: "#475569", fontSize: 12, fontWeight: 700, lineHeight: 1.5 }}>
        顧客別単価は「顧客管理」の price10 / price12 / priceAluminum を使用します。
        請求書文言・税率・振込先はこの画面の設定から変更できます。
      </div>

      {activeTab === "settings" ? (
        <BillingSettingsForm
          settings={settingsDraft}
          saving={savingSettings}
          onChange={updateDraft}
          onSave={saveSettings}
        />
      ) : loading ? (
        <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>読み込み中…</div>
      ) : bills.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: 40, textAlign: "center", color: "#cbd5e1", fontSize: 14 }}>
          {period} の貸出データがありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {bills.map((b) => (
            <InvoicePreviewCard
              key={b.key}
              bill={b}
              period={period}
              settings={settings}
            />
          ))}

          <div style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", borderRadius: 14, padding: "20px 20px", color: "#fff", display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>合計請求額</span>
              <span style={{ fontSize: 26, fontWeight: 800, fontFamily: "monospace" }}>{money(grandTotal)}</span>
            </div>
            {settings.showTaxBreakdown && (
              <div style={{ display: "flex", gap: 16, fontSize: 12, fontWeight: 700, opacity: 0.9, flexWrap: "wrap" }}>
                <span>小計 {money(grandSubtotal)}</span>
                <span>税額 {money(grandTax)}</span>
                <span>{settings.taxMode === "inclusive" ? "税込" : settings.taxMode === "exclusive" ? "税抜" : "非課税"}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "9px 14px",
        borderRadius: 999,
        border: active ? "1px solid #6366f1" : "1px solid #e2e8f0",
        background: active ? "#eef2ff" : "#fff",
        color: active ? "#4338ca" : "#64748b",
        fontSize: 13,
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function InvoicePreviewCard({
  bill,
  period,
  settings,
}: {
  bill: BillItem;
  period: string;
  settings: BillingInvoiceSettings;
}) {
  const bankLines = [
    settings.bankName,
    settings.bankBranch,
    settings.bankAccountType,
    settings.bankAccountNumber,
    settings.bankAccountHolder,
  ].filter(Boolean);

  return (
    <article style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: "22px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", margin: 0 }}>{settings.invoiceTitle}</h2>
          <p style={{ color: "#64748b", fontSize: 13, fontWeight: 700, marginTop: 4 }}>対象月: {period}</p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          <Printer size={14} /> 印刷
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.8fr)", gap: 18, marginBottom: 18 }}>
        <div>
          <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 800, marginBottom: 4 }}>宛先</p>
          <h3 style={{ fontSize: 18, color: "#0f172a", fontWeight: 800, margin: 0 }}>{bill.recipientName}</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {bill.isLegacy && settings.showLegacyWarning && (
              <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b", background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 999, padding: "3px 7px" }}>
                旧形式データ
              </span>
            )}
            {!bill.pricingResolved && (
              <span style={{ fontSize: 10, fontWeight: 800, color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "3px 7px" }}>
                単価未設定
              </span>
            )}
          </div>
        </div>

        <div style={{ color: "#475569", fontSize: 12, lineHeight: 1.6 }}>
          <p style={{ fontWeight: 900, color: "#0f172a", margin: 0 }}>{settings.issuerName || "発行者名未設定"}</p>
          {settings.issuerPostalCode && <p style={{ margin: 0 }}>〒{settings.issuerPostalCode}</p>}
          {settings.issuerAddress && <p style={{ margin: 0 }}>{settings.issuerAddress}</p>}
          {settings.issuerPhone && <p style={{ margin: 0 }}>TEL: {settings.issuerPhone}</p>}
          {settings.issuerRegistrationNumber && <p style={{ margin: 0 }}>登録番号: {settings.issuerRegistrationNumber}</p>}
        </div>
      </div>

      {settings.greetingText && (
        <p style={{ color: "#334155", fontSize: 13, lineHeight: 1.7, margin: "0 0 16px" }}>
          {settings.greetingText}
        </p>
      )}

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: settings.showUnitPrice ? "1.4fr 0.6fr 0.8fr 0.8fr" : "1.6fr 0.7fr 0.9fr", background: "#f8fafc", color: "#64748b", fontSize: 11, fontWeight: 900 }}>
          <span style={{ padding: "9px 10px" }}>明細</span>
          <span style={{ padding: "9px 10px", textAlign: "right" }}>数量</span>
          {settings.showUnitPrice && <span style={{ padding: "9px 10px", textAlign: "right" }}>単価</span>}
          <span style={{ padding: "9px 10px", textAlign: "right" }}>小計</span>
        </div>
        <InvoiceLine
          label="10L貸出"
          quantity={bill.breakdown.quantity10}
          unitPrice={bill.breakdown.unitPrice10}
          subtotal={bill.breakdown.subtotal10}
          showUnitPrice={settings.showUnitPrice}
        />
      </div>

      <div style={{ display: "grid", gap: 6, justifyContent: "end", marginBottom: 14, color: "#334155", fontSize: 13 }}>
        <AmountRow label="小計" value={bill.breakdown.subtotal} />
        {settings.showTaxBreakdown && settings.taxMode !== "none" && (
          <AmountRow
            label={`消費税（${settings.taxMode === "inclusive" ? "内税" : "外税"} ${percentLabel(settings.taxRate)}）`}
            value={bill.breakdown.tax}
          />
        )}
        <AmountRow label="合計" value={bill.breakdown.total} emphasis />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, color: "#475569", fontSize: 12, lineHeight: 1.6 }}>
        <div>
          {settings.paymentDueText && <p style={{ margin: "0 0 6px", fontWeight: 800 }}>{settings.paymentDueText}</p>}
          {bankLines.length > 0 && (
            <p style={{ margin: 0 }}>
              振込先: {bankLines.join(" / ")}
            </p>
          )}
        </div>
        <div>
          {settings.notes && <p style={{ margin: "0 0 6px" }}>{settings.notes}</p>}
          {settings.footerText && <p style={{ margin: 0 }}>{settings.footerText}</p>}
        </div>
      </div>
    </article>
  );
}

function InvoiceLine({
  label,
  quantity,
  unitPrice,
  subtotal,
  showUnitPrice,
}: {
  label: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  showUnitPrice: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: showUnitPrice ? "1.4fr 0.6fr 0.8fr 0.8fr" : "1.6fr 0.7fr 0.9fr", color: "#0f172a", fontSize: 13, borderTop: "1px solid #e2e8f0" }}>
      <span style={{ padding: "10px 10px", fontWeight: 700 }}>{label}</span>
      <span style={{ padding: "10px 10px", textAlign: "right", fontFamily: "monospace" }}>{quantity}</span>
      {showUnitPrice && <span style={{ padding: "10px 10px", textAlign: "right", fontFamily: "monospace" }}>{money(unitPrice)}</span>}
      <span style={{ padding: "10px 10px", textAlign: "right", fontFamily: "monospace", fontWeight: 800 }}>{money(subtotal)}</span>
    </div>
  );
}

function AmountRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 120px", gap: 12, alignItems: "baseline", fontWeight: emphasis ? 900 : 700, fontSize: emphasis ? 17 : 13 }}>
      <span style={{ textAlign: "right", color: emphasis ? "#0f172a" : "#64748b" }}>{label}</span>
      <span style={{ textAlign: "right", fontFamily: "monospace", color: "#0f172a" }}>{money(value)}</span>
    </div>
  );
}

function BillingSettingsForm({
  settings,
  saving,
  onChange,
  onSave,
}: {
  settings: BillingInvoiceSettings;
  saving: boolean;
  onChange: <K extends keyof BillingInvoiceSettings>(key: K, value: BillingInvoiceSettings[K]) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 14, padding: 18 }}>
      {!settings.issuerName.trim() && (
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412", borderRadius: 10, padding: "9px 11px", fontSize: 12, fontWeight: 800, marginBottom: 14 }}>
          発行者名が未設定です。請求書には「発行者名未設定」と表示されます。
        </div>
      )}
      <SettingsSection title="基本文言">
        <TextField label="請求書タイトル" value={settings.invoiceTitle} onChange={(value) => onChange("invoiceTitle", value)} />
        <TextField label="支払期限文言" value={settings.paymentDueText} onChange={(value) => onChange("paymentDueText", value)} />
        <TextField label="挨拶文" value={settings.greetingText} onChange={(value) => onChange("greetingText", value)} multiline />
        <TextField label="備考" value={settings.notes} onChange={(value) => onChange("notes", value)} multiline />
        <TextField label="フッター文言" value={settings.footerText} onChange={(value) => onChange("footerText", value)} multiline />
      </SettingsSection>

      <SettingsSection title="発行者情報">
        <TextField label="発行者名" value={settings.issuerName} onChange={(value) => onChange("issuerName", value)} />
        <TextField label="郵便番号" value={settings.issuerPostalCode} onChange={(value) => onChange("issuerPostalCode", value)} />
        <TextField label="住所" value={settings.issuerAddress} onChange={(value) => onChange("issuerAddress", value)} />
        <TextField label="電話番号" value={settings.issuerPhone} onChange={(value) => onChange("issuerPhone", value)} />
        <TextField label="登録番号" value={settings.issuerRegistrationNumber} onChange={(value) => onChange("issuerRegistrationNumber", value)} />
      </SettingsSection>

      <SettingsSection title="振込先">
        <TextField label="銀行名" value={settings.bankName} onChange={(value) => onChange("bankName", value)} />
        <TextField label="支店名" value={settings.bankBranch} onChange={(value) => onChange("bankBranch", value)} />
        <TextField label="口座種別" value={settings.bankAccountType} onChange={(value) => onChange("bankAccountType", value)} />
        <TextField label="口座番号" value={settings.bankAccountNumber} onChange={(value) => onChange("bankAccountNumber", value)} />
        <TextField label="口座名義" value={settings.bankAccountHolder} onChange={(value) => onChange("bankAccountHolder", value)} />
      </SettingsSection>

      <SettingsSection title="税・表示">
        <NumberField
          label="税率（%）"
          value={String(Math.round(settings.taxRate * 1000) / 10)}
          onChange={(value) => onChange("taxRate", Math.min(1, Math.max(0, Number(value) / 100 || 0)))}
        />
        <SelectField<BillingTaxMode>
          label="税区分"
          value={settings.taxMode}
          options={[
            { value: "exclusive", label: "外税" },
            { value: "inclusive", label: "内税" },
            { value: "none", label: "税なし" },
          ]}
          onChange={(value) => onChange("taxMode", value)}
        />
        <SelectField<BillingRoundingMode>
          label="端数処理"
          value={settings.roundingMode}
          options={[
            { value: "floor", label: "切り捨て" },
            { value: "round", label: "四捨五入" },
            { value: "ceil", label: "切り上げ" },
          ]}
          onChange={(value) => onChange("roundingMode", value)}
        />
        <CheckField label="税内訳を表示" checked={settings.showTaxBreakdown} onChange={(value) => onChange("showTaxBreakdown", value)} />
        <CheckField label="単価を表示" checked={settings.showUnitPrice} onChange={(value) => onChange("showUnitPrice", value)} />
        <CheckField label="旧形式データ警告を表示" checked={settings.showLegacyWarning} onChange={(value) => onChange("showLegacyWarning", value)} />
      </SettingsSection>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: saving ? "#94a3b8" : "#0f172a",
            color: "#fff",
            fontSize: 13,
            fontWeight: 800,
            cursor: saving ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "保存中..." : "請求書設定を保存"}
        </button>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section style={{ borderTop: "1px solid #f1f5f9", paddingTop: 14, marginTop: 14 }}>
      <h3 style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", margin: "0 0 12px" }}>{title}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  multiline = false,
  onChange,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span style={labelStyle()}>{label}</span>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle(true)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle()} />
      )}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span style={labelStyle()}>{label}</span>
      <input type="number" min={0} max={100} step={0.1} value={value} onChange={(e) => onChange(e.target.value)} style={fieldStyle()} />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label>
      <span style={labelStyle()}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} style={fieldStyle()}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "#334155", padding: "9px 11px", border: "1px solid #e2e8f0", borderRadius: 9 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}
