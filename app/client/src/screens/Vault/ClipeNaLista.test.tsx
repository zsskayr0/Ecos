import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
import { AuthProvider } from "@/lib/auth-context";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    auth: { ...o.auth, perfil: vi.fn() },
    financeiro: { ...o.financeiro, lote: vi.fn() },
    vault: {
      ...o.vault,
      transacoes: { listar: vi.fn() },
      anexos: { listar: vi.fn(), enviar: vi.fn(), conteudo: vi.fn(), miniatura: vi.fn() },
    },
  };
});
import { auth, vault, type CategoriaApi, type TransacaoApi } from "@/lib/api";
import { VaultTransactions } from "./VaultTransactions";
import { defaultPeriod } from "./nexus/period";

const base = { moeda: "BRL", categoria_id: null, conta_id: null, beneficiario_id: null, forma_pagamento: "pix", status: "efetivada" as const, observacoes: null, origem: "manual", espaco: "pessoal", criado_em: "2026-09-30", atualizado_em: "2026-09-30", tipo: "saida" as const, valor_centavos: 1020, data: "2026-09-30" };
const comAnexos: TransacaoApi = { ...base, id: "t1", descricao: "Pix para Karine", anexos: 2 };
const semAnexos: TransacaoApi = { ...base, id: "t2", descricao: "Padaria", anexos: 0 };

const perfil = { id: "u1", nome_usuario: "ana", nome: "Ana", cofre_ativado: true, avatar_atualizado_em: null, equipes: [], papel: "usuario", deve_trocar_senha: false, termos_pendente: false, termos_versao: "1" };

function tela(abrir = vi.fn(), atualizar = vi.fn()) {
  render(
    <AuthProvider><RefreshProvider><AppUIProvider>
      <div className="cofre-app">
        <VaultTransactions recarregar={0} periodo={{ data_de: "2026-09-01", data_ate: "2026-09-30" }} period={defaultPeriod()} onPeriodChange={vi.fn()} filtro={{}} categorias={[] as CategoriaApi[]} abrir={abrir} atualizar={atualizar} />
      </div>
    </AppUIProvider></RefreshProvider></AuthProvider>,
  );
  return { abrir, atualizar };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:t"), revokeObjectURL: vi.fn() }));
  vi.mocked(auth.perfil).mockResolvedValue(perfil as never);
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [comAnexos, semAnexos], next_cursor: null });
  vi.mocked(vault.anexos.listar).mockResolvedValue([
    { id: "a1", nome_arquivo: "pix.png", mime_type: "image/png", tamanho_bytes: 10, checksum_sha256: "h", criado_em: "", tipo: "comprovante" as const },
    { id: "a2", nome_arquivo: "recibo.png", mime_type: "image/png", tamanho_bytes: 10, checksum_sha256: "h", criado_em: "", tipo: "comprovante" as const },
  ]);
  vi.mocked(vault.anexos.conteudo).mockResolvedValue(new Blob(["x"], { type: "image/png" }));
});

it("cada transação da lista tem o clipe: com número quando há anexos, e convidando a anexar quando não há", async () => {
  tela();
  const com = await screen.findByRole("button", { name: "2 comprovantes de Pix para Karine" });
  expect(com.textContent).toBe(""); // só o ícone: a contagem fica na dica
  expect(screen.getByRole("button", { name: "Anexar comprovante a Padaria" }).textContent).toBe("");
});

it("clicar no clipe mostra o comprovante e NÃO abre o lançamento da linha", async () => {
  const { abrir } = tela();
  fireEvent.click(await screen.findByRole("button", { name: "2 comprovantes de Pix para Karine" }));
  await screen.findByRole("img", { name: "Comprovante pix.png" });
  expect(screen.getByText("1 de 2")).toBeTruthy();
  expect(abrir).not.toHaveBeenCalled();
});

it("clicar na linha, fora do clipe, continua abrindo o lançamento", async () => {
  const { abrir } = tela();
  fireEvent.click(await screen.findByText("Pix para Karine"));
  expect(abrir).toHaveBeenCalledWith("t1");
});

it("anexar pela lista recarrega a tela (a contagem muda)", async () => {
  vi.mocked(vault.anexos.enviar).mockResolvedValue({ id: "n", nome_arquivo: "n.png", tamanho_bytes: 1, duplicado_em: null });
  const { atualizar } = tela();
  await screen.findByRole("button", { name: "Anexar comprovante a Padaria" });
  const antes = vi.mocked(vault.transacoes.listar).mock.calls.length;
  fireEvent.change(screen.getByLabelText("Escolher comprovante para Padaria"), { target: { files: [new File(["x"], "n.png", { type: "image/png" })] } });
  await waitFor(() => expect(vault.anexos.enviar).toHaveBeenCalledWith("t2", expect.any(File), "comprovante"));
  await waitFor(() => expect(atualizar).toHaveBeenCalled());
  await waitFor(() => expect(vi.mocked(vault.transacoes.listar).mock.calls.length).toBeGreaterThan(antes));
});

it("na visão em tabela o clipe também existe em cada linha", async () => {
  tela();
  await screen.findByRole("button", { name: "2 comprovantes de Pix para Karine" });
  fireEvent.click(screen.getByRole("button", { name: /Tabela/ }));
  const tabela = await screen.findByRole("table");
  expect(within(tabela).getByRole("button", { name: "2 comprovantes de Pix para Karine" })).toBeTruthy();
  expect(within(tabela).getByRole("button", { name: "Anexar comprovante a Padaria" })).toBeTruthy();
  expect(within(tabela).getByRole("columnheader", { name: "Anexos" })).toBeTruthy();
});

it("lançamento sem o campo de contagem (servidor antigo) é tratado como sem anexos", async () => {
  const { anexos: _descartado, ...antigo } = comAnexos;
  vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [antigo as TransacaoApi], next_cursor: null });
  tela();
  expect(await screen.findByRole("button", { name: "Anexar comprovante a Pix para Karine" })).toBeTruthy();
});
