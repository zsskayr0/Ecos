import { describe, expect, it } from "vitest";
import { alturaNaLinguagem, criarTracoEscrita, escreverBlocoEscrita, lerBlocoEscrita, novoBlocoEscrita, svgEscrita } from "./escrita-bloco";

describe("bloco de escrita", () => {
  it("bloco novo é vazio com a altura padrão", () => {
    expect(lerBlocoEscrita(novoBlocoEscrita())).toEqual({ altura: 240, tracos: [] });
  });

  it("ida e volta pelo texto mantém os traços", () => {
    const t = criarTracoEscrita("caneta", "auto", 2, [{ x: 10.04, y: 20, pressao: 0.5 }, { x: 30, y: 40.26, pressao: 0.73 }]);
    const fonte = escreverBlocoEscrita({ altura: 300, tracos: [t] });
    expect(fonte).toBe("```escrita 300\nc auto 2 10,20,50 30,40.3,73\n```");
    const lido = lerBlocoEscrita(fonte);
    expect(lido.altura).toBe(300);
    expect(lido.tracos[0].pontos).toEqual([{ x: 10, y: 20, pressao: 0.5 }, { x: 30, y: 40.3, pressao: 0.73 }]);
    expect(lido.tracos[0].d.length).toBeGreaterThan(0);
  });

  it("ignora linhas estragadas e limita a altura", () => {
    const b = lerBlocoEscrita("```escrita 99999\nlixo\nc #zzzzzz 2 1,1,50\n```");
    expect(b.altura).toBe(2400);
    expect(b.tracos).toHaveLength(1);
    expect(b.tracos[0].cor).toBe("auto");
  });

  it("leitura recebe a altura no nome da linguagem", () => {
    expect(alturaNaLinguagem("a\n```escrita 320\nc auto 2 1,1,50\n```")).toBe("a\n```escrita-320\nc auto 2 1,1,50\n```");
  });

  it("svg tem um caminho por traço", () => {
    const b = lerBlocoEscrita("```escrita 100\nc auto 2 1,1,50 5,5,50\nm #ffd400 16 1,1,50 9,9,50\n```");
    const svg = svgEscrita(b, { corTinta: "currentColor" });
    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).toContain('viewBox="0 0 700 100"');
  });
});
