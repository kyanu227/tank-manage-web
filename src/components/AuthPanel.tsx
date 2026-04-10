"use client";

import { ReactNode } from "react";

interface AuthPanelProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}

export default function AuthPanel({ title, subtitle, icon, children }: AuthPanelProps) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 24,
          padding: "48px 32px",
          boxShadow: "0 20px 40px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <div style={{ textAlign: "center" }}>
          {icon && (
            <div
              style={{
                display: "inline-flex",
                padding: 16,
                borderRadius: 20,
                marginBottom: 18,
                background: "linear-gradient(135deg, #0ea5e9, #3b82f6)",
                boxShadow: "0 10px 20px rgba(14, 165, 233, 0.25)",
              }}
            >
              {icon}
            </div>
          )}
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#0f172a",
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ color: "#64748b", fontSize: 14, marginTop: 6 }}>{subtitle}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
