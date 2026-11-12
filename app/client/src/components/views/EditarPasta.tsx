import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Clock3, Flag, Palette, Pin, Tags, TextCursorInput, X } from "lucide-react";
import { useEscFecha } from "@/components/common/Dialog";
import { EditorTagsPadrao } from "@/components/common/EditorTagsPadrao";
import { IconePorNome } from "@/components/common/IconePorNome";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { pastas as pastasApi } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { movimentoReduzido } from "@/lib/movimento";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { definirPastaOtimista, type CamposPasta } from "@/lib/pasta-otimista";
import { useIsDesktop } from "@/lib/use-viewport";
import type { PastaResumo } from "./PastasGrade";

const AparenciaPasta = lazy(() => import("@/components/common/AparenciaPasta"));
const COR_INICIAL = "#7dd3fc";

/** Baixa os seletores (e o catálogo de ícones) em segundo plano, para não competir com a animação de abertura. */
function precarregarSeletores() {
  void import("@/components/common/AparenciaPasta");
  void import("@/screens/Vault/IconPicker");
}

/** Os seletores de cor e ícone desenham centenas de elementos: montá-los no meio da animação trava os quadros. Espera ela acabar. */
function AposAnimacao({ children, esperaMs = 300 }: { children: ReactNode; esperaMs?: number }) {
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setPronto(true), movimentoReduzido() ? 0 : esperaMs);
    return () => window.clearTimeout(t);
  }, [esperaMs]);
  return pronto ? <>{children}</> : <div aria-hidden className="h-64 animate-pulse rounded-xl bg-surface-2/60" />;
}

type Prioridade = "" | "baixa" | "media" | "alta";
const PRIORIDADES = [
  { valor: "", rotulo: "Padrão das preferências" },
  { valor: "baixa", rotulo: "Baixa", icone: Flag, cor: TOM.ciano },
  { valor: "media", rotulo: "Média", icone: Flag, cor: TOM.alerta },
  { valor: "alta", rotulo: "Alta", icone: Flag, cor: TOM.erro },
] as const;
const DURACOES = [0, 5, 15, 30, 45, 60, 90, 120, 240].map((min) => ({
  valor: String(min),
  rotulo: min === 0 ? "Padrão das preferências" : min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)} h ${min % 60} min`,
}));

type SecaoId = "aparencia" | "tags" | "tarefas" | "detalhes";

/** Largura mínima da tela para a aba lateral de cor e ícone caber ao lado do painel; abaixo disso vira seção recolhível. */
const LARGURA_ABA_LATERAL = 900;
function useLargura(minimo: number): boolean {
  const consulta = `(min-width: ${minimo}px)`;
  const [largo, setLargo] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia?.(consulta);
    if (!m) return;
    const atualizar = () => setLargo(m.matches);
    atualizar();
    m.addEventListener("change", atualizar);
    return () => m.removeEventListener("change", atualizar);
  }, [consulta]);
  return largo;
}

function Secao({ id, icone: Icone, titulo, resumo, aberta, onAlternar, children }: { id: string; icone: typeof Palette; titulo: string; resumo?: ReactNode; aberta: boolean; onAlternar: () => void; children: ReactNode }) {
  // O conteúdo só entra na primeira abertura (os seletores de cor e ícone são pesados) e depois fica, para o fechar animar.
  const [montada, setMontada] = useState(aberta);
  useEffect(() => { if (aberta) setMontada(true); }, [aberta]);
  return (
    <section className="border-t border-border/70 first:border-t-0">
      <button type="button" id={`${id}-cab`} aria-expanded={aberta} aria-controls={`${id}-corpo`} onClick={onAlternar}
        className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm font-medium text-text-primary hover:bg-surface-2">
        <Icone size={16} className="shrink-0 text-steel-300" aria-hidden />
        <span className="flex-1">{titulo}</span>
        <span className={`flex min-w-0 max-w-[55%] items-center gap-1.5 truncate text-xs font-normal text-text-muted transition-opacity duration-150 ${aberta || !resumo ? "opacity-0" : "opacity-100"}`} aria-hidden={aberta || undefined}>{resumo}</span>
        <ChevronDown size={16} className={`shrink-0 text-text-muted transition-transform duration-200 ${aberta ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className="ecos-colapsa" data-aberto={aberta} {...(aberta ? {} : ({ inert: "" } as object))}>
        <div>{montada && <div id={`${id}-corpo`} role="region" aria-labelledby={`${id}-cab`} className="px-4 pb-4 pt-1">{children}</div>}</div>
      </div>
    </section>
  );
}

