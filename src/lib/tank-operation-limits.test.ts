import { describe, expect, it } from "vitest";
import {
  MAX_ATOMIC_TANK_OPERATIONS,
  assertAtomicTankOperationCount,
} from "@/lib/tank-operation-limits";

describe("atomic tank operation limit", () => {
  it("accepts the Rules-verified maximum", () => {
    expect(MAX_ATOMIC_TANK_OPERATIONS).toBe(10);
    expect(() => assertAtomicTankOperationCount(10)).not.toThrow();
  });

  it("does not split or accept an oversized operation", () => {
    expect(() => assertAtomicTankOperationCount(11)).toThrow("対象件数を減らしてください");
  });
});
