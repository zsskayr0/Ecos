import { useEffect, useState, type MouseEvent } from "react";
import { ChevronDown, Folder, FolderPlus, Link2, ListChecks, Paperclip, StickyNote, Trash2, User, Users, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ApiError, pastas } from "@/lib/api";
import { PastasGrade, type ItemExplorador, type PastaResumo } from "@/components/views/PastasGrade";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { useRefreshBus } from "@/lib/refresh-bus";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { corDaEquipe } from "@/lib/team-color";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { Toggle } from "@/components/common/Toggle";
import { lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { avisar } from "@/lib/toast";

import { TagsOrganizacao } from "./TagsOrganizacao";
type Tipo = "nota" | "tarefa";

/** Administração global de diretórios. A navegação de conteúdo permanece em
 * Notas e Tarefas; aqui se escolhe explicitamente a árvore e o espaço. */
export function OrganizationScreen() {
  const navigate = useNavigate();
  const abrirDocumento = useAbrirDocumento();
  const { equipes } = useMinhasEquipes();
  const { versao, notificar } = useRefreshBus();
  const [tipo, setTipo] = useState<Tipo>("nota");
  const [espaco, setEspaco] = useState("pessoal");
  const [lista, setLista] = useState<PastaResumo[] | null>(null);
  const [itens, setItens] = useState<ItemExplorador[]>([]);
  const [pastaAtual, setPastaAtual] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [versaoLista, setVersaoLista] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [novaAberta, setNovaAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [criando, setCriando] = useState(false);
  const [preferencias, setPreferencias] = useState(lerPreferenciasAplicativo);
  const alterarPreferencia = (patch: Partial<PreferenciasAplicativo>) => setPreferencias((atual) => { const proxima = { ...atual, ...patch }; salvarPreferenciasAplicativo(proxima); return proxima; });

  useEffect(() => {
    let ativa = true;
    setAtualizando(true); setErro(null);
    pastas.listar({ tipo, espaco, pasta_pai: pastaAtual })
      .then((r) => { if (ativa) { setLista(r.subpastas); setItens(r.itens as unknown as ItemExplorador[]); setVersaoLista((v) => v + 1); } })
      .catch((e) => ativa && setErro(e instanceof ApiError ? e.message : "Não foi possível carregar as pastas."))
      .finally(() => { if (ativa) setAtualizando(false); });
    return () => { ativa = false; };
  }, [tipo, espaco, pastaAtual, versao]);

  async function criar() {
    if (!nome.trim() || criando) return;
    setCriando(true); setErro(null);
    try {
      await pastas.criar({ tipo, espaco, pasta_pai: pastaAtual, nome: nome.trim() });
      setNome(""); setNovaAberta(false); notificar(); avisar(pastaAtual ? "Subpasta criada com sucesso." : "Pasta criada com sucesso.", "sucesso");
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a pasta.");
    } finally { setCriando(false); }
  }

  const rotuloEspaco = espaco === "pessoal" ? "Pessoal" : equipes.find((e) => `equipe:${e.id}` === espaco)?.nome ?? "Equipe";
  const titulo = tipo === "nota" ? "Pastas de notas" : "Pastas de tarefas";
  const opcoesEspaco = [
    { valor: "pessoal", rotulo: "Pessoal", icone: User, cor: TOM.aco },
    ...equipes.map((e) => ({ valor: `equipe:${e.id}`, rotulo: e.nome, icone: Users, cor: corDaEquipe(e.id) })),
  ];
  function trocarTipo(proximo: Tipo) { setTipo(proximo); setPastaAtual(""); }
  function trocarEspaco(proximo: string) { setEspaco(proximo); setPastaAtual(""); }
  function abrirItem(item: ItemExplorador, evento: MouseEvent<HTMLButtonElement>) {
    const destino = item.tipo === "nota" && item.id ? `/notas/nota/${item.id}` : item.tipo === "tarefa" && item.id ? `/tarefa/${item.id}` : item.caminho ? `/media/ver?c=${encodeURIComponent(item.caminho)}` : null;
    if (!destino) return;
    abrirDocumento(destino, evento);
  }

  return <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
    <header className="mb-5">
      <h1 className="font-display text-xl text-text-primary">Organização</h1><p className="text-sm text-text-secondary">Gerencie pastas e tags sem sair do espaço certo.</p>
    </header>

    <section className="mb-5 rounded-2xl bg-surface-1 p-3" aria-label="Escopo das pastas e tags">
      <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Tipo</p>
          <div className="grid grid-cols-2 gap-2">
            <EscopoBotao ativo={tipo === "nota"} onClick={() => trocarTipo("nota")} Icone={StickyNote} texto="Notas" />
            <EscopoBotao ativo={tipo === "tarefa"} onClick={() => trocarTipo("tarefa")} Icone={ListChecks} texto="Tarefas" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Espaço</p>
          <MenuSuspenso valor={espaco} opcoes={opcoesEspaco} onChange={trocarEspaco} ariaLabel="Escolher espaço das pastas" larguraMenu="w-full"
            classeGatilho="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-left text-sm text-text-primary transition-colors hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400"
            corAtiva={opcoesEspaco.find((o) => o.valor === espaco)?.cor}
            gatilho={({ aberto, atual }) => <><span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ color: atual?.cor, backgroundColor: `color-mix(in srgb, ${atual?.cor ?? TOM.aco} 18%, transparent)` }}>{atual?.icone && <atual.icone size={15} />}</span><span className="min-w-0 flex-1 truncate font-medium">{atual?.rotulo}</span><ChevronDown size={16} className={`text-text-muted transition-transform duration-150 ${aberto ? "rotate-180" : ""}`} /></>} />
        </div>
      </div>
    </section>

    {erro && <p role="alert" className="mb-4 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error">{erro}</p>}
    {lista === null ? <p className="py-8 text-center text-sm text-text-muted">Carregando pastas…</p> : <>
      <nav aria-label="Caminho da pasta" className="mb-3 flex min-h-9 items-center gap-1 overflow-x-auto rounded-xl bg-surface-1 px-2 text-sm"><button type="button" onClick={() => setPastaAtual("")} className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 ${pastaAtual ? "text-text-secondary hover:bg-surface-2" : "text-text-primary"}`}><Folder size={15} className="text-steel-300" />Raiz</button>{pastaAtual.split("/").filter(Boolean).map((parte, indice, partes) => { const caminho = partes.slice(0, indice + 1).join("/"); return <span key={caminho} className="flex shrink-0 items-center gap-1"><span className="text-text-muted">/</span><button type="button" onClick={() => setPastaAtual(caminho)} className="rounded-lg px-1.5 py-1.5 text-text-secondary hover:bg-surface-2">{parte}</button></span>; })}</nav>
      <div className={`relative transition-[opacity,filter,transform] duration-200 ease-out ${atualizando ? "pointer-events-none opacity-55 blur-[1px]" : ""}`} aria-busy={atualizando}>
        <div key={versaoLista} className="ecos-item-entra">
          <PastasGrade chave={tipo === "nota" ? "notas" : "tarefas"} titulo={titulo} corIcone={tipo === "nota" ? "text-steel-300" : "text-cyan"} espaco={espaco} pastas={lista} itens={itens} visualizacao="explorador"
            aoAbrir={(p) => setPastaAtual(p.caminho)}
            aoAbrirItem={abrirItem}
            aoCriar={() => setNovaAberta(true)} rotuloCriar={pastaAtual ? "Nova subpasta" : "Nova pasta"} />
        </div>
        {atualizando && <div aria-hidden className="absolute inset-x-0 top-7 h-px overflow-hidden bg-border"><span className="block h-full w-1/3 animate-pulse bg-cyan" /></div>}
      </div>
    </>}

    <section className="mt-8">
    <TagsOrganizacao espaco={espaco} />

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Links</p>
      <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
        <LinhaPreferencia Icone={Link2} titulo="Formato para links novos" descricao="Define como os links internos serão gerados.">
          <MenuSuspenso valor={preferencias.formatoLink} onChange={(formatoLink) => alterarPreferencia({ formatoLink })} ariaLabel="Formato para links novos" alinhar="dir" opcoes={[{ valor: "curto", rotulo: "Menor caminho possível" }, { valor: "relativo", rotulo: "Caminho relativo" }, { valor: "absoluto", rotulo: "Caminho completo" }]}
            classeGatilho={CLASSE_SELETOR} gatilho={({ aberto, atual }) => <><span className="truncate">{atual?.rotulo}</span><ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />
        </LinhaPreferencia>
        <LinhaPreferencia Icone={Link2} titulo="Atualizar links internos" descricao="Ao renomear ou mover um item, atualiza os links que apontam para ele."><Toggle checked={preferencias.atualizarLinks} onChange={(atualizarLinks) => alterarPreferencia({ atualizarLinks })} label="Atualizar links internos" /></LinhaPreferencia>
        <LinhaPreferencia Icone={Link2} titulo="Usar wikilinks" descricao="Cria [[links internos]] em vez de links Markdown."><Toggle checked={preferencias.usarWikilinks} onChange={(usarWikilinks) => alterarPreferencia({ usarWikilinks })} label="Usar wikilinks" /></LinhaPreferencia>
      </div>
    </section>

    <section className="mt-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Lixeira</p>
      <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
        <LinhaPreferencia Icone={Trash2} titulo="Confirmar antes de excluir" descricao="Evita exclusões acidentais de notas, tarefas e arquivos."><Toggle checked={preferencias.confirmarExclusao} onChange={(confirmarExclusao) => alterarPreferencia({ confirmarExclusao })} label="Confirmar antes de excluir" /></LinhaPreferencia>
        <LinhaPreferencia Icone={Paperclip} titulo="Anexos ao excluir" descricao="O que fazer com anexos que não são usados em outro lugar.">
          <MenuSuspenso valor={preferencias.excluirAnexos} onChange={(excluirAnexos) => alterarPreferencia({ excluirAnexos })} ariaLabel="Anexos ao excluir" alinhar="dir" opcoes={[{ valor: "perguntar", rotulo: "Perguntar sempre" }, { valor: "automatico", rotulo: "Excluir automaticamente" }, { valor: "manter", rotulo: "Manter anexos" }]}
            classeGatilho={CLASSE_SELETOR} gatilho={({ aberto, atual }) => <><span className="truncate">{atual?.rotulo}</span><ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />
        </LinhaPreferencia>
        <LinhaPreferencia Icone={Trash2} titulo="Itens excluídos" descricao="Escolha o destino padrão ao apagar um item.">
          <MenuSuspenso valor={preferencias.destinoExclusao} onChange={(destinoExclusao) => alterarPreferencia({ destinoExclusao })} ariaLabel="Destino dos itens excluídos" alinhar="dir" opcoes={[{ valor: "sistema", rotulo: "Lixeira do sistema" }, { valor: "ecos", rotulo: "Lixeira do Ecos" }, { valor: "permanente", rotulo: "Excluir permanentemente" }]}
            classeGatilho={CLASSE_SELETOR} gatilho={({ aberto, atual }) => <><span className="truncate">{atual?.rotulo}</span><ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />
        </LinhaPreferencia>
      </div>
    </section>

    {novaAberta && <div role="dialog" aria-modal="true" aria-labelledby="nova-pasta-titulo" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"><div className="w-full max-w-sm rounded-2xl border border-border bg-surface-1 p-5 shadow-nav"><div className="mb-4 flex items-center justify-between"><h2 id="nova-pasta-titulo" className="font-semibold text-text-primary">{pastaAtual ? "Nova subpasta" : `Nova pasta de ${tipo === "nota" ? "notas" : "tarefas"}`}</h2><button type="button" onClick={() => setNovaAberta(false)} aria-label="Fechar" className="text-text-muted"><X size={18} /></button></div><p className="mb-3 break-words text-sm text-text-secondary">{pastaAtual ? <>Dentro de <span className="font-medium text-text-primary">{pastaAtual.split("/").join(" / ")}</span></> : <>Ela será criada em {rotuloEspaco}.</>}</p><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void criar()} placeholder={pastaAtual ? "Nome da subpasta" : "Nome da pasta"} className="ecos-input w-full !rounded-lg" /><button type="button" disabled={!nome.trim() || criando} onClick={() => void criar()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-white disabled:opacity-40"><FolderPlus size={16} />{pastaAtual ? "Criar subpasta" : "Criar pasta"}</button></div></div>}
  </div>;
}

const CLASSE_SELETOR = "flex min-h-10 min-w-44 items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 text-left text-sm text-text-primary hover:bg-surface-3";
function LinhaPreferencia({ Icone, titulo, descricao, children }: { Icone: typeof Link2; titulo: string; descricao: string; children: React.ReactNode }) {
  return <div className="flex min-h-20 items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"><Icone size={18} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{titulo}</span><span className="block text-xs leading-relaxed text-text-muted">{descricao}</span></span>{children}</div>;
}

function EscopoBotao({ ativo, onClick, Icone, texto }: { ativo: boolean; onClick: () => void; Icone: typeof StickyNote; texto: string }) {
  return <button type="button" onClick={onClick} aria-pressed={ativo} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium ${ativo ? "bg-cyan/15 text-cyan" : "bg-surface-2 text-text-secondary hover:text-text-primary"}`}><Icone size={16} />{texto}</button>;
}
