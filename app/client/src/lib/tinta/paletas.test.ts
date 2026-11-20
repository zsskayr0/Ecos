import { beforeEach, describe, expect, it } from "vitest";
import { alternarFavorito, ID_FAVORITOS, trocarCores, ativarSlot, definirSlot, lerSlots, adicionarCor, criarGrupo, excluirGrupo, escolherGrupo, gruposProntos, hexParaHsv, hsvParaHex, lerEstado, normalizarHex, removerCor, renomearGrupo, MAX_CORES_GRUPO, type EstadoPaletas } from "./paletas";

const vazio: EstadoPaletas = { grupos: [], escolhido: {} };

describe("cor", () => {
  it("normaliza HEX", () => {
    expect(normalizarHex("#ABC")).toBe("#aabbcc");
    expect(normalizarHex("2563EB")).toBe("#2563eb");
    expect(normalizarHex("#12")).toBeNull();
    expect(normalizarHex("#gggggg")).toBeNull();
  });
  it("ida e volta HSV", () => {
    for (const h of ["#2563eb", "#dc2626", "#000000", "#ffffff", "#16a34a", "#808080"]) expect(hsvParaHex(hexParaHsv(h))).toBe(h);
  });
});

describe("grupos", () => {
  beforeEach(() => localStorage.clear());
  it("prontos: Vivas é o primeiro; na caneta tem a cor do texto, no marca-texto não", () => {
    expect(gruposProntos("caneta")[0]!.cores[0]).toBe("auto");
    expect(gruposProntos("marca-texto")[0]!.cores).not.toContain("auto");
    for (const g of [...gruposProntos("caneta"), ...gruposProntos("marca-texto")]) for (const c of g.cores) expect(c === "auto" || normalizarHex(c) === c).toBe(true);
  });
  it("todo grupo pronto tem 12 cores diferentes (duas fileiras cheias)", () => {
    for (const f of ["caneta", "marca-texto"] as const) for (const g of gruposProntos(f)) { expect(g.cores).toHaveLength(12); expect(new Set(g.cores).size).toBe(12); }
  });
  it("cria, renomeia, adiciona sem repetir, remove e exclui", () => {
    const { estado, id } = criarGrupo(vazio, "  Meu  ", ["#ff0000"]);
    expect(estado.grupos[0]!.nome).toBe("Meu");
    let e = adicionarCor(estado, id!, "#00F");
    e = adicionarCor(e, id!, "#0000ff");
    expect(e.grupos[0]!.cores).toEqual(["#ff0000", "#0000ff"]);
    e = renomearGrupo(e, id!, "Outro");
    e = removerCor(e, id!, "#ff0000");
    expect(e.grupos[0]).toMatchObject({ nome: "Outro", cores: ["#0000ff"] });
    e = escolherGrupo(e, "caneta", id!);
    expect(excluirGrupo(e, id!)).toEqual({ grupos: [], escolhido: {} });
  });
  it("limita as cores do grupo", () => {
    const { estado, id } = criarGrupo(vazio);
    let e = estado;
    for (let i = 0; i < MAX_CORES_GRUPO + 5; i++) e = adicionarCor(e, id!, `#${i.toString(16).padStart(6, "0")}`);
    expect(e.grupos[0]!.cores).toHaveLength(MAX_CORES_GRUPO);
  });
  it("lê estado salvo descartando lixo", () => {
    const e = lerEstado(JSON.stringify({ grupos: [{ id: "a", nome: "X", cores: ["#ABC", "zzz", 3] }, null, { id: 1 }], escolhido: { caneta: "a" } }));
    expect(e.grupos).toEqual([{ id: "a", nome: "X", proprio: true, cores: ["#aabbcc"] }]);
    expect(lerEstado("{")).toEqual(vazio);
  });
});

describe("três seletores", () => {
  it("cada um guarda a sua cor e o ativo; entradas inválidas caem no padrão", () => {
    let e = definirSlot(vazio, "caneta", 1, "#00ff00");
    e = ativarSlot(e, "caneta", 2);
    expect(lerSlots(e, "caneta")).toEqual({ cores: ["auto", "#00ff00", "#dc2626"], ativo: 2 });
    expect(lerSlots(e, "marca-texto").ativo).toBe(0);
    expect(definirSlot(e, "caneta", 5, "#000000")).toBe(e);
    expect(definirSlot(e, "caneta", 0, "vermelho")).toBe(e);
    expect(lerSlots({ grupos: [], escolhido: {}, slots: { "marca-texto": { cores: ["auto", "xx"], ativo: 9 } } }, "marca-texto")).toEqual({ cores: ["#facc15", "#4ade80", "#f472b6"], ativo: 0 });
  });
});

describe("trocar cores", () => {
  it("troca duas posições e ignora índices inválidos", () => {
    const { estado, id } = criarGrupo(vazio, "G", ["#111111", "#222222", "#333333"]);
    expect(trocarCores(estado, id!, 0, 2).grupos[0]!.cores).toEqual(["#333333", "#222222", "#111111"]);
    expect(trocarCores(estado, id!, 0, 5)).toEqual(estado);
    expect(trocarCores(estado, id!, 1, 1).grupos[0]!.cores).toEqual(["#111111", "#222222", "#333333"]);
  });
});

describe("favoritos", () => {
  it("alterna, reordena e remove pelo id do grupo", () => {
    let e = alternarFavorito(vazio, "#ABC");
    e = alternarFavorito(e, "#111111");
    expect(e.favoritos).toEqual(["#aabbcc", "#111111"]);
    expect(trocarCores(e, ID_FAVORITOS, 0, 1).favoritos).toEqual(["#111111", "#aabbcc"]);
    expect(removerCor(e, ID_FAVORITOS, "#aabbcc").favoritos).toEqual(["#111111"]);
    expect(alternarFavorito(e, "#aabbcc").favoritos).toEqual(["#111111"]);
    expect(alternarFavorito(vazio, "auto")).toBe(vazio);
  });
});
