"use client";

import Link from "next/link";
import { Package, RotateCcw, ChevronRight } from "lucide-react";

export default function CustomerPortal() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        padding: "0 20px",
        paddingTop: "max(52px, env(safe-area-inset-top, 52px))",
        paddingBottom: 40,
      }}
    >
      <div style={{ marginBottom: 48 }}>
        <p
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#94a3b8",
            marginBottom: 8,
          }}
        >
          ガス管理システム
        </p>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: "#0f172a",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          何をしますか？
        </h1>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Link href="/order" style={{ display: "block", textDecoration: "none" }}>
          <div
            style={{
              background: "#fff",
              border: "1.5px solid #e2e8f0",
              borderRadius: 20,
              padding: "22px 20px",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: "#eff6ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Package size={21} color="#3b82f6" />
            </div>
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  color: "#0f172a",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                発注
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
                タンクを注文する
              </p>
            </div>
            <ChevronRight size={17} color="#cbd5e1" />
          </div>
        </Link>

        <Link href="/return" style={{ display: "block", textDecoration: "none" }}>
          <div
            style={{
              background: "#fff",
              border: "1.5px solid #e2e8f0",
              borderRadius: 20,
              padding: "22px 20px",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: "#ecfdf5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <RotateCcw size={21} color="#10b981" />
            </div>
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  color: "#0f172a",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                返却
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
                タンクを返す
              </p>
            </div>
            <ChevronRight size={17} color="#cbd5e1" />
          </div>
        </Link>
        <Link href="/unfilled" style={{ display: "block", textDecoration: "none" }}>
          <div
            style={{
              background: "#fff",
              border: "1.5px solid #e2e8f0",
              borderRadius: 20,
              padding: "22px 20px",
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: "#fef2f2",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <RotateCcw size={21} color="#ef4444" />
            </div>
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontSize: 19,
                  fontWeight: 800,
                  color: "#0f172a",
                  letterSpacing: "-0.02em",
                  lineHeight: 1.2,
                }}
              >
                未充填タンク報告
              </p>
              <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>
                システムに登録がないタンク
              </p>
            </div>
            <ChevronRight size={17} color="#cbd5e1" />
          </div>
        </Link>
      </div>
    </div>
  );
}
