import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const o = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...o,
    vault: {
      ...o.vault,
      contas: { ...o.vault.contas, listar: vi.fn() },
      beneficiarios: { ...o.vault.beneficiarios, listar: vi.fn() },
      mensalidades: { listar: vi.fn(), candidatas: vi.fn(), obter: vi.fn(), salvar: vi.fn(), reajustar: vi.fn(), removerReajuste: vi.fn(), remover: vi.fn(), previstoRecebido: vi.fn() },
    },
    financeiro: { ...o.financeiro, recorrencias: vi.fn(), ocorrenciasDoPeriodo: vi.fn(), concluir: vi.fn(), atualizarRecorrencia: vi.fn() },
  };
});
import { ApiError, bloqueioDeMensalidade, financeiro, vault, type CicloApi, type MensalidadeApi, type MensalidadeDetalheApi, type ReajusteApi, type RecorrenciaApi } from "@/lib/api";
import { VaultMensalidades } from "./VaultMensalidades";
import { VaultRecorrencias } from "./VaultRecorrencias";
import { bpDoCampo, formatPercentual, mesesNoIntervalo, prazoPorExtenso, resumoDePendencias, vigenciaSeAvisarHoje } from "./mensalidades/formato";

const api = vault.mensalidades;
const HOJE = "2026-11-15";

const ciclo = (data: string, estado: CicloApi["estado"], extra: Partial<CicloApi> = {}): CicloApi => ({ ciclo: data, estado, limite_aviso: "2026-10-21", reajuste: null, ...extra });
const mens = (id: string, nome: string, foco: CicloApi | null, extra: Partial<MensalidadeApi> = {}): MensalidadeApi => ({
  recorrencia_id: id, descricao: "Mensalidade", ativa: true, beneficiario_id: `b-${id}`, beneficiario_nome: nome, valor_atual_centavos: 350000,
  data_base: "2024-11-20", ciclos_desde: "2026-01-01", percentual_minimo_bp: 1000, aviso_dias: 30, ciclo_em_foco: foco, ciclos_sem_decisao: foco && !foco.reajuste && foco.estado !== "futuro" ? 1 : 0, ...extra,
});
const reajuste = (extra: Partial<ReajusteApi> = {}): ReajusteApi => ({
  id: null, ciclo: "2026-11-20", regra: "minimo", valor_anterior_centavos: 350000, valor_novo_centavos: 385000, percentual_bp: 1000, igpm_bp: null,
  aviso_em: HOJE, vigente_desde: "2026-12-15", vigencia_minima: "2026-12-15", perda_centavos: 35000, motivo: null, criado_por: "u1", criado_em: null, ...extra,
});

