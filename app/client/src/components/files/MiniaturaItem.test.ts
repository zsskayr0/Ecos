import { describe, expect, it } from "vitest";
import { LARGURA_MINIATURA } from "./MiniaturaItem";

describe("LARGURA_MINIATURA", () => {
  it("cresce de pequena a grande", () => {
    expect(LARGURA_MINIATURA.pequena).toBeLessThan(LARGURA_MINIATURA.media);
    expect(LARGURA_MINIATURA.media).toBeLessThan(LARGURA_MINIATURA.grande);
  });
});
