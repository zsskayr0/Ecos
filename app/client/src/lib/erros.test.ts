import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { errosDaTrocaDeSenha, mensagemDeCampos, mensagemDeErro, mensagemLimiteDeTentativas } from "@/lib/erros";
import { validarNomeUsuario, validarSenhaNova } from "@/lib/validacao";

describe("mensagens de erro", () => {
  it("troca nomes técnicos de campo por rótulos em português", () => {
    expect(mensagemDeCampos([{ campo: "duration_min", motivo: "deve ser maior que zero" }])).toBe("Duração: deve ser maior que zero");
    expect(mensagemDeCampos([{ campo: "nome_usuario", motivo: "deve ter de 3 a 32 caracteres" }, { campo: "corpo", motivo: "inválido" }]))
      .toBe("Nome de usuário: deve ter de 3 a 32 caracteres · Texto: inválido");
  });

  it("campo desconhecido mostra só o motivo, nunca o nome técnico", () => {
    expect(mensagemDeCampos([{ campo: "campo_novo_xyz", motivo: "valor inválido" }])).toBe("valor inválido");
  });

  it("ApiError 422 com campos usa os rótulos", () => {
    const e = new ApiError("VALIDATION_ERROR", "x", 422, [{ campo: "pagina.json", motivo: "não é um JSON válido" }]);
    expect(e.message).toBe("Conteúdo da página: não é um JSON válido");
    expect(e.message).not.toContain("pagina.json");
  });

  it("RATE_LIMITED mostra o tempo de espera em qualquer tela", () => {
    expect(new ApiError("RATE_LIMITED", "Muitas requisições", 429, undefined, 30).message).toContain("30 segundos");
    expect(mensagemLimiteDeTentativas(61)).toContain("2 minutos");
    expect(new ApiError("RATE_LIMITED", "x", 429).message).toContain("Aguarde um momento");
  });

  it("mensagemDeErro: ApiError passa; qualquer outra coisa vira o texto padrão", () => {
    expect(mensagemDeErro(new ApiError("NOT_FOUND", "Nota não encontrada.", 404), "padrão")).toBe("Nota não encontrada.");
    expect(mensagemDeErro(new TypeError("Cannot read properties of undefined"), "Não foi possível salvar.")).toBe("Não foi possível salvar.");
    expect(mensagemDeErro("x", "Não foi possível salvar.")).toBe("Não foi possível salvar.");
  });
});

describe("validação espelhando o servidor", () => {
  it("nome de usuário", () => {
    expect(validarNomeUsuario("diogo")).toBeNull();
    expect(validarNomeUsuario("ana.silva-2")).toBeNull();
    expect(validarNomeUsuario("ab")).toContain("3 a 32");
    expect(validarNomeUsuario("a".repeat(33))).toContain("3 a 32");
    expect(validarNomeUsuario("com espaco")).toContain("sem espaços");
    expect(validarNomeUsuario("joão")).toContain("sem acento");
    expect(validarNomeUsuario(".ana")).toContain("Comece e termine");
    expect(validarNomeUsuario("a..b")).toContain("dois separadores");
  });

  it("senha: tamanho em caracteres (acentos contam 1), espaços, sequência e nome de usuário", () => {
    expect(validarSenhaNova("cavalo-Bateria-Grampo-9")).toBeNull();
    expect(validarSenhaNova("curta")).toContain("pelo menos 12");
    expect(validarSenhaNova("áéíóúãõçâêôà")).toBeNull(); // 12 caracteres, 24 bytes
    expect(validarSenhaNova("com espaço no meio 1")).toContain("espaços");
    expect(validarSenhaNova("abcdefghijkl")).toContain("previsível");
    expect(validarSenhaNova("123456789012")).toContain("previsível");
    expect(validarSenhaNova("472916385027")).toContain("Só números");
    expect(validarSenhaNova("Xdiogo-Zq9#wLp", "diogo")).toContain("nome de usuário");
    expect(validarSenhaNova("x".repeat(129))).toContain("no máximo 128");
  });
});

describe("errosDaTrocaDeSenha", () => {
  it("senha atual errada vai para o campo da senha atual", () => {
    expect(errosDaTrocaDeSenha(new ApiError("INVALID_CREDENTIALS", "A senha atual não confere.", 401), "x")).toEqual({ atual: "A senha atual não confere." });
  });
  it("erro de nova_senha vai para o campo da nova senha", () => {
    const e = new ApiError("VALIDATION_ERROR", "x", 422, [{ campo: "nova_senha", motivo: "deve ser diferente da senha atual" }]);
    expect(errosDaTrocaDeSenha(e, "x")).toEqual({ nova: "Deve ser diferente da senha atual." });
  });
  it("o resto vira aviso geral", () => {
    expect(errosDaTrocaDeSenha(new Error("boom"), "Falhou.")).toEqual({ geral: "Falhou." });
  });
});
