import { describe, expect, it } from "vitest";
import {
  getManualOperationConfirmMessage,
  getManualOperationSuccessMessage,
  getManualReturnConfirmMessage,
  getManualReturnSuccessMessage,
} from "./operation-messages";

describe("manual operation messages", () => {
  it("keeps the existing Japanese messages", () => {
    expect(getManualOperationConfirmMessage("fill", "ja", { tankCount: 1 }))
      .toBe("充填：1本を処理しますか？");
    expect(getManualOperationSuccessMessage("fill", "ja", { tankCount: 1 }))
      .toBe("1本の処理が完了しました");
    expect(getManualReturnConfirmMessage("ja", { tankCount: 2, returnCount: 1, keepCount: 1 }))
      .toBe("返却: 1本 / 持ち越し: 1本を処理しますか？");
    expect(getManualReturnSuccessMessage("ja", { tankCount: 2, returnCount: 1, keepCount: 1 }))
      .toBe("2本の処理が完了しました");
  });

  it("uses correct English singular and plural units", () => {
    expect(getManualOperationConfirmMessage("fill", "en", { tankCount: 1 }))
      .toBe("Process 1 tank for Fill?");
    expect(getManualOperationConfirmMessage("fill", "en", { tankCount: 2 }))
      .toBe("Process 2 tanks for Fill?");
    expect(getManualOperationSuccessMessage("fill", "en", { tankCount: 1 }))
      .toBe("1 tank processed.");
    expect(getManualReturnConfirmMessage("en", { tankCount: 2, returnCount: 1, keepCount: 1 }))
      .toBe("Process 1 return / 1 carry-over?");
    expect(getManualReturnConfirmMessage("en", { tankCount: 2, returnCount: 2 }))
      .toBe("Process 2 returns?");
    expect(getManualReturnSuccessMessage("en", { tankCount: 1, returnCount: 1 }))
      .toBe("1 return item processed.");
  });
});
