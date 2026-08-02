import { describe, expect, it } from "vitest";
import {
  buildCustomerIdentityGroup,
  CustomerIdentityDisplayLabelRequiredError,
} from "./customer-identity-read";

describe("customer identity read", () => {
  it("keeps customerId grouping and non-legacy identity with an injected fallback label", () => {
    expect(buildCustomerIdentityGroup(
      { customerId: " customer-001 " },
      { unknownCustomerLabel: "不明な顧客" },
    )).toStrictEqual({
      key: "customer:customer-001",
      customerId: "customer-001",
      displayName: "不明な顧客",
      isLegacy: false,
    });
  });

  it("keeps legacy grouping and the __unknown__ key with an injected fallback label", () => {
    expect(buildCustomerIdentityGroup(
      { customerName: " ", location: null },
      { legacyUnknownLabel: "不明" },
    )).toStrictEqual({
      key: "legacy-location:__unknown__",
      displayName: "不明",
      isLegacy: true,
    });
  });

  it("keeps source-name precedence without changing key or isLegacy", () => {
    expect(buildCustomerIdentityGroup(
      {
        customerId: "customer-001",
        customerName: "保存時名称",
        location: "当時場所",
      },
      {
        currentCustomerName: "現在名称",
        unknownCustomerLabel: "不明な顧客",
      },
    )).toStrictEqual({
      key: "customer:customer-001",
      customerId: "customer-001",
      displayName: "現在名称",
      isLegacy: false,
    });

    expect(buildCustomerIdentityGroup({
      customerName: "当時顧客",
      location: "当時場所",
    })).toStrictEqual({
      key: "legacy-location:当時顧客",
      displayName: "当時顧客",
      isLegacy: true,
    });
  });

  it.each([
    [
      "customerId",
      { customerId: "internal-customer-document-id" },
      "unknown_customer",
    ],
    [
      "legacy sentinel",
      {},
      "legacy_unknown_customer",
    ],
  ] as const)("does not expose %s when a required display label is omitted", (
    _label,
    source,
    expectedLabelKind,
  ) => {
    let thrown: unknown;
    try {
      buildCustomerIdentityGroup(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CustomerIdentityDisplayLabelRequiredError);
    expect(thrown).toMatchObject({
      code: "customer_identity_display_label_required",
      labelKind: expectedLabelKind,
      message: "",
    });
    expect(String((thrown as Error).message)).not.toContain(
      "internal-customer-document-id",
    );
    expect(String((thrown as Error).message)).not.toContain("__unknown__");
  });
});
