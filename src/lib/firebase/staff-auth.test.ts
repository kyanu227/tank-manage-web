import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  formatStaffProfileName,
  formatStaffProfileRank,
} from "@/features/staff-dashboard/mypage-i18n";

vi.mock("@/lib/firebase/config", () => ({ db: {} }));

import {
  buildStaffAuthProfile,
  type StaffAuthProfile,
  type StaffByUidMirror,
} from "./staff-auth";

describe("staff auth profile fallbacks", () => {
  it("marks generated fallbacks without changing serialized profile fields", () => {
    const profile = buildStaffAuthProfile("staff-1", {
      email: "staff@example.com",
      role: "一般",
      isActive: true,
      locale: "en",
    });

    expect(profile.name).toBe("スタッフ");
    expect(profile.rank).toBe("レギュラー");
    expect(profile.generatedFallbacks).toEqual({ name: true, rank: true });
    const mirrorPayload = { ...profile };
    const staffSessionPayload = JSON.parse(JSON.stringify(profile)) as unknown;
    expect(Object.keys(profile)).not.toContain("generatedFallbacks");
    expect(mirrorPayload).not.toHaveProperty("generatedFallbacks");
    expect(staffSessionPayload).not.toHaveProperty("generatedFallbacks");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["zero", 0],
    ["false", false],
  ])("keeps the existing fallback semantics for %s", (_label, value) => {
    const profile = buildStaffAuthProfile("staff-1", {
      name: value,
      rank: value,
      isActive: true,
      locale: "en",
    });

    expect(profile.name).toBe("スタッフ");
    expect(profile.rank).toBe("レギュラー");
    expect(profile.generatedFallbacks).toEqual({ name: true, rank: true });
  });

  it("does not mark identical stored values as generated fallbacks", () => {
    const profile = buildStaffAuthProfile("staff-1", {
      name: "スタッフ",
      rank: "レギュラー",
      email: "staff@example.com",
      role: "一般",
      isActive: true,
      locale: "en",
    });

    expect(profile.generatedFallbacks).toEqual({ name: false, rank: false });
  });

  it("handles a spread-produced profile without fallback provenance", () => {
    expectTypeOf<StaffAuthProfile["generatedFallbacks"]>().toEqualTypeOf<
      Readonly<{ name: boolean; rank: boolean }> | undefined
    >();

    const profile = buildStaffAuthProfile("staff-1", {
      name: "スタッフ",
      rank: "レギュラー",
      locale: "en",
    });
    const spreadProfile: StaffAuthProfile = { ...profile };
    const spreadMirror: StaffByUidMirror = { ...profile, uid: "auth-uid" };

    expect(spreadProfile.generatedFallbacks).toBeUndefined();
    expect(spreadMirror.generatedFallbacks).toBeUndefined();
    expect(formatStaffProfileName(
      spreadProfile.name,
      "en",
      spreadProfile.generatedFallbacks?.name === true,
    )).toBe("スタッフ");
    expect(formatStaffProfileRank(
      spreadMirror.rank,
      "en",
      spreadMirror.generatedFallbacks?.rank === true,
    )).toBe("レギュラー");
  });
});
