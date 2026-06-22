"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { calculateBillingLineBreakdown, type BillingLineBreakdown } from "@/lib/billing/calculate";
import {
  DEFAULT_BILLING_INVOICE_SETTINGS,
  normalizeBillingInvoiceSettings,
  type BillingInvoiceSettings,
  type BillingRoundingMode,
  type BillingTaxMode,
} from "@/lib/billing/settings";
import {
  buildCustomerIdentityGroup,
  normalizeCustomerIdentityText,
  type CustomerIdentityGroup,
} from "@/lib/customer-identity-read";
import { db } from "@/lib/firebase/config";
import { logsRepository } from "@/lib/firebase/repositories";
import {
  getBillingInvoiceSettings,
  saveBillingInvoiceSettings,
} from "@/lib/firebase/billing-settings-service";
import { isLendTankLogAction } from "@/lib/tank-action-status-codes";

type BillingTab = "list" | "settings";

type PrintMode =
  | { type: "single"; billKey: string }
  | { type: "all" }
  | null;

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

function formatIssueDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  return year && month ? `${year}年${Number(month)}月分` : period;
}

function fieldStyle(multiline = false): CSSProperties {
  return {
    width: "100%",
    minHeight: multiline ? 86 : undefined,
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid #dbe3ee",
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
  const [selectedBillKey, setSelectedBillKey] = useState<string | null>(null);
  const [settings, setSettings] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<BillingInvoiceSettings>(DEFAULT_BILLING_INVOICE_SETTINGS);
  const [activeTab, setActiveTab] = useState<BillingTab>("list");
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [printMode, setPrintMode] = useState<PrintMode>(null);
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const issueDate = useMemo(() => formatIssueDate(new Date()), []);

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
        }).sort((a, b) => b.breakdown.total - a.breakdown.total || a.recipientName.localeCompare(b.recipientName));
        setBills(items);
        setSelectedBillKey((current) => {
          if (current && items.some((item) => item.key === current)) return current;
          return items[0]?.key ?? null;
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [period]);

  useEffect(() => {
    const handleAfterPrint = () => setPrintMode(null);
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

  const selectedBill = bills.find((bill) => bill.key === selectedBillKey) ?? bills[0];
  const printBills = printMode?.type === "all"
    ? bills
    : printMode?.type === "single"
      ? bills.filter((bill) => bill.key === printMode.billKey)
      : selectedBill
        ? [selectedBill]
        : [];
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

  const requestPrint = (mode: Exclude<PrintMode, null>) => {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <>
      <style>{PRINT_STYLES}</style>
      <div className="billing-admin-shell">
        <div className="billing-header">
          <div>
            <h1 className="billing-title">請求書発行</h1>
            <p className="billing-subtitle">月次の貸出先別請求データ / 請求書設定</p>
          </div>
          <div className="billing-actions">
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="billing-month"
            />
            <button
              type="button"
              className="billing-secondary-button"
              onClick={() => setActiveTab("settings")}
            >
              設定を開く
            </button>
            <button
              type="button"
              className="billing-primary-button"
              onClick={() => requestPrint({ type: "all" })}
              disabled={bills.length === 0}
            >
              <Printer size={15} /> 全請求書をPDF保存
            </button>
          </div>
        </div>

        <div className="billing-tabs">
          <TabButton active={activeTab === "list"} onClick={() => setActiveTab("list")}>
            請求書一覧
          </TabButton>
          <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
            請求書設定
          </TabButton>
        </div>

        <div className="billing-note">
          顧客別単価は「顧客管理」の price10 / price12 / priceAluminum を使用します。
          請求書文言・税率・振込先はこの画面の設定から変更できます。
          PDF保存は印刷画面で「PDFとして保存」を選択してください。
        </div>

        {activeTab === "settings" ? (
          <BillingSettingsForm
            settings={settingsDraft}
            saving={savingSettings}
            onChange={updateDraft}
            onSave={saveSettings}
          />
        ) : loading ? (
          <div className="billing-empty">読み込み中…</div>
        ) : bills.length === 0 ? (
          <div className="billing-empty">{period} の貸出データがありません</div>
        ) : (
          <div className="billing-workspace">
            <aside className="billing-list">
              <div className="billing-list-header">
                <div>
                  <p className="billing-list-label">請求対象</p>
                  <strong>{bills.length}件</strong>
                </div>
                <div className="billing-list-total">{money(grandTotal)}</div>
              </div>
              <div className="billing-list-body">
                {bills.map((bill) => (
                  <button
                    key={bill.key}
                    type="button"
                    className={`billing-list-item ${bill.key === selectedBill?.key ? "is-selected" : ""}`}
                    onClick={() => setSelectedBillKey(bill.key)}
                  >
                    <span className="billing-list-name">{bill.recipientName}</span>
                    <span className="billing-list-meta">
                      {bill.count}本 / {money(bill.breakdown.total)}
                    </span>
                    <span className="billing-list-badges">
                      {bill.isLegacy && settings.showLegacyWarning && <span>旧形式</span>}
                      {!bill.pricingResolved && <span>単価未設定</span>}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section className="billing-preview-column">
              <div className="billing-preview-toolbar">
                <div>
                  <p className="billing-list-label">請求書プレビュー</p>
                  <strong>{selectedBill?.recipientName ?? "-"}</strong>
                </div>
                <button
                  type="button"
                  className="billing-primary-button"
                  onClick={() => selectedBill && requestPrint({ type: "single", billKey: selectedBill.key })}
                  disabled={!selectedBill}
                >
                  <Printer size={15} /> この請求書をPDF保存
                </button>
              </div>
              {selectedBill && (
                <InvoiceDocument
                  bill={selectedBill}
                  period={period}
                  issueDate={issueDate}
                  settings={settings}
                />
              )}
            </section>
          </div>
        )}
      </div>

      <div className="billing-print-root" aria-hidden={printMode === null}>
        {printBills.map((bill) => (
          <InvoiceDocument
            key={bill.key}
            bill={bill}
            period={period}
            issueDate={issueDate}
            settings={settings}
            printOnly
          />
        ))}
      </div>
    </>
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
      className={`billing-tab ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );
}

function InvoiceDocument({
  bill,
  period,
  issueDate,
  settings,
  printOnly = false,
}: {
  bill: BillItem;
  period: string;
  issueDate: string;
  settings: BillingInvoiceSettings;
  printOnly?: boolean;
}) {
  const bankLines = [
    settings.bankName,
    settings.bankBranch,
    settings.bankAccountType,
    settings.bankAccountNumber,
    settings.bankAccountHolder,
  ].filter(Boolean);

  return (
    <article className={`invoice-paper ${printOnly ? "is-print" : ""}`}>
      <header className="invoice-header">
        <div className="invoice-recipient">
          <p className="invoice-kicker">ご請求先</p>
          <h2>{bill.recipientName} {settings.recipientSuffix}</h2>
          <p className="invoice-period">{formatPeriod(period)}</p>
        </div>
        <div className="invoice-issuer">
          <h1>{settings.invoiceTitle}</h1>
          <p>発行日: {issueDate}</p>
          <strong>{settings.issuerName || "発行者名未設定"}</strong>
          {settings.issuerPostalCode && <span>〒{settings.issuerPostalCode}</span>}
          {settings.issuerAddress && <span>{settings.issuerAddress}</span>}
          {settings.issuerPhone && <span>TEL: {settings.issuerPhone}</span>}
          {settings.issuerRegistrationNumber && <span>登録番号: {settings.issuerRegistrationNumber}</span>}
        </div>
      </header>

      {settings.greetingText && (
        <p className="invoice-greeting">{settings.greetingText}</p>
      )}

      <section className="invoice-total-box">
        <span>ご請求金額</span>
        <strong>{money(bill.breakdown.total)}</strong>
      </section>

      <section className="invoice-table-wrap">
        <table className="invoice-table">
          <thead>
            <tr>
              <th>品目</th>
              <th>数量</th>
              {settings.showUnitPrice && <th>単価</th>}
              <th>金額</th>
            </tr>
          </thead>
          <tbody>
            {bill.breakdown.lineItems.map((line) => (
              <tr key={line.label}>
                <td>{line.label}</td>
                <td className="number-cell">{line.quantity}</td>
                {settings.showUnitPrice && <td className="number-cell">{money(line.unitPrice)}</td>}
                <td className="number-cell">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="invoice-summary">
        <AmountRow label="小計" value={bill.breakdown.subtotal} />
        {settings.showTaxBreakdown && settings.taxMode !== "none" && (
          <AmountRow
            label={`消費税（${settings.taxMode === "inclusive" ? "内税" : "外税"} ${percentLabel(settings.taxRate)}）`}
            value={bill.breakdown.tax}
          />
        )}
        <AmountRow label="合計" value={bill.breakdown.total} emphasis />
      </section>

      <section className="invoice-detail-grid">
        <div>
          {settings.paymentDueText && <p className="invoice-strong">{settings.paymentDueText}</p>}
          {bankLines.length > 0 && (
            <p>振込先: {bankLines.join(" / ")}</p>
          )}
        </div>
        <div>
          {settings.notes && <p>{settings.notes}</p>}
          {settings.footerText && <p>{settings.footerText}</p>}
        </div>
      </section>

      {(bill.isLegacy || !bill.pricingResolved) && (
        <section className="invoice-warnings">
          {bill.isLegacy && settings.showLegacyWarning && (
            <p>旧形式データのため、顧客IDではなく過去の貸出先名で集計しています。</p>
          )}
          {!bill.pricingResolved && (
            <p>単価が解決できないため、金額が0円になっています。顧客管理の単価設定を確認してください。</p>
          )}
        </section>
      )}
    </article>
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
    <div className={`invoice-amount-row ${emphasis ? "is-emphasis" : ""}`}>
      <span>{label}</span>
      <strong>{money(value)}</strong>
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
    <div className="billing-settings-panel">
      {!settings.issuerName.trim() && (
        <div className="billing-warning">
          発行者名が未設定です。請求書には「発行者名未設定」と表示されます。
        </div>
      )}
      <SettingsSection title="基本文言">
        <TextField label="請求書タイトル" value={settings.invoiceTitle} onChange={(value) => onChange("invoiceTitle", value)} />
        <TextField label="宛名敬称" value={settings.recipientSuffix} onChange={(value) => onChange("recipientSuffix", value)} />
        <TextField label="明細品目名" value={settings.invoiceItemLabel} onChange={(value) => onChange("invoiceItemLabel", value)} />
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

      <div className="billing-settings-actions">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="billing-primary-button"
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
    <section className="billing-settings-section">
      <h3>{title}</h3>
      <div className="billing-settings-grid">
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
    <label className="billing-check-field">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラー";
}

const PRINT_STYLES = `
  .billing-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 18px;
    flex-wrap: wrap;
  }
  .billing-title {
    font-size: 24px;
    font-weight: 900;
    color: #0f172a;
    margin: 0 0 4px;
  }
  .billing-subtitle {
    font-size: 14px;
    color: #94a3b8;
    margin: 0;
  }
  .billing-actions,
  .billing-tabs,
  .billing-preview-toolbar,
  .billing-list-header,
  .billing-list-badges {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .billing-month {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #dbe3ee;
    font-size: 14px;
    font-weight: 700;
    color: #334155;
    outline: none;
  }
  .billing-primary-button,
  .billing-secondary-button,
  .billing-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 9px;
    font-size: 13px;
    font-weight: 850;
    cursor: pointer;
    border: 1px solid transparent;
    min-height: 36px;
    padding: 8px 13px;
  }
  .billing-primary-button {
    background: #0f172a;
    color: #fff;
  }
  .billing-primary-button:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }
  .billing-secondary-button {
    background: #fff;
    color: #475569;
    border-color: #dbe3ee;
  }
  .billing-tabs {
    margin-bottom: 14px;
  }
  .billing-tab {
    border-color: #dbe3ee;
    background: #fff;
    color: #64748b;
    border-radius: 999px;
  }
  .billing-tab.is-active {
    background: #eef2ff;
    color: #4338ca;
    border-color: #6366f1;
  }
  .billing-note {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    color: #475569;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.6;
    margin-bottom: 16px;
    padding: 10px 12px;
  }
  .billing-empty,
  .billing-settings-panel {
    background: #fff;
    border: 1px solid #e8eaed;
    border-radius: 14px;
    padding: 18px;
  }
  .billing-empty {
    color: #94a3b8;
    font-size: 14px;
    padding: 44px;
    text-align: center;
  }
  .billing-workspace {
    display: grid;
    grid-template-columns: minmax(250px, 320px) minmax(0, 1fr);
    gap: 18px;
    align-items: start;
  }
  .billing-list,
  .billing-preview-column {
    min-width: 0;
  }
  .billing-list {
    background: #fff;
    border: 1px solid #e8eaed;
    border-radius: 14px;
    overflow: hidden;
    position: sticky;
    top: 16px;
  }
  .billing-list-header {
    justify-content: space-between;
    border-bottom: 1px solid #eef2f7;
    padding: 14px;
  }
  .billing-list-label {
    color: #94a3b8;
    font-size: 11px;
    font-weight: 900;
    margin: 0 0 3px;
  }
  .billing-list-total {
    color: #0f172a;
    font-family: monospace;
    font-size: 17px;
    font-weight: 900;
  }
  .billing-list-body {
    display: grid;
    gap: 0;
  }
  .billing-list-item {
    background: #fff;
    border: 0;
    border-bottom: 1px solid #f1f5f9;
    color: #0f172a;
    cursor: pointer;
    display: grid;
    gap: 5px;
    padding: 13px 14px;
    text-align: left;
    width: 100%;
  }
  .billing-list-item.is-selected {
    background: #eef2ff;
  }
  .billing-list-name {
    font-size: 14px;
    font-weight: 900;
  }
  .billing-list-meta {
    color: #64748b;
    font-size: 12px;
    font-weight: 750;
  }
  .billing-list-badges span {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    color: #64748b;
    font-size: 10px;
    font-weight: 850;
    padding: 2px 7px;
  }
  .billing-preview-toolbar {
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .invoice-paper {
    background: #fff;
    border: 1px solid #e2e8f0;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.08);
    color: #0f172a;
    margin: 0 auto;
    max-width: 794px;
    min-height: 1080px;
    padding: 48px;
    width: 100%;
  }
  .invoice-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 0.8fr);
    gap: 28px;
    margin-bottom: 28px;
  }
  .invoice-kicker,
  .invoice-period {
    color: #64748b;
    font-size: 12px;
    font-weight: 800;
    margin: 0 0 7px;
  }
  .invoice-recipient h2 {
    border-bottom: 1px solid #0f172a;
    font-size: 24px;
    font-weight: 900;
    margin: 0 0 12px;
    padding-bottom: 8px;
  }
  .invoice-issuer {
    display: grid;
    justify-items: end;
    text-align: right;
    color: #334155;
    font-size: 12px;
    line-height: 1.6;
  }
  .invoice-issuer h1 {
    font-size: 31px;
    font-weight: 950;
    letter-spacing: 0.02em;
    margin: 0 0 8px;
  }
  .invoice-issuer p,
  .invoice-issuer strong {
    margin: 0;
  }
  .invoice-greeting {
    color: #334155;
    font-size: 13px;
    line-height: 1.8;
    margin: 0 0 18px;
  }
  .invoice-total-box {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
    margin: 0 0 28px;
    padding: 0 0 8px;
  }
  .invoice-total-box span {
    font-size: 14px;
    font-weight: 900;
  }
  .invoice-total-box strong {
    border-bottom: 2px solid #0f172a;
    font-family: monospace;
    font-size: 30px;
    font-weight: 950;
    line-height: 1.15;
    min-width: 220px;
    padding-bottom: 4px;
    text-align: right;
  }
  .invoice-table-wrap {
    margin-bottom: 18px;
  }
  .invoice-table {
    border-collapse: collapse;
    font-size: 12px;
    width: 100%;
  }
  .invoice-table th,
  .invoice-table td {
    border: 0;
    border-bottom: 1px solid #cbd5e1;
    padding: 10px 8px;
  }
  .invoice-table th {
    background: transparent;
    border-bottom: 1.5px solid #0f172a;
    color: #475569;
    font-weight: 900;
    text-align: left;
  }
  .number-cell {
    font-family: monospace;
    text-align: right;
  }
  .invoice-summary {
    display: grid;
    gap: 6px;
    justify-content: end;
    margin-bottom: 22px;
  }
  .invoice-amount-row {
    display: grid;
    grid-template-columns: 150px 130px;
    gap: 14px;
    align-items: baseline;
    color: #334155;
    font-size: 13px;
    font-weight: 800;
  }
  .invoice-amount-row span {
    text-align: right;
  }
  .invoice-amount-row strong {
    color: #0f172a;
    font-family: monospace;
    text-align: right;
  }
  .invoice-amount-row.is-emphasis {
    border-top: 2px solid #0f172a;
    font-size: 17px;
    padding-top: 7px;
  }
  .invoice-detail-grid {
    border-top: 1px solid #e2e8f0;
    color: #475569;
    display: grid;
    font-size: 12px;
    gap: 18px;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    line-height: 1.7;
    padding-top: 16px;
  }
  .invoice-detail-grid p {
    margin: 0 0 6px;
  }
  .invoice-strong {
    color: #0f172a;
    font-weight: 900;
  }
  .invoice-warnings {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    color: #9a3412;
    font-size: 11px;
    font-weight: 750;
    line-height: 1.6;
    margin-top: 18px;
    padding: 10px 12px;
  }
  .invoice-warnings p {
    margin: 0;
  }
  .billing-settings-section {
    border-top: 1px solid #f1f5f9;
    margin-top: 14px;
    padding-top: 14px;
  }
  .billing-settings-section:first-of-type {
    border-top: 0;
    margin-top: 0;
    padding-top: 0;
  }
  .billing-settings-section h3 {
    color: #0f172a;
    font-size: 14px;
    font-weight: 900;
    margin: 0 0 12px;
  }
  .billing-settings-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
  .billing-warning {
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 9px;
    color: #9a3412;
    font-size: 12px;
    font-weight: 800;
    margin-bottom: 14px;
    padding: 9px 11px;
  }
  .billing-settings-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
  .billing-check-field {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #334155;
    padding: 9px 11px;
    border: 1px solid #dbe3ee;
    border-radius: 8px;
  }
  .billing-print-root {
    display: none;
  }
  @media (max-width: 920px) {
    .billing-workspace {
      grid-template-columns: 1fr;
    }
    .billing-list {
      position: static;
    }
    .invoice-paper {
      min-height: auto;
      padding: 28px;
    }
    .invoice-header,
    .invoice-detail-grid {
      grid-template-columns: 1fr;
    }
    .invoice-issuer {
      justify-items: start;
      text-align: left;
    }
  }
  @media print {
    @page {
      size: A4;
      margin: 12mm;
    }
    html,
    body {
      background: #fff !important;
    }
    body * {
      visibility: hidden !important;
    }
    .billing-admin-shell {
      display: none !important;
    }
    .billing-print-root {
      display: block !important;
      left: 0;
      position: absolute;
      top: 0;
      width: 100%;
    }
    .billing-print-root,
    .billing-print-root * {
      visibility: visible !important;
    }
    .invoice-paper {
      border: 0;
      box-shadow: none;
      box-sizing: border-box;
      margin: 0;
      max-width: none;
      min-height: auto;
      padding: 0;
      page-break-after: always;
      width: 100%;
    }
    .invoice-paper:last-child {
      page-break-after: auto;
    }
    .invoice-warnings {
      background: #fff;
      border-color: #f3d6a1;
      color: #7c2d12;
    }
  }
`;
