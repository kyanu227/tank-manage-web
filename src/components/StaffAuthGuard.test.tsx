import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/config", () => ({
  auth: {},
  db: {},
}));

import StaffAuthGuard from "@/components/StaffAuthGuard";

describe("StaffAuthGuard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("英語セッションがあっても静的出力の初回表示は日本語で固定する", () => {
    const rawSession = JSON.stringify({
      id: "staff-1",
      name: "Test Staff",
      locale: "en",
    });
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => key === "staffSession" ? rawSession : null),
    });

    const html = renderToStaticMarkup(
      createElement(StaffAuthGuard, null, createElement("div", null, "child")),
    );

    expect(html).toContain('lang="ja"');
    expect(html).toContain("認証を確認中…");
    expect(html).not.toContain("Checking authentication…");
  });
});
