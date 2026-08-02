import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdminCapabilityGate from "@/components/admin/AdminCapabilityGate";
import { AdminCapabilitiesProvider } from "@/hooks/useAdminCapabilities";

function render(capabilities: Parameters<typeof AdminCapabilitiesProvider>[0]["value"]["capabilities"]) {
  return renderToStaticMarkup(
    <AdminCapabilitiesProvider value={{ role: "準管理者", capabilities }}>
      <AdminCapabilityGate capability="reviews.approve">
        <button>承認</button>
      </AdminCapabilityGate>
    </AdminCapabilitiesProvider>,
  );
}

describe("AdminCapabilityGate", () => {
  it("管理者限定ボタン相当をcapabilityなしでは表示しない", () => {
    expect(render(["reviews.view"])).not.toContain("承認");
  });

  it("capabilityありではボタンを表示する", () => {
    expect(render(["reviews.view", "reviews.approve"])).toContain("承認");
  });
});
