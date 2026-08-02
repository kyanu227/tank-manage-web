"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  FileText,
  HardHat,
  LineChart,
  Truck,
  Users,
} from "lucide-react";
import {
  logsRepository,
  tanksRepository,
  transactionsRepository,
} from "@/lib/firebase/repositories";
import { getPendingOperationReviewCount } from "@/lib/firebase/operation-review-service";
import { projectOfficialAggregationEvent } from "@/lib/tank-transition-projections";
import { useTankDataRevision } from "@/hooks/useTankDataRevision";
import { useTankOperationPolicy } from "@/hooks/useTankOperationPolicy";
import { useAdminCapabilities } from "@/hooks/useAdminCapabilities";
import { hasAdminCapability } from "@/lib/admin/adminCapabilities";
import styles from "./AdminDashboard.module.css";

type DashboardValue = number | null;
type DashboardValues = {
  todayOps: DashboardValue;
  renting: DashboardValue;
  activeStaff: DashboardValue;
  pending: DashboardValue;
  qualityReports: DashboardValue;
  operationReviews: DashboardValue;
};

const EMPTY_VALUES: DashboardValues = {
  todayOps: null,
  renting: null,
  activeStaff: null,
  pending: null,
  qualityReports: null,
  operationReviews: null,
};

function DashboardSection({ title, description, children }: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  icon,
  href,
  external = false,
  tone = "neutral",
  suffix,
}: {
  label: string;
  value?: DashboardValue;
  icon: ReactNode;
  href: string;
  external?: boolean;
  tone?: "neutral" | "warning" | "danger";
  suffix?: string;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={`${styles.metricCard} ${tone === "neutral" ? "" : styles[`tone_${tone}`]}`}
    >
      <div className={styles.metricIcon}>{icon}</div>
      <div className={styles.metricBody}>
        <span className={styles.metricLabel}>{label}</span>
        {value !== undefined && (
          <strong className={styles.metricValue}>
            {value === null ? "—" : value.toLocaleString()}
            {value !== null && suffix && <small>{suffix}</small>}
          </strong>
        )}
      </div>
      <ArrowRight size={17} className={styles.metricArrow} />
    </Link>
  );
}

export default function AdminDashboardPage() {
  const tankDataRevision = useTankDataRevision();
  const { capabilities } = useAdminCapabilities();
  const canReview = hasAdminCapability(capabilities, "reviews.view");
  const canBilling = hasAdminCapability(capabilities, "billing.view");
  const canSales = hasAdminCapability(capabilities, "analytics.sales.view");
  const canStaffAnalytics = hasAdminCapability(capabilities, "analytics.staff.view");
  const { policy, loading: policyLoading } = useTankOperationPolicy();
  const [values, setValues] = useState<DashboardValues>(EMPTY_VALUES);

  useEffect(() => {
    let cancelled = false;
    const fetchDashboardData = async () => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

      const [logs, tanks, pendingTxs, unchargedReports, operationReviews] = await Promise.all([
        logsRepository.getActiveLogs({ from: todayStart }).catch((error) => {
          console.error("本日の操作取得エラー:", error);
          return null;
        }),
        tanksRepository.getTanks({ status: "lent" }).catch((error) => {
          console.error("貸出中タンク取得エラー:", error);
          return null;
        }),
        transactionsRepository.getPendingTransactions().catch((error) => {
          console.error("現場対応待ち取得エラー:", error);
          return null;
        }),
        transactionsRepository.getUnchargedReports().catch((error) => {
          console.error("未充填報告取得エラー:", error);
          return null;
        }),
        canReview
          ? getPendingOperationReviewCount().catch((error) => {
            console.error("例外操作レビュー件数取得エラー:", error);
            return null;
          })
          : Promise.resolve(null),
      ]);

      if (cancelled) return;
      const officialLogs = logs?.filter((log) => projectOfficialAggregationEvent(log) !== null) ?? null;
      const staffSet = new Set<string>();
      officialLogs?.forEach((log) => {
        if (log.staffId) staffSet.add(log.staffId);
      });
      setValues({
        todayOps: officialLogs?.length ?? null,
        renting: tanks?.length ?? null,
        activeStaff: officialLogs ? staffSet.size : null,
        pending: pendingTxs?.length ?? null,
        qualityReports: unchargedReports?.length ?? null,
        operationReviews,
      });
    };

    void fetchDashboardData();
    return () => {
      cancelled = true;
    };
  }, [canReview, tankDataRevision]);

  const nonDefaultMode = !policyLoading && policy.transitionEnforcement !== "strict";

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeader}>
        <h1>ダッシュボード</h1>
        <p>いま確認・対応すべきことから、各業務画面へ移動できます。</p>
      </header>

      {nonDefaultMode && (
        <Link href="/admin/settings/tank-operations" className={styles.modeWarning}>
          <AlertTriangle size={18} />
          <span><strong>運用モードが自動補完です。</strong> 不一致操作は確認付きの正規経路へ展開されます。</span>
          <ArrowRight size={17} />
        </Link>
      )}

      {(canReview || canBilling) && (
        <DashboardSection title="要対応" description="管理画面で確認・完了する項目です。">
          <div className={styles.cardGrid}>
            {canReview && <MetricCard label="例外操作レビュー" value={values.operationReviews} suffix="件" icon={<ClipboardCheck size={20} />} href="/admin/operation-reviews" tone="warning" />}
            {canBilling && <MetricCard label="請求を確認" icon={<FileText size={20} />} href="/admin/billing" />}
          </div>
        </DashboardSection>
      )}

      <DashboardSection title="現場対応待ち" description="処理は現場アプリで行います。リンクは別タブで開きます。">
        <div className={styles.cardGrid}>
          <MetricCard label="受注・返却処理" value={values.pending} suffix="件" icon={<HardHat size={20} />} href="/staff/lend" external tone="warning" />
          <MetricCard label="未充填報告" value={values.qualityReports} suffix="件" icon={<AlertTriangle size={20} />} href="/staff/dashboard" external tone="danger" />
        </div>
      </DashboardSection>

      <DashboardSection title="今日の状況">
        <div className={styles.cardGridThree}>
          <MetricCard label="本日の操作" value={values.todayOps} suffix="件" icon={<BarChart3 size={20} />} href="/staff/dashboard" external />
          <MetricCard label="貸出中" value={values.renting} suffix="本" icon={<Truck size={20} />} href="/staff/dashboard" external />
          <MetricCard label="稼働スタッフ" value={values.activeStaff} suffix="名" icon={<Users size={20} />} href={canStaffAnalytics ? "/admin/staff-analytics" : "/staff/dashboard"} external={!canStaffAnalytics} />
        </div>
      </DashboardSection>

      {(canSales || canStaffAnalytics) && (
        <DashboardSection title="分析サマリー" description="期間別の詳しい集計は分析画面で確認します。">
          <div className={styles.analysisGrid}>
            {canSales && <MetricCard label="売上を分析" icon={<LineChart size={20} />} href="/admin/sales" />}
            {canStaffAnalytics && <MetricCard label="スタッフ実績を分析" icon={<Users size={20} />} href="/admin/staff-analytics" />}
          </div>
        </DashboardSection>
      )}
    </div>
  );
}
