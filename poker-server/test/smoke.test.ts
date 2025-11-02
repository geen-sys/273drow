import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine/Game.js";

test("smoke:create/deal", () => {
  const id = Game.createTable({ seats: 6 });
  const s = Game.deal(id);

  assert.strictEqual(s.publicState.board.length, 0);
  assert.ok(s.publicState.heroHand);
});
