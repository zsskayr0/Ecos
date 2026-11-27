import { describe, expect, it } from "vitest";
import { pedacos } from "./layout-nota-tinta";

describe("pedacos (emojis no PDF de nota com tinta)", () => {
  it("separa texto e emojis com a posição de cada pedaço", () => {
    expect(pedacos("oi🎉tudo")).toEqual([
      { t: "oi", i: 0, emoji: false },
      { t: "🎉", i: 2, emoji: true },
      { t: "tudo", i: 4, emoji: false },
    ]);
  });
  it("palavra sem emoji fica inteira; dígitos e # não contam como emoji", () => {
    expect(pedacos("#tag")).toEqual([{ t: "#tag", i: 0, emoji: false }]);
    expect(pedacos("2026")).toEqual([{ t: "2026", i: 0, emoji: false }]);
  });
  it("emoji composto (ZWJ) fica num pedaço só", () => {
    expect(pedacos("👩‍💻").map((p) => p.emoji)).toEqual([true]);
  });
});
