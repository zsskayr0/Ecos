import { describe, expect, it } from "vitest";
import { tagsPadraoDaPasta, unirTags } from "./tags-pasta";

const pastas = [
  { caminho: "Jogos", tags: ["lazer"] },
  { caminho: "Jogos/Minecraft", tags: ["Minecraft", "mods"] },
  { caminho: "Jogos/Minecraft/Análise", tags: ["lazer", "análise"] },
  { caminho: "Trabalho", tags: null },
];

describe("tagsPadraoDaPasta", () => {
  it("hierarquia: soma as tags da raiz até a pasta, sem repetir", () => {
    expect(tagsPadraoDaPasta("Jogos/Minecraft/Análise", "hierarquia", pastas)).toEqual(["lazer", "Minecraft", "mods", "análise"]);
  });
  it("pasta: só as da própria pasta", () => {
    expect(tagsPadraoDaPasta("Jogos/Minecraft", "pasta", pastas)).toEqual(["Minecraft", "mods"]);
  });
  it("sem pasta ou sem tags devolve vazio", () => {
    expect(tagsPadraoDaPasta(null, "hierarquia", pastas)).toEqual([]);
    expect(tagsPadraoDaPasta("Trabalho", "hierarquia", pastas)).toEqual([]);
  });
});

describe("unirTags", () => {
  it("ignora maiúsculas, # e vazios", () => {
    expect(unirTags(["#Casa", "obra"], ["casa", " ", "Obra", "novo"])).toEqual(["Casa", "obra", "novo"]);
  });
});
