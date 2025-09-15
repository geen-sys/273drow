import { describe, it, expect } from "vitest";
import { Game } from "../src/engine/Game.js";

describe("smoke", () => {
  it("create/deal", () => {
    const id = Game.createTable({ seats: 6 });
    const s = Game.deal(id);
    expect(s.publicState.board.length).toBe(0);
    expect(s.publicState.heroHand).toBeDefined();
  });
});
