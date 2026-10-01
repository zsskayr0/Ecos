import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { RefreshProvider } from "@/lib/refresh-bus";
import { AppUIProvider } from "@/lib/ui-context";
vi.mock("@/lib/api", async (importOriginal) => { const o = await importOriginal<typeof import("@/lib/api")>(); return { ...o, auth: { ...o.auth, perfil: vi.fn() }, vault: { ...o.vault, config: vi.fn(), bloquear: vi.fn(), categorias: { listar: vi.fn() }, transacoes: { listar: vi.fn() } }, financeiro: { ...o.financeiro, painel: vi.fn(), ocorrencias: vi.fn(), reagendar: vi.fn(), pendencias: { listar: vi.fn(), converter: vi.fn() } } }; });
import { auth, vault, financeiro, ApiError } from "@/lib/api";
import { VaultScreen } from "./VaultScreen";
import { VaultWorkflow } from "./VaultWorkflow";
import type { Painel } from "./types";
import { VaultDashboard } from "./VaultDashboard";
import { formatMoeda } from "@/lib/format";
const painel: Painel = { saldo: 987654321, receitas: 0, despesas: 0, taxa_economia: null, mensal: false, series: [], categorias: [], pagamentos: [], maiores_entradas: [], maiores_saidas: [], previsoes: [] };
it("previsão pode ser ligada e desligada e drill-down respeita intervalo parcial",()=>{
    const drill=vi.fn();
    const p={...painel,mensal:true,series:[{data:"2026-09",receitas:300,despesas:0,receitas_confirmadas:100,despesas_confirmadas:0}],previsoes:[{recorrencia_id:"r",data:"2026-09-22",tipo:"entrada" as const,descricao:"previsão",valor_centavos:500}]};
    render(<VaultDashboard painel={p} categorias={[]} periodo={{data_de:"2026-09-15",data_ate:"2026-09-25"}} drill={drill} abrir={vi.fn()}/>);
    expect(screen.getByRole("table",{hidden:true}).textContent).toContain(formatMoeda(100));
    fireEvent.click(screen.getByLabelText("Incluir previsão"));
    expect(screen.getByRole("table",{hidden:true}).textContent).toContain(formatMoeda(800));
    fireEvent.click(screen.getByLabelText("Incluir previsão"));
    expect(screen.getByRole("table",{hidden:true}).textContent).toContain(formatMoeda(100));
    fireEvent.click(screen.getByRole("button",{name:"2026-09",hidden:true}));
    expect(drill).toHaveBeenCalledWith({data_de:"2026-09-15",data_ate:"2026-09-25"});
});
beforeEach(() => { vi.clearAllMocks(); vi.mocked(auth.perfil).mockResolvedValue({ cofre_ativado: true } as Awaited<ReturnType<typeof auth.perfil>>); vi.mocked(vault.config).mockResolvedValue({ cofre_ativado: true, destrancado: true, saldos_por_conta: [] }); vi.mocked(vault.categorias.listar).mockResolvedValue([]); vi.mocked(financeiro.painel).mockResolvedValue(painel); vi.mocked(financeiro.ocorrencias).mockResolvedValue([]); vi.mocked(financeiro.pendencias.listar).mockResolvedValue([]); vi.mocked(vault.transacoes.listar).mockResolvedValue({ items: [], next_cursor: null }); });
it("remove painel e menus financeiros imediatamente ao bloquear", async () => {
    vi.mocked(vault.bloquear).mockImplementation(() => new Promise(() => { }));
    render(<MemoryRouter initialEntries={["/cofre"]}><RefreshProvider><AppUIProvider><VaultScreen voltar={vi.fn()}/></AppUIProvider></RefreshProvider></MemoryRouter>);
    await screen.findByText("Saldo total (histórico)");
    fireEvent.click(screen.getByRole("button", { name: "Bloquear" }));
    expect(screen.queryByText("Saldo total (histórico)")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Navegação do Cofre" })).toBeNull();
    expect(screen.getByText("O Cofre está bloqueado")).toBeTruthy();
});
it("resposta atrasada do painel não reaparece depois do bloqueio", async () => {
    let resolver!: (p: Painel) => void;
    vi.mocked(financeiro.painel).mockImplementation(() => new Promise(r => { resolver = r; }));
    render(<MemoryRouter><RefreshProvider><AppUIProvider><VaultScreen voltar={vi.fn()}/></AppUIProvider></RefreshProvider></MemoryRouter>);
    await screen.findByRole("button", { name: "Bloquear" });
    act(() => { window.dispatchEvent(new Event("ecos:cofre-bloqueado")); });
    await act(async () => { resolver(painel); });
    expect(screen.queryByText("Saldo total (histórico)")).toBeNull();
});
it("agendamento por toque/teclado restaura pendência quando a rede falha", async () => {
    vi.mocked(financeiro.pendencias.listar).mockResolvedValue([{ id: "p1", descricao: "Pendência teste", tipo: "saida", valor_centavos: 500 }]);
    vi.mocked(financeiro.pendencias.converter).mockRejectedValue(new Error("Falha de rede"));
    render(<AppUIProvider><VaultWorkflow recarregar={0} atualizar={vi.fn()}/></AppUIProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /Pendência teste/ }));
    fireEvent.click(screen.getByRole("button", { name: "Concluir na data" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("visualização foi restaurada"));
    expect(screen.getByRole("button", { name: /Pendência teste/ }).textContent).toContain("Sem data");
    expect(financeiro.pendencias.converter).toHaveBeenCalledOnce();
});

it("explica rota ausente sem impedir acesso aos lançamentos", async () => {
    vi.mocked(financeiro.painel).mockRejectedValue(new ApiError("NOT_FOUND", "Ausente", 404));
    render(<MemoryRouter initialEntries={["/cofre"]}><RefreshProvider><AppUIProvider><VaultScreen voltar={vi.fn()}/></AppUIProvider></RefreshProvider></MemoryRouter>);
    await screen.findByText("O painel precisa de uma atualização");
    fireEvent.click(screen.getByRole("button", {name:"Abrir lançamentos"}));
    await screen.findByText("Nenhum lançamento neste filtro.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(financeiro.painel).toHaveBeenCalledTimes(1);
});