function Campo({ rotulo, dica, htmlFor, children }: { rotulo: string; dica?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-text-secondary">{rotulo}</label>
      {children}
      {dica && <p className="mt-1.5 text-xs leading-relaxed text-text-muted">{dica}</p>}
    </div>
  );
}

type Renomear = Parameters<typeof pastasApi.renomear>[0];

/**
 * Confia no servidor (Optimistic UI): a tela já mostra o resultado e o pedido segue pendente em segundo plano. Se falhar,
 * a sobreposição é desfeita e um aviso oferece tentar de novo. Fica fora do componente porque o painel fecha antes de a
 * resposta chegar.
 */
function enviarEmSegundoPlano(a: { caminhoAtual: string; novoCaminho: string; nome: string; campos: CamposPasta; payload: Renomear; notificar: () => void; aoConcluir: (novoCaminho: string) => void }) {
  const reverter = definirPastaOtimista(a.caminhoAtual, a.campos);
  pastasApi.renomear(a.payload)
    .then(() => {
      a.notificar();
      avisar("Pasta atualizada com sucesso.", "sucesso");
      a.aoConcluir(a.novoCaminho);
    })
    .catch((e) => {
      reverter();
      avisar(mensagemDeErro(e, `Não foi possível salvar a pasta ${a.nome}.`), "erro", { rotulo: "Tentar de novo", aoClicar: () => enviarEmSegundoPlano(a) });
    });
}

/**
 * Edição de uma pasta (nome, aparência, tags e padrões). No desktop é uma aba flutuante fixa à direita, sem véu: a lista
 * continua visível e usável por trás. No celular é uma folha que sobe da base. Seções recolhidas por padrão, para o painel
 * caber em qualquer tela (e não crescer em monitores largos).
 */
