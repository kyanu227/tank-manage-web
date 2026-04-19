"use client";

import { ArrowDownToLine, CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { BULK_TAGS } from "../constants";
import type { UseBulkReturnByLocationResult } from "../hooks/useBulkReturnByLocation";

interface BulkReturnByLocationPanelProps {
  bulk: UseBulkReturnByLocationResult;
}

export default function BulkReturnByLocationPanel({ bulk }: BulkReturnByLocationPanelProps) {
  const {
    bulkLoading,
    groupedTanks,
    expanded,
    returning,
    locationKeys,
    toggleExpand,
    updateTag,
    handleBulkReturnForLocation,
  } = bulk;

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: "#475569", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 4, height: 16, borderRadius: 2, background: "#3b82f6", display: "inline-block" }} />
        全貸出タンク
      </h3>

      {bulkLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
          <Loader2 size={20} color="#94a3b8" style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : locationKeys.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, padding: "24px 16px", textAlign: "center" }}>
          <CheckCircle2 size={24} color="#10b981" style={{ marginBottom: 8 }} />
          <p style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: 0 }}>貸出中のタンクはありません</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {locationKeys.map((loc) => {
            const tanks = groupedTanks[loc];
            const isExpanded = expanded[loc];
            const isReturning = returning[loc];

            return (
              <div key={loc} style={{ background: "#fff", border: "1px solid #e8eaed", borderRadius: 16, overflow: "hidden" }}>
                {/* アコーディオンヘッダー */}
                <div
                  onClick={() => toggleExpand(loc)}
                  style={{
                    padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between",
                    cursor: "pointer", userSelect: "none", background: isExpanded ? "#f8fafc" : "#fff",
                    borderBottom: isExpanded ? "1px solid #e8eaed" : "none", transition: "background 0.2s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ padding: 4, background: "#e0f2fe", borderRadius: 8, color: "#0284c7" }}>
                      {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", margin: 0 }}>{loc}</h3>
                      <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0 0", fontWeight: 600 }}>
                        {tanks.length}本 貸出中
                      </p>
                    </div>
                  </div>

                  {/* 一括返却ボタン */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleBulkReturnForLocation(loc)}
                      disabled={isReturning}
                      style={{
                        padding: "8px 16px", borderRadius: 10, border: "none",
                        background: isReturning ? "#e2e8f0" : "#0f172a",
                        color: isReturning ? "#94a3b8" : "#fff",
                        fontSize: 13, fontWeight: 700, cursor: isReturning ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", gap: 6, transition: "all 0.15s",
                        boxShadow: isReturning ? "none" : "0 2px 4px rgba(0,0,0,0.1)",
                      }}
                    >
                      {isReturning ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ArrowDownToLine size={16} />}
                      一括返却
                    </button>
                  </div>
                </div>

                {/* アコーディオンボディ */}
                {isExpanded && (
                  <div style={{ padding: "16px 20px", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                      {tanks.map((tank) => (
                        <div
                          key={tank.id}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", border: "1px solid #f1f5f9", borderRadius: 12, background: "#f8fafc" }}
                        >
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <span style={{ fontSize: 15, fontWeight: 800, fontFamily: "monospace", color: "#1e293b", letterSpacing: "0.05em" }}>
                              {tank.id}
                            </span>
                            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, marginTop: 2 }}>
                              {tank.staff}
                            </span>
                          </div>
                          {/* タグセレクター */}
                          <div style={{ display: "flex", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 2, flexShrink: 0 }}>
                            {BULK_TAGS.map((tag) => {
                              const active = tank.tag === tag.id;
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => updateTag(loc, tank.id, tag.id)}
                                  style={{
                                    padding: "6px 10px", border: "none", borderRadius: 6,
                                    background: active ? tag.bg : "transparent",
                                    color: active ? tag.color : "#94a3b8",
                                    fontSize: 11, fontWeight: active ? 800 : 600,
                                    cursor: "pointer", transition: "all 0.15s",
                                  }}
                                >
                                  {tag.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
