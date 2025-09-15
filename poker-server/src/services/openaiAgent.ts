import { PublicState } from "../model/types.js";

export async function suggestAction(state: PublicState, mode:"play"|"learn") {
  // ここで OpenAI Responses API を呼ぶ。
  // 初期はダミー返却→動作確認後にAPI接続
  return {
    action: "call",
    size: undefined,
    alts: [{ action: "raise", weight: 0.3, size: 0.33 }],
    rationale: mode === "learn" ? "プリフロップの標準ディフェンス。SPRを保つ目的でコール。" : undefined
  };
}