const ana = mens("r1", "Ana Souza", ciclo("2026-11-20", "atrasado", { valor_minimo_centavos: 385000, perda_estimada_centavos: 35000 }));
const bruno = mens("r2", "Bruno Lima", ciclo("2026-12-28", "avisar", { limite_aviso: "2026-11-28", valor_minimo_centavos: 440000 }), { valor_atual_centavos: 400000 });
const clara = mens("r3", "Clara Nunes", ciclo("2027-06-10", "futuro", { limite_aviso: "2027-05-11" }), { valor_atual_centavos: 300000 });
const detalheAna: MensalidadeDetalheApi = {
  ...ana,
  ciclos: [
    ciclo("2026-11-20", "atrasado", { valor_minimo_centavos: 385000, perda_estimada_centavos: 35000 }),
    ciclo("2025-11-20", "aplicado", { limite_aviso: "2025-10-21", reajuste: reajuste({ id: "rj1", ciclo: "2025-11-20", regra: "igpm", valor_anterior_centavos: 320000, valor_novo_centavos: 350000, percentual_bp: 938, aviso_em: "2025-10-10", vigente_desde: "2025-11-20", perda_centavos: 0 }) }),
  ],
};
const periodo = { kind: "month", year: 2026, month: 11 } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${HOJE}T15:00:00Z`));
  vi.mocked(api.listar).mockResolvedValue([ana, bruno, clara]);
  vi.mocked(api.obter).mockResolvedValue(detalheAna);
  vi.mocked(api.candidatas).mockResolvedValue([]);
  vi.mocked(api.reajustar).mockImplementation(async (_id, p) => reajuste({ id: p.simular ? null : "novo", ciclo: p.ciclo }));
});
afterEach(() => vi.useRealTimers());

const abrir = (props: Partial<Parameters<typeof VaultMensalidades>[0]> = {}) =>
  render(<VaultMensalidades period={periodo} onPeriodChange={vi.fn()} atualizar={vi.fn()} recarregar={0} {...props} />);
const dialogo = (nome: string | RegExp) => screen.findByRole("dialog", { name: nome });

describe("painel", () => {
  it("põe no topo o reajuste atrasado, com a perda em destaque, e quem precisa de aviso, com o prazo", async () => {
    abrir();
    const atrasado = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    expect(screen.getByText("1 aviso de reajuste atrasado")).toBeTruthy();
    // Diz o que fazer: avisando hoje (15/11), com 30 dias de aviso, o novo valor vale a partir de 15/12.
    expect(atrasado.textContent).toContain("Avise hoje e o novo valor vale a partir de 15/12/2026");
    expect(within(atrasado).getByText("Perda estimada se avisar hoje").nextElementSibling?.textContent).toBe("R$ 350,00");
    // O total não afirma que o dinheiro já foi perdido: o aniversário pode nem ter chegado.
    expect(screen.getByText(/^Perda estimada se avisar hoje:/).textContent).toContain("R$ 350,00");
    expect(screen.queryByText(/já deixou de receber/)).toBeNull();

    const aviso = screen.getByRole("article", { name: "Aviso de reajuste de Bruno Lima" });
    expect(within(aviso).getByText("28/11/2026")).toBeTruthy();
    expect(within(aviso).getByText("faltam 13 dias")).toBeTruthy();
    expect(aviso.textContent).toContain("R$ 4.400,00");
    // Quem está em dia não aparece no topo, só na lista.
    expect(screen.queryByRole("article", { name: /Clara Nunes/ })).toBeNull();
  });

  it("lista os residentes com valor, aniversário e estado, e a busca ignora acento", async () => {
    abrir();
    const linha = await screen.findByRole("button", { name: "Abrir Clara Nunes" });
    expect(linha.textContent).toContain("R$ 3.000,00");
    expect(linha.textContent).toContain("Aniversário em 10/06/2027");
    expect(linha.textContent).toContain("Em dia");
    expect(screen.getByRole("button", { name: "Abrir Ana Souza" }).textContent).toContain("Aviso atrasado");
    expect(screen.getByRole("button", { name: "Abrir Bruno Lima" }).textContent).toContain("Avisar até 28/11");

    fireEvent.change(screen.getByLabelText("Buscar residente"), { target: { value: "clara nuñes" } });
    expect(screen.queryByRole("button", { name: "Abrir Ana Souza" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar residente"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum residente com esse nome.")).toBeTruthy();
  });

  it("sem pendência, diz que não há nada esperando", async () => {
    vi.mocked(api.listar).mockResolvedValue([clara]);
    abrir();
    expect(await screen.findByText("Nenhum reajuste esperando por você.")).toBeTruthy();
  });

  it("mostra carregando, depois o estado vazio com o caminho para adicionar", async () => {
    let soltar!: (l: MensalidadeApi[]) => void;
    vi.mocked(api.listar).mockReturnValue(new Promise((r) => { soltar = r; }));
    abrir();
    expect(screen.getByRole("status", { name: "Carregando mensalidades" })).toBeTruthy();
    soltar([]);
    expect(await screen.findByText("Nenhuma mensalidade cadastrada")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Carregando mensalidades" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Adicionar mensalidade/ }).length).toBe(2);
  });

  it("mostra o erro do servidor (inclusive o do Cofre numa versão anterior) e tenta de novo", async () => {
    const texto = "O Cofre está numa versão anterior do esquema; Mensalidades fica indisponível até a atualização.";
    vi.mocked(api.listar).mockRejectedValueOnce(new ApiError("CONFLICT", texto, 409));
    abrir();
    expect((await screen.findByRole("alert")).textContent).toContain(texto);
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByRole("button", { name: "Abrir Ana Souza" })).toBeTruthy();
  });
});

describe("registrar reajuste", () => {
  it("pede a prévia ao servidor, mostra o cálculo e só então grava", async () => {
    const atualizar = vi.fn();
    abrir({ atualizar });
    const cartao = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    fireEvent.click(within(cartao).getByRole("button", { name: "Registrar reajuste" }));
    const d = await dialogo("Registrar reajuste");

    await waitFor(() => expect(api.reajustar).toHaveBeenCalledWith("r1", { ciclo: "2026-11-20", modo: "automatico", aviso_em: HOJE, simular: true }));
    const previa = within(d).getByLabelText("Prévia do reajuste");
    await waitFor(() => expect(previa.textContent).toContain("R$ 3.850,00"));
    expect(previa.textContent).toContain("R$ 3.500,00");
    expect(previa.textContent).toContain("Reajuste mínimo · 10%");
    expect(previa.textContent).toContain("Primeira data possível15/12/2026");
    expect(previa.textContent).toContain("Perda pelo atraso");
    expect(previa.textContent).toContain("R$ 350,00");

    // O IGP-M digitado vai em pontos-base e refaz a prévia.
    vi.mocked(api.reajustar).mockImplementation(async (_id, p) => reajuste({ id: p.simular ? null : "novo", regra: "igpm", percentual_bp: 1250, igpm_bp: 1250, valor_novo_centavos: 393750 }));
    fireEvent.change(within(d).getByLabelText("IGP-M acumulado (%)"), { target: { value: "12,5" } });
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "automatico", aviso_em: HOJE, igpm_bp: 1250, simular: true }));
    await waitFor(() => expect(previa.textContent).toContain("IGP-M · 12,5%"));

    fireEvent.click(within(d).getByRole("button", { name: "Registrar reajuste" }));
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "automatico", aviso_em: HOJE, igpm_bp: 1250, simular: false }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Reajuste registrado: vale a partir de 15/12/2026.")).toBeTruthy();
    expect(atualizar).toHaveBeenCalled();
    expect(api.listar).toHaveBeenCalledTimes(2);
  });

  it("negociado exige o que foi combinado e o motivo; aceita percentual ou valor final", async () => {
    abrir();
    const cartao = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    fireEvent.click(within(cartao).getByRole("button", { name: "Registrar reajuste" }));
    const d = await dialogo("Registrar reajuste");
    fireEvent.click(within(d).getByRole("button", { name: "Negociado" }));
    expect(within(d).getByText("Informe o percentual combinado.")).toBeTruthy();
    const gravar = within(d).getByRole("button", { name: "Registrar reajuste" }) as HTMLButtonElement;
    expect(gravar.disabled).toBe(true);

    fireEvent.change(within(d).getByLabelText("Percentual combinado (%)"), { target: { value: "8" } });
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "negociado", aviso_em: HOJE, percentual_bp: 800, simular: true }));
    fireEvent.click(within(d).getByRole("button", { name: "Por valor final" }));
    fireEvent.change(within(d).getByLabelText("Novo valor da mensalidade"), { target: { value: "3.800,00" } });
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "negociado", aviso_em: HOJE, valor_novo_centavos: 380000, simular: true }));
    await waitFor(() => expect(within(d).getByLabelText("Prévia do reajuste").textContent).toContain("Vale a partir de"));
    // Com a prévia pronta, ainda falta o motivo.
    expect(gravar.disabled).toBe(true);
    fireEvent.change(within(d).getByLabelText("Motivo"), { target: { value: "Família pediu parcelar o aumento" } });
    expect(gravar.disabled).toBe(false);
    fireEvent.click(gravar);
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", expect.objectContaining({ modo: "negociado", valor_novo_centavos: 380000, motivo: "Família pediu parcelar o aumento", simular: false })));
  });

  it("manter valor não pede datas, exige motivo e grava como mantido", async () => {
    vi.mocked(api.reajustar).mockImplementation(async (_id, p) => reajuste({ id: p.simular ? null : "novo", regra: "mantido", valor_novo_centavos: 350000, percentual_bp: 0, vigente_desde: "2026-11-20", vigencia_minima: "2026-11-20", perda_centavos: 0 }));
    abrir();
    const cartao = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    fireEvent.click(within(cartao).getByRole("button", { name: "Manter valor" }));
    const d = await dialogo("Manter valor");
    expect(within(d).queryByText("Avisei o residente em")).toBeNull();
    await waitFor(() => expect(within(d).getByLabelText("Prévia do reajuste").textContent).toContain("Perda pelo atrasoNenhuma"));
    expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "mantido", aviso_em: HOJE, simular: true });
    fireEvent.change(within(d).getByLabelText("Motivo"), { target: { value: "Reajustado fora de época em agosto" } });
    // O nome aparece duas vezes: no seletor de modo e no botão que grava (o último).
    fireEvent.click(within(d).getAllByRole("button", { name: "Manter valor" }).at(-1)!);
    await waitFor(() => expect(api.reajustar).toHaveBeenLastCalledWith("r1", { ciclo: "2026-11-20", modo: "mantido", aviso_em: HOJE, motivo: "Reajustado fora de época em agosto", simular: false }));
    expect(await screen.findByText("Valor mantido neste aniversário.")).toBeTruthy();
  });

  it("recusa do servidor na prévia aparece no diálogo e impede gravar; recusa ao gravar mantém o diálogo aberto", async () => {
    vi.mocked(api.reajustar).mockRejectedValueOnce(new ApiError("VALIDATION_ERROR", "A data do aviso não pode ser no futuro.", 422));
    abrir();
    const cartao = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    fireEvent.click(within(cartao).getByRole("button", { name: "Registrar reajuste" }));
    const d = await dialogo("Registrar reajuste");
    expect((await within(d).findByRole("alert")).textContent).toBe("A data do aviso não pode ser no futuro.");
    expect((within(d).getByRole("button", { name: "Registrar reajuste" }) as HTMLButtonElement).disabled).toBe(true);

    // Corrige (aqui, digitando o IGP-M) e a prévia volta; ao gravar, o servidor diz que o ciclo já foi decidido.
    fireEvent.change(within(d).getByLabelText("IGP-M acumulado (%)"), { target: { value: "5" } });
    await waitFor(() => expect(within(d).getByLabelText("Prévia do reajuste").textContent).toContain("R$ 3.850,00"));
    vi.mocked(api.reajustar).mockRejectedValueOnce(new ApiError("CONFLICT", "Este aniversário já tem uma decisão registrada.", 409));
    fireEvent.click(within(d).getByRole("button", { name: "Registrar reajuste" }));
    expect((await within(d).findByRole("alert")).textContent).toBe("Este aniversário já tem uma decisão registrada.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("IGP-M mal digitado não chama o servidor", async () => {
    abrir();
    const cartao = await screen.findByRole("article", { name: "Aviso atrasado de Ana Souza" });
    fireEvent.click(within(cartao).getByRole("button", { name: "Registrar reajuste" }));
    const d = await dialogo("Registrar reajuste");
    await waitFor(() => expect(api.reajustar).toHaveBeenCalledTimes(1));
    fireEvent.change(within(d).getByLabelText("IGP-M acumulado (%)"), { target: { value: "seis" } });
    expect(within(d).getByText(/Confira o IGP-M/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 450));
    expect(api.reajustar).toHaveBeenCalledTimes(1);
  });
});

describe("detalhe do residente", () => {
  it("mostra o contrato e a linha do tempo, do aniversário mais recente ao mais antigo", async () => {
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Ana Souza" }));
    expect(await screen.findByRole("heading", { name: "Ana Souza" })).toBeTruthy();
    expect(api.obter).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Data de entrada").nextElementSibling?.textContent).toBe("20/11/2024");
    expect(screen.getByText("Reajuste mínimo").nextElementSibling?.textContent).toBe("10%");
    expect(screen.getByText("Aviso com antecedência de").nextElementSibling?.textContent).toBe("30 dias");

    const itens = within(screen.getByRole("list", { name: "Linha do tempo dos reajustes" })).getAllByRole("listitem");
    expect(itens).toHaveLength(2);
    expect(itens[0]!.textContent).toContain("20/11/2026");
    expect(itens[0]!.textContent).toContain("Aviso atrasado");
    expect(itens[0]!.textContent).toContain("Perda estimada se avisar hoje: R$ 350,00");
    expect(within(itens[0]!).getByRole("button", { name: "Registrar reajuste" })).toBeTruthy();
    expect(itens[1]!.textContent).toContain("Reajustado");
    expect(itens[1]!.textContent).toContain("IGP-M de 9,38%");
    expect(itens[1]!.textContent).toContain("R$ 3.200,00");
    expect(itens[1]!.textContent).toContain("vale desde 20/11/2025");

    fireEvent.click(screen.getByRole("button", { name: /Todas as mensalidades/ }));
    expect(await screen.findByRole("button", { name: "Abrir Bruno Lima" })).toBeTruthy();
  });

  it("desfaz uma decisão depois de confirmar, e mostra a recusa do servidor", async () => {
    vi.mocked(api.removerReajuste).mockRejectedValueOnce(new ApiError("CONFLICT", "Já existe recebimento lançado com este valor.", 409)).mockResolvedValueOnce({ ok: true });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Ana Souza" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    const d = await dialogo("Desfazer esta decisão?");
    fireEvent.click(within(d).getByRole("button", { name: "Desfazer" }));
    expect((await within(d).findByRole("alert")).textContent).toBe("Já existe recebimento lançado com este valor.");
    fireEvent.click(within(d).getByRole("button", { name: "Desfazer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.removerReajuste).toHaveBeenLastCalledWith("rj1");
    expect(screen.getByText("Decisão desfeita.")).toBeTruthy();
  });

  it("edita o contrato e para de controlar", async () => {
    vi.mocked(api.salvar).mockResolvedValue(ana);
    vi.mocked(api.remover).mockResolvedValue({ ok: true });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Ana Souza" }));
    fireEvent.click(await screen.findByRole("button", { name: /Editar contrato/ }));
    const d = await dialogo("Editar contrato");
    fireEvent.change(within(d).getByLabelText("Dias de antecedência do aviso"), { target: { value: "200" } });
    fireEvent.click(within(d).getByRole("button", { name: "Salvar contrato" }));
    expect((await within(d).findByRole("alert")).textContent).toContain("entre 0 e 180");
    expect(api.salvar).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText("Dias de antecedência do aviso"), { target: { value: "45" } });
    fireEvent.change(within(d).getByLabelText("Reajuste mínimo (%)"), { target: { value: "12,5" } });
    fireEvent.click(within(d).getByRole("button", { name: "Salvar contrato" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledWith("r1", { data_base: "2024-11-20", ciclos_desde: "2026-01-01", percentual_minimo_bp: 1250, aviso_dias: 45 }));

    fireEvent.click(await screen.findByRole("button", { name: /Parar de controlar/ }));
    const c = await dialogo("Parar de controlar esta mensalidade?");
    fireEvent.click(within(c).getByRole("button", { name: "Parar de controlar" }));
    await waitFor(() => expect(api.remover).toHaveBeenCalledWith("r1"));
    expect(await screen.findByRole("button", { name: "Abrir Bruno Lima" })).toBeTruthy();
  });

  it("erro ao abrir o residente tem nova tentativa", async () => {
    vi.mocked(api.obter).mockRejectedValueOnce(new ApiError("NOT_FOUND", "Mensalidade não encontrada.", 404));
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Ana Souza" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Mensalidade não encontrada.");
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByRole("heading", { name: "Ana Souza" })).toBeTruthy();
  });
});

describe("adicionar mensalidade", () => {
  it("sem recorrência candidata, explica o passo anterior e leva a Recorrências", async () => {
    const irParaRecorrencias = vi.fn();
    abrir({ irParaRecorrencias });
    fireEvent.click((await screen.findAllByRole("button", { name: /Adicionar mensalidade/ }))[0]!);
    const d = await dialogo("Adicionar mensalidade");
    expect(await within(d).findByText("Primeiro, cadastre o que o residente paga")).toBeTruthy();
    fireEvent.click(within(d).getByRole("button", { name: "Ir para Recorrências" }));
    expect(irParaRecorrencias).toHaveBeenCalled();
  });

  it("escolhe a recorrência, sugere a data de entrada pelo início dela e cria o contrato", async () => {
    vi.mocked(api.candidatas).mockResolvedValue([{ recorrencia_id: "r9", descricao: "Mensalidade", beneficiario_nome: "Dora Reis", valor_centavos: 420000, data_inicio: "2025-03-05" }]);
    vi.mocked(api.salvar).mockResolvedValue(mens("r9", "Dora Reis", null));
    abrir();
    fireEvent.click((await screen.findAllByRole("button", { name: /Adicionar mensalidade/ }))[0]!);
    const d = await dialogo("Adicionar mensalidade");
    fireEvent.click(within(d).getByRole("button", { name: "Adicionar mensalidade" }));
    expect((await within(d).findByRole("alert")).textContent).toBe("Escolha de quem é a mensalidade.");

    fireEvent.click(await within(d).findByRole("button", { name: /Recorrência do residente/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Dora Reis · R\$ 4\.200,00/ }));
    fireEvent.click(within(d).getByRole("button", { name: "Adicionar mensalidade" }));
    await waitFor(() => expect(api.salvar).toHaveBeenCalledWith("r9", { data_base: "2025-03-05", ciclos_desde: HOJE, percentual_minimo_bp: 1000, aviso_dias: 30 }));
    expect(await screen.findByText("Mensalidade de Dora Reis adicionada.")).toBeTruthy();
  });

  it("falha ao buscar as candidatas tem nova tentativa", async () => {
    vi.mocked(api.candidatas).mockRejectedValueOnce(new ApiError("UNKNOWN", "Sem resposta do Cofre.", 500));
    abrir();
    fireEvent.click((await screen.findAllByRole("button", { name: /Adicionar mensalidade/ }))[0]!);
    const d = await dialogo("Adicionar mensalidade");
    expect((await within(d).findByRole("alert")).textContent).toBe("Sem resposta do Cofre.");
    fireEvent.click(within(d).getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("Primeiro, cadastre o que o residente paga")).toBeTruthy();
  });
});

describe("previsto × recebido", () => {
  const mes = (m: string, previsto: number, recebido: number) => ({ mes: m, previsto_centavos: previsto, recebido_centavos: recebido, em_aberto_centavos: Math.max(0, previsto - recebido) });
  const dados = {
    meses: ["2026-10", "2026-11"],
    linhas: [
      { recorrencia_id: "r1", descricao: "Mensalidade", beneficiario_nome: "Ana Souza", meses: [mes("2026-10", 350000, 350000), mes("2026-11", 350000, 0)] },
      { recorrencia_id: "r2", descricao: "Mensalidade", beneficiario_nome: "Bruno Lima", meses: [mes("2026-10", 400000, 400000), mes("2026-11", 400000, 400000)] },
    ],
    totais: [mes("2026-10", 750000, 750000), mes("2026-11", 750000, 400000)],
  };
  const abrirTabela = async (period: Parameters<typeof VaultMensalidades>[0]["period"] = { kind: "range", from: "2026-10-01", to: "2026-11-30" }) => {
    abrir({ period });
    fireEvent.click(await screen.findByRole("button", { name: "Previsto × recebido" }));
  };

  it("mostra cada residente por mês, os totais e o que ficou em aberto", async () => {
    vi.mocked(api.previstoRecebido).mockResolvedValue(dados);
    await abrirTabela();
    const tabela = await screen.findByRole("table");
    expect(api.previstoRecebido).toHaveBeenCalledWith({ data_de: "2026-10-01", data_ate: "2026-11-30" });
    expect(within(tabela).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Residente", "out/26", "nov/26", "Em aberto"]);
    const [, linhaAna, linhaBruno, total] = within(tabela).getAllByRole("row");
    expect(linhaAna!.textContent).toContain("falta R$ 3.500,00");
    expect(within(linhaAna!).getAllByRole("cell").at(-1)!.textContent).toBe("R$ 3.500,00");
    expect(within(linhaBruno!).getAllByRole("cell").at(-1)!.textContent).toBe("—");
    expect(total!.textContent).toContain("Total");
    expect(within(total!).getAllByRole("cell").at(-1)!.textContent).toBe("R$ 3.500,00");
    expect(screen.getByText("Previsto no período").nextElementSibling?.textContent).toBe("R$ 15.000,00");
    expect(screen.getByText("Recebido").nextElementSibling?.textContent).toBe("R$ 11.500,00");

    fireEvent.click(within(linhaAna!).getByRole("button", { name: "Abrir Ana Souza" }));
    expect(await screen.findByRole("heading", { name: "Ana Souza" })).toBeTruthy();
  });

  it("com um mês só, vira previsto, recebido e em aberto lado a lado", async () => {
    vi.mocked(api.previstoRecebido).mockResolvedValue({ meses: ["2026-11"], linhas: dados.linhas.map((l) => ({ ...l, meses: [l.meses[1]!] })), totais: [dados.totais[1]!] });
    await abrirTabela(periodo);
    const tabela = await screen.findByRole("table");
    expect(within(tabela).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Residente", "Previsto", "Recebido", "Em aberto"]);
    expect(within(tabela).getAllByRole("row")[1]!.textContent).toBe("Ana SouzaR$ 3.500,00R$ 0,00R$ 3.500,00");
  });

  it("trata carregando, vazio, erro e período acima de 24 meses", async () => {
    vi.mocked(api.previstoRecebido).mockRejectedValueOnce(new ApiError("UNKNOWN", "Falhou ao somar.", 500)).mockResolvedValueOnce({ meses: ["2026-11"], linhas: [], totais: [] });
    await abrirTabela(periodo);
    expect(screen.getByRole("status", { name: "Carregando previsto e recebido" })).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toContain("Falhou ao somar.");
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/ }));
    expect(await screen.findByText("Nada para comparar ainda")).toBeTruthy();
  });

  it("não consulta período acima de 24 meses", async () => {
    await abrirTabela({ kind: "range", from: "2024-01-01", to: "2026-11-30" });
    expect(await screen.findByText("Período longo demais")).toBeTruthy();
    expect(api.previstoRecebido).not.toHaveBeenCalled();
  });
});

describe("bloqueio ao concluir um recebimento", () => {
  const regra: RecorrenciaApi = {
    id: "r1", tipo: "entrada", descricao: "Mensalidade Ana", valor_centavos: 350000, categoria_id: null, conta_id: null, beneficiario_id: null, forma_pagamento: null,
    tipo_recorrencia: "fixa", frequencia: "mensal", intervalo: 1, dia_vencimento: null, data_inicio: "2024-11-20", data_fim: null, total_parcelas: null,
    parcelas_geradas: 0, efetivadas: 0, observacoes: null, espaco: "pessoal", ativa: true, criado_em: "", atualizado_em: "t0",
  };
  const recusa = () => Object.assign(new ApiError("MENSALIDADE_REAJUSTE_PENDENTE", "Há reajuste sem decisão.", 409, undefined, undefined, { recorrencia_id: "r1", ciclo: "2026-11-20" }));

  beforeEach(() => {
    vi.mocked(financeiro.recorrencias).mockResolvedValue([regra]);
    vi.mocked(financeiro.ocorrenciasDoPeriodo).mockResolvedValue([{ recorrencia_id: "r1", data: "2026-11-05", parcela: null, transacao_id: null, status: null, valor_centavos: 350000, data_lancamento: null }]);
    vi.mocked(vault.contas.listar).mockResolvedValue([]);
    vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
  });
  const tentarConcluir = async () => {
    render(<VaultRecorrencias period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} recarregar={0} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Mais ações: Mensalidade Ana/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Concluir$/ }));
  };

  it("reconhece a recusa do servidor pelo código e pelos dados do ciclo", () => {
    expect(bloqueioDeMensalidade(recusa())).toEqual({ recorrencia_id: "r1", ciclo: "2026-11-20" });
    expect(bloqueioDeMensalidade(new ApiError("CONFLICT", "outro", 409))).toBeNull();
    expect(bloqueioDeMensalidade(new ApiError("MENSALIDADE_REAJUSTE_PENDENTE", "sem dados", 409))).toBeNull();
    expect(bloqueioDeMensalidade(new Error("x"))).toBeNull();
  });

  it("explica o ciclo sem decisão, leva ao reajuste e depois conclui o recebimento", async () => {
    vi.mocked(financeiro.concluir).mockRejectedValueOnce(recusa()).mockResolvedValueOnce({ transacao_id: "t1" });
    await tentarConcluir();
    const d = await dialogo("Reajuste pendente");
    expect(d.textContent).toContain("o reajuste do aniversário de 20/11/2026 está sem decisão");
    expect(await within(d).findByText(/Com o mínimo de 10%/)).toBeTruthy();
    expect(d.textContent).toContain("R$ 3.850,00");
    // A recusa não vira uma faixa de erro solta na tela.
    expect(screen.queryByText("Há reajuste sem decisão.")).toBeNull();

    fireEvent.click(within(d).getByRole("button", { name: "Registrar reajuste" }));
    const r = await dialogo("Registrar reajuste");
    await waitFor(() => expect(within(r).getByLabelText("Prévia do reajuste").textContent).toContain("R$ 3.850,00"));
    fireEvent.click(within(r).getByRole("button", { name: "Registrar reajuste" }));
    await waitFor(() => expect(financeiro.concluir).toHaveBeenCalledTimes(2));
    expect(api.reajustar).toHaveBeenLastCalledWith("r1", expect.objectContaining({ ciclo: "2026-11-20", simular: false }));
    expect(await screen.findByText("Ocorrência concluída.")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("oferece manter o valor, e 'Agora não' fecha sem gravar nada", async () => {
    vi.mocked(financeiro.concluir).mockRejectedValue(recusa());
    await tentarConcluir();
    const d = await dialogo("Reajuste pendente");
    fireEvent.click(await within(d).findByRole("button", { name: "Manter valor" }));
    expect(await dialogo("Manter valor")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.reajustar).not.toHaveBeenCalledWith("r1", expect.objectContaining({ simular: false }));
  });

  it("se o contrato não carregar, o diálogo mostra o erro e tenta de novo", async () => {
    vi.mocked(financeiro.concluir).mockRejectedValue(recusa());
    vi.mocked(api.obter).mockRejectedValueOnce(new ApiError("UNKNOWN", "Sem resposta do Cofre.", 500));
    await tentarConcluir();
    const d = await dialogo("Reajuste pendente");
    expect((await within(d).findByRole("alert")).textContent).toBe("Sem resposta do Cofre.");
    fireEvent.click(within(d).getByRole("button", { name: "Tentar novamente" }));
    expect(await within(d).findByRole("button", { name: "Registrar reajuste" })).toBeTruthy();
  });
});

describe("formatação", () => {
  it("converte percentual digitado em pontos-base e de volta", () => {
    expect(bpDoCampo("6,52")).toBe(652);
    expect(bpDoCampo("6.5")).toBe(650);
    expect(bpDoCampo("10%")).toBe(1000);
    expect(bpDoCampo("0")).toBe(0);
    expect(bpDoCampo("")).toBeNull();
    expect(bpDoCampo("-3")).toBeNull();
    expect(bpDoCampo("6,523")).toBeNull();
    expect(formatPercentual(1000)).toBe("10%");
    expect(formatPercentual(652)).toBe("6,52%");
  });

  it("descreve o prazo e conta os meses do período", () => {
    expect(prazoPorExtenso("2026-11-15", "2026-11-15")).toBe("é hoje");
    expect(prazoPorExtenso("2026-11-15", "2026-11-16")).toBe("falta 1 dia");
    expect(prazoPorExtenso("2026-11-15", "2026-10-21")).toBe("venceu há 25 dias");
    expect(mesesNoIntervalo("2026-11-01", "2026-11-30")).toBe(1);
    expect(mesesNoIntervalo("2024-12-01", "2026-11-30")).toBe(24);
    expect(mesesNoIntervalo("2024-11-30", "2026-11-01")).toBe(25);
  });

  it("calcula a vigência de quem avisa hoje e resume as pendências", () => {
    expect(vigenciaSeAvisarHoje("2026-11-15", "2026-11-20", 30)).toBe("2026-12-15");
    expect(vigenciaSeAvisarHoje("2026-11-15", "2026-12-28", 30)).toBe("2026-12-28");
    expect(resumoDePendencias([ana, bruno, clara])).toEqual({ ciclos: 2, perdaCentavos: 35000, atrasados: 1 });
    expect(resumoDePendencias([clara])).toEqual({ ciclos: 0, perdaCentavos: 0, atrasados: 0 });
  });

  it("recorrência controlada: a recusa de mudar o valor aparece na janela, com o atalho para Mensalidades", async () => {
    const texto = "O valor desta recorrência é controlado pelas Mensalidades. Registre um reajuste para alterá-lo.";
    const regra: RecorrenciaApi = {
      id: "r1", tipo: "entrada", descricao: "Mensalidade Ana", valor_centavos: 350000, categoria_id: null, conta_id: null, beneficiario_id: null, forma_pagamento: null,
      tipo_recorrencia: "fixa", frequencia: "mensal", intervalo: 1, dia_vencimento: null, data_inicio: "2024-11-20", data_fim: null, total_parcelas: null,
      parcelas_geradas: 0, efetivadas: 0, observacoes: null, espaco: "pessoal", ativa: false, criado_em: "", atualizado_em: "t0",
    };
    vi.mocked(financeiro.recorrencias).mockResolvedValue([regra]);
    vi.mocked(financeiro.ocorrenciasDoPeriodo).mockResolvedValue([]);
    vi.mocked(vault.contas.listar).mockResolvedValue([]);
    vi.mocked(vault.beneficiarios.listar).mockResolvedValue([]);
    vi.mocked(financeiro.atualizarRecorrencia).mockRejectedValue(new ApiError("CONFLICT", texto, 409));
    const irParaMensalidades = vi.fn();
    render(<VaultRecorrencias period={periodo} onPeriodChange={vi.fn()} categorias={[]} atualizar={vi.fn()} recarregar={0} irParaMensalidades={irParaMensalidades} />);
    // Regra pausada: abre pela lista de pausadas, direto na edição da regra inteira.
    fireEvent.click(await screen.findByText(/Pausadas \(1\)/));
    fireEvent.click(screen.getByRole("button", { name: "Mensalidade Ana" }));
    const d = await screen.findByRole("dialog");
    fireEvent.click(within(d).getByRole("button", { name: /^Salvar/ }));
    expect((await within(d).findByRole("alert")).textContent).toBe(texto);
    fireEvent.click(within(d).getByRole("button", { name: "Abrir Mensalidades" }));
    expect(irParaMensalidades).toHaveBeenCalled();
  });
});