export function EditarPasta({ pasta, tipo, espaco, aoFechar, aoSalvar }: {
  pasta: PastaResumo;
  tipo: "nota" | "tarefa";
  espaco?: string;
  aoFechar: () => void;
  /** Recebe o caminho novo (muda quando o nome muda): quem está dentro da pasta precisa ir para ele. */
  aoSalvar: (novoCaminho: string) => void;
}) {
  const desktop = useIsDesktop();
  const lateral = useLargura(LARGURA_ABA_LATERAL) && desktop;
  const [corAberta, setCorAberta] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [abaSaindo, setAbaSaindo] = useState(false);
  const { notificar } = useRefreshBus();
  const idBase = useId();
  const [nome, setNome] = useState(pasta.nome);
  const [cor, setCor] = useState(pasta.cor ?? "");
  const [icone, setIcone] = useState(pasta.icone ?? "");
  const [tags, setTags] = useState<string[]>(pasta.tags ?? []);
  const [descricao, setDescricao] = useState(pasta.descricao ?? "");
  const [fixada, setFixada] = useState(!!pasta.fixada);
  const [prioridade, setPrioridade] = useState<Prioridade>(pasta.prioridade_padrao ?? "");
  const [duracao, setDuracao] = useState(pasta.duracao_padrao_min ?? 0);
  const [abertas, setAbertas] = useState<Set<SecaoId>>(() => new Set<SecaoId>(["tags"]));
  const [erro, setErro] = useState<string | null>(null);

  /** Fecha tocando a animação de saída (a mesma dos outros modais) e só então avisa quem abriu. */
  function fechar(depois: () => void = aoFechar) {
    if (saindo) return;
    if (movimentoReduzido()) { depois(); return; }
    setSaindo(true);
    window.setTimeout(depois, 190);
  }
  function fecharAba() {
    if (abaSaindo) return;
    if (movimentoReduzido()) { setCorAberta(false); return; }
    setAbaSaindo(true);
    window.setTimeout(() => { setCorAberta(false); setAbaSaindo(false); }, 170);
  }
  function alternarAba() { if (corAberta) fecharAba(); else setCorAberta(true); }
  useEffect(() => { const t = window.setTimeout(precarregarSeletores, 150); return () => window.clearTimeout(t); }, []);
  useEscFecha(true, () => fechar());
  // Registrado depois do principal: o Esc fecha primeiro a aba lateral.
  useEscFecha(lateral && corAberta, fecharAba);
  const alternar = (id: SecaoId) => setAbertas((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });

  const nomeLimpo = nome.trim();
  const nomeInvalido = !nomeLimpo || /[\\/]/.test(nomeLimpo);
  const pai = pasta.caminho.split("/").slice(0, -1).join("/");

  function salvar() {
    if (nomeInvalido || saindo) { if (nomeInvalido) setErro(nomeLimpo ? "O nome não pode ter barras." : "Dê um nome à pasta."); return; }
    const novoCaminho = pai ? `${pai}/${nomeLimpo}` : nomeLimpo;
    const campos: CamposPasta = { cor: cor || null, icone: icone || null, tags, descricao, fixada, prioridade_padrao: prioridade || null, duracao_padrao_min: duracao || null };
    enviarEmSegundoPlano({
      caminhoAtual: pasta.caminho, novoCaminho, nome: nomeLimpo, campos, notificar, aoConcluir: aoSalvar,
      payload: { tipo, espaco, caminho_atual: pasta.caminho, novo_caminho: novoCaminho, cor, icone, tags, descricao, fixada, prioridade_padrao: prioridade, duracao_padrao_min: duracao },
    });
    fechar(); // não espera o servidor: a pasta já aparece atualizada e o pedido segue pendente
  }

  const resumoCor = <><span aria-hidden className="flex h-5 w-5 items-center justify-center" style={cor ? { color: cor } : undefined}><IconePorNome nome={icone || "Folder"} padrao="Folder" size={16} /></span>{cor ? cor.toUpperCase() : "Padrão"}</>;
  const blocoCor = (
    <>
      <AposAnimacao>
        <Suspense fallback={<div aria-hidden className="h-64 animate-pulse rounded-xl bg-surface-2/60" />}>
          <AparenciaPasta cor={cor || COR_INICIAL} icone={icone || "Folder"} onCor={setCor} onIcone={setIcone} />
        </Suspense>
      </AposAnimacao>
      {(cor || icone) && <button type="button" onClick={() => { setCor(""); setIcone(""); }} className="mt-3 min-h-9 rounded-lg px-2 text-sm text-text-secondary hover:bg-surface-2">Voltar ao padrão</button>}
    </>
  );

  const titulo = <h2 id={`${idBase}-titulo`} className="min-w-0 flex-1 truncate font-semibold text-text-primary">Editar pasta</h2>;
  const painel = (
    <div role="dialog" aria-modal={desktop ? undefined : true} aria-labelledby={`${idBase}-titulo`}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLElement).id === `${idBase}-nome`) { e.preventDefault(); salvar(); } }}
      className={desktop
        ? `flex max-h-[min(40rem,calc(100dvh-3rem))] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-nav ${saindo ? "ecos-modal-out" : "ecos-focus-in"}`
        : `absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface-1 shadow-nav ${saindo ? "ecos-folha-out" : "ecos-folha-in"}`}>
      {!desktop && <span aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />}
      <header className="flex shrink-0 items-center gap-2 px-4 py-3">
        {titulo}
        <button type="button" onClick={() => fechar()} aria-label="Fechar" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2"><X size={17} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/70">
        <div className="px-4 py-3">
          <Campo rotulo="Nome" htmlFor={`${idBase}-nome`}>
            <input id={`${idBase}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} className="ecos-input w-full !rounded-lg" />
          </Campo>
        </div>

        {lateral ? (
          <button type="button" aria-expanded={corAberta} aria-controls={`${idBase}-aba-cor`} onClick={alternarAba}
            className="flex min-h-12 w-full items-center gap-3 border-t border-border/70 px-4 text-left text-sm font-medium text-text-primary hover:bg-surface-2">
            <Palette size={16} className="shrink-0 text-steel-300" aria-hidden />
            <span className="flex-1">Cor e ícone</span>
            <span className="flex min-w-0 max-w-[55%] items-center gap-1.5 truncate text-xs font-normal text-text-muted">{resumoCor}</span>
            <ChevronRight size={16} className={`shrink-0 text-text-muted transition-transform duration-200 ${corAberta ? "rotate-180" : ""}`} aria-hidden />
          </button>
        ) : (
          <Secao id={`${idBase}-ap`} icone={Palette} titulo="Cor e ícone" aberta={abertas.has("aparencia")} onAlternar={() => alternar("aparencia")} resumo={resumoCor}>
            {blocoCor}
          </Secao>
        )}

        <Secao id={`${idBase}-tg`} icone={Tags} titulo="Tags padrão" aberta={abertas.has("tags")} onAlternar={() => alternar("tags")} resumo={tags.length ? `${tags.length} ${tags.length === 1 ? "tag" : "tags"}` : "Nenhuma"}>
          <EditorTagsPadrao valor={tags} onChange={setTags} label="Tags padrão da pasta" />
          <p className="mt-2 text-xs leading-relaxed text-text-muted">Notas e tarefas criadas aqui já nascem com elas (de acordo com Configurações &gt; Uso diário).</p>
        </Secao>

        {tipo === "tarefa" && (
          <Secao id={`${idBase}-tf`} icone={Clock3} titulo="Padrões das tarefas" aberta={abertas.has("tarefas")} onAlternar={() => alternar("tarefas")}
            resumo={prioridade || duracao ? [prioridade && PRIORIDADES.find((p) => p.valor === prioridade)?.rotulo, duracao ? `${duracao} min` : ""].filter(Boolean).join(" · ") : "Das preferências"}>
            <Campo rotulo="Prioridade" dica="Vale para tarefas novas criadas nesta pasta.">
              <SeletorEcos valor={prioridade} opcoes={PRIORIDADES} onChange={setPrioridade} ariaLabel="Prioridade padrão das tarefas da pasta" />
            </Campo>
            <Campo rotulo="Duração estimada">
              <SeletorEcos valor={String(duracao)} opcoes={DURACOES} onChange={(v) => setDuracao(Number(v))} ariaLabel="Duração padrão das tarefas da pasta" />
            </Campo>
          </Secao>
        )}

        <Secao id={`${idBase}-dt`} icone={TextCursorInput} titulo="Descrição e destaque" aberta={abertas.has("detalhes")} onAlternar={() => alternar("detalhes")}
          resumo={[fixada && "Fixada", descricao && "Com descrição"].filter(Boolean).join(" · ") || "Nenhum"}>
          <Campo rotulo="Descrição" htmlFor={`${idBase}-desc`} dica={`${descricao.length}/280`}>
            <textarea id={`${idBase}-desc`} value={descricao} onChange={(e) => setDescricao(e.target.value.slice(0, 280))} rows={3} placeholder="Para que serve esta pasta?" className="ecos-input w-full resize-y !rounded-lg" />
          </Campo>
          <div className="mt-3 flex items-center gap-3">
            <Pin size={16} className="shrink-0 text-steel-300" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">Fixar no topo</span><span className="block text-xs text-text-muted">Aparece antes das outras pastas.</span></span>
            <Toggle checked={fixada} onChange={setFixada} label="Fixar a pasta no topo" />
          </div>
        </Secao>
      </div>

      <footer className="shrink-0 border-t border-border bg-surface-1 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        {erro && <p role="alert" className="mb-2 text-sm text-error">{erro}</p>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={nomeInvalido} onClick={salvar} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-on-steel disabled:opacity-40"><Check size={16} />Salvar</button>
          <button type="button" onClick={() => fechar()} className="min-h-10 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-2">Cancelar</button>
        </div>
      </footer>
    </div>
  );

  if (!desktop) return <div className="fixed inset-0 z-[60]"><div aria-hidden onClick={() => fechar()} className={`absolute inset-0 bg-black/50 ${saindo ? "ecos-backdrop-out" : "ecos-backdrop-in"}`} />{painel}</div>;

  // Desktop: janela centralizada. Em tela larga, cor e ícone abrem numa aba flutuante ao lado (como a calculadora do Cofre e o
  // painel do modo Focus). O painel principal nunca sai do centro: a aba só aparece à direita dele.
  const larguraAba = 22; // rem
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden onClick={() => fechar()} className={`absolute inset-0 bg-black/45 backdrop-blur-[6px] ${saindo ? "ecos-backdrop-out" : "ecos-backdrop-in"}`} />
      <div className="relative w-[min(26rem,100%)]">
        {painel}
        {lateral && corAberta && (
          <aside id={`${idBase}-aba-cor`} aria-label="Cor e ícone da pasta" style={{ width: `${larguraAba}rem` }}
            className={`${abaSaindo || saindo ? "ecos-aba-out" : "ecos-aba-in"} absolute left-full top-0 ml-3 flex max-h-[min(40rem,calc(100dvh-3rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-nav`}>
            <header className="flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-3">
              <Palette size={16} className="shrink-0 text-steel-300" aria-hidden />
              <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">Cor e ícone</h3>
              <button type="button" onClick={fecharAba} aria-label="Fechar cor e ícone" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2"><X size={16} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{blocoCor}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
