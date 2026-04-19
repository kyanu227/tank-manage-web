"use client";

import Link from "next/link";
import { MODE_CONFIG, MODES } from "../constants";
import type { OpMode } from "../types";

interface OperationModeTabsProps {
  mode: OpMode;
}

export default function OperationModeTabs({ mode }: OperationModeTabsProps) {
  return (
    <div style={{
      padding: "12px 16px", background: "rgba(255,255,255,0.8)",
      backdropFilter: "blur(12px)", borderBottom: "1px solid #e2e8f0", zIndex: 10,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", flex: 1, gap: 6, background: "#f1f5f9", borderRadius: 12, padding: 4 }}>
          {MODES.map((m) => {
            const mc = MODE_CONFIG[m];
            const active = mode === m;
            return (
              <Link
                key={m}
                href={`/staff/${m}`}
                style={{
                  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  padding: "8px 0", borderRadius: 10, border: "none", textDecoration: "none",
                  background: active ? "#fff" : "transparent",
                  color: active ? mc.color : "#94a3b8",
                  fontWeight: active ? 800 : 600, fontSize: 13,
                  cursor: "pointer", transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: active ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                }}
              >
                <mc.icon size={16} />
                {mc.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
