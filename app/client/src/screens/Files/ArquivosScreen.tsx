import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as PointerReact } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronRight, ChevronsDownUp, FolderInput, FolderOpen, FolderPlus, LayoutGrid, List, MoreHorizontal, Paperclip, Pencil, RotateCw, Search, Trash2, Upload, X } from "lucide-react";
import { arquivos, pastas as pastasApi, type ArquivoExplorador, type PastaExplorador } from "@/lib/api";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { Dialog } from "@/components/common/Dialog";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { MenuExplorador, type ItemMenuExplorador } from "@/desktop/MenuExplorador";
import { MoverExplorador, type ItemParaMover } from "@/desktop/MoverExplorador";
import { RevisarMidias } from "@/components/files/RevisarMidias";
import { anexoComoArquivo, BadgeAnexos, rotaDoAnexo } from "@/components/files/Anexos";
import { extensaoDe, IconeArquivo, IconePasta, selo, useMarcasArquivo } from "@/lib/icones-arquivo";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useIsDesktop } from "@/lib/use-viewport";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useModoExplorador } from "@/lib/use-modo-explorador";
import { lerPreferenciasAplicativo } from "@/lib/preferencias-aplicativo";
import { mensagemDeErro } from "@/lib/erros";
import { avisar } from "@/lib/toast";
import { aoPressionarItem } from "@/lib/arraste-itens";

/** Tipo de dado do arrastar-e-soltar interno: a lista de caminhos lógicos sendo movidos. */
/** Mesmo limite do servidor por arquivo. */
const LIMITE_ENVIO = 120 * 1024 * 1024;
const CHAVE_VISTA = "ecos.arquivos.vista.v1";

type Vista = "lista" | "grade";
type ChaveOrdem = "nome" | "tipo" | "tamanho" | "modificado";
interface PreferenciaVista { vista: Vista; chave: ChaveOrdem; dir: 1 | -1 }

/** Como a pessoa quer ver a pasta (lista ou grade) e a ordem: fica neste aparelho. */
function lerVista(): PreferenciaVista {
  const padrao: PreferenciaVista = { vista: "lista", chave: "nome", dir: 1 };
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE_VISTA) ?? "null") as Partial<PreferenciaVista> | null;
    if (!s) return padrao;
    return {
      vista: s.vista === "grade" ? "grade" : "lista",
      chave: s.chave === "tipo" || s.chave === "tamanho" || s.chave === "modificado" ? s.chave : "nome",
      dir: s.dir === -1 ? -1 : 1,
    };
  } catch { return padrao; }
}

interface Linha {
  caminho: string;
  nome: string;
  pasta: boolean;
  arquivo?: ArquivoExplorador;
  info?: PastaExplorador;
}

const pai = (caminho: string) => (caminho.includes("/") ? caminho.slice(0, caminho.lastIndexOf("/")) : "");
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Soltar `itens` em `destino` não faz sentido: já estão lá, ou é uma pasta para dentro dela mesma. */
function destinoInvalido(itens: string[], destino: string) {
  return itens.every((i) => pai(i) === destino) || itens.some((i) => destino === i || destino.startsWith(`${i}/`));
}

/** Nota e tarefa aparecem pelo título; o resto, pelo nome do arquivo (o nome de verdade fica na dica). */
function nomeExibido(l: Linha) {
  return l.arquivo && (l.arquivo.tipo === "nota" || l.arquivo.tipo === "tarefa") && l.arquivo.titulo ? l.arquivo.titulo : l.nome;
}

function rotuloDe(linha: Linha) {
  if (linha.pasta) return "Pasta";
  const a = linha.arquivo!;
  if (a.tipo === "nota") return "Nota";
  if (a.tipo === "tarefa") return "Tarefa";
  return { markdown: "Markdown", pdf: "PDF", texto: "Texto", imagem: "Imagem", audio: "Áudio", video: "Vídeo", outro: "Arquivo" }[a.categoria];
}

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");

/** Nota/tarefa renomeiam pelo título (o arquivo segue o padrão); o resto, pelo nome do arquivo. */
const pelo_titulo = (linha: Linha) => !!linha.arquivo?.id && (linha.arquivo.tipo === "nota" || linha.arquivo.tipo === "tarefa");

interface NomeDialogProps {
  titulo: string;
  rotulo: string;
  inicial: string;
  botao: string;
  ocupadoTexto: string;
  dica?: string;
  /** Seleciona só até aqui ao abrir (ex.: o nome sem a extensão). */
  selecionarAte?: number;
  onFechar: () => void;
  /** Devolve a mensagem de erro, ou `null` se deu certo. */
  onSalvar: (valor: string) => Promise<string | null>;
}

function NomeDialog({ titulo, rotulo, inicial, botao, ocupadoTexto, dica, selecionarAte, onFechar, onSalvar }: NomeDialogProps) {
  const id = useId();
  const [valor, setValor] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, selecionarAte ?? inicial.length);
  }, [inicial, selecionarAte]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valor.trim() || (inicial && valor.trim() === inicial)) { onFechar(); return; }
    setOcupado(true);
    setErro(await onSalvar(valor.trim()));
    setOcupado(false);
  }

  return (
    <Dialog rotuloId={`${id}-t`} onFechar={() => !ocupado && onFechar()}>
      <form onSubmit={enviar} className="w-full max-w-md rounded-2xl border border-border bg-surface-1 p-5">
        <h2 id={`${id}-t`} className="mb-3 text-lg font-semibold text-text-primary">{titulo}</h2>
        <label htmlFor={`${id}-c`} className="mb-1 block text-xs font-medium text-text-muted">{rotulo}</label>
        <input id={`${id}-c`} ref={campo} value={valor} onChange={(e) => { setValor(e.target.value); setErro(null); }} disabled={ocupado} className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-text-primary outline-none focus:border-steel-400" />
        {dica && <p className="mt-2 text-xs text-text-muted">{dica}</p>}
        {erro && <p role="alert" className="mt-2 text-sm text-error">{erro}</p>}
        <div className="mt-5 flex gap-3">
          <button type="button" disabled={ocupado} onClick={onFechar} className="min-h-11 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
          <button type="submit" disabled={ocupado || !valor.trim()} className="min-h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{ocupado ? ocupadoTexto : botao}</button>
        </div>
      </form>
    </Dialog>
  );
}

function RenomearDialog({ linha, onFechar, onSalvar }: { linha: Linha; onFechar: () => void; onSalvar: (novo: string) => Promise<string | null> }) {
  const titulo = pelo_titulo(linha);
  const inicial = titulo ? linha.arquivo!.titulo ?? linha.nome : linha.nome;
  // Seleciona o nome sem a extensão, como no explorador do sistema.
  const ponto = !titulo && !linha.pasta ? inicial.lastIndexOf(".") : -1;
  const oQue = linha.pasta ? "pasta" : titulo ? (linha.arquivo!.tipo === "nota" ? "nota" : "tarefa") : "arquivo";
  return (
    <NomeDialog
      titulo={`Renomear ${oQue}`}
      rotulo={titulo ? "Título" : "Nome"}
      inicial={inicial}
      botao="Renomear"
      ocupadoTexto="Renomeando…"
      dica={titulo ? "O arquivo passa a se chamar pelo título, e os links para ela são atualizados." : undefined}
      selecionarAte={ponto > 0 ? ponto : undefined}
      onFechar={onFechar}
      onSalvar={onSalvar}
    />
  );
}

const ORDENS: { valor: ChaveOrdem; rotulo: string }[] = [
  { valor: "nome", rotulo: "Nome" },
  { valor: "tipo", rotulo: "Tipo" },
  { valor: "tamanho", rotulo: "Tamanho" },
  { valor: "modificado", rotulo: "Modificado" },
];

/**
 * Explorador de arquivos: a árvore única do espaço (notas, tarefas e qualquer outro arquivo nas mesmas pastas).
 * Desktop: barra de caminho e ferramentas no topo, conteúdo em lista ou grade, seleção com Ctrl/Shift e mover
 * arrastando; com o Modo explorador ligado a árvore fica no menu lateral e esta tela mostra só a pasta aberta
 * (`?pasta=` na rota). Mobile: navega e abre com um toque.
 */
export function ArquivosScreen() {
  const desktop = useIsDesktop();
  const modoExplorador = useModoExplorador();
  /** Com o Modo explorador a árvore mora no menu lateral: aqui não repete. */
  const comArvore = desktop && !modoExplorador;
  const abrirDocumento = useAbrirDocumento();
  const { versao, notificar } = useRefreshBus();
  const espaco = useEspacoFiltro() ?? "pessoal";
  const { icones: iconesExtensao, marca } = useMarcasArquivo();
  const [params, setParams] = useSearchParams();
  const pastaAtual = params.get("pasta") ?? "";
  const setPastaAtual = useCallback((p: string) => setParams(p ? { pasta: p } : {}), [setParams]);
  const [conteudo, setConteudo] = useState<{ pastas: PastaExplorador[]; arquivos: ArquivoExplorador[] } | null>(null);
  const [arvore, setArvore] = useState<string[]>([]);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [revisandoMidias, setRevisandoMidias] = useState(false);
  const [anexosAbertos, setAnexosAbertos] = useState<Set<string>>(new Set());
  const alternarAnexos = (c: string) => setAnexosAbertos((a) => { const n = new Set(a); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const [ancora, setAncora] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<Linha | null>(null);
  const [excluindo, setExcluindo] = useState<string[] | null>(null);
  const [apagando, setApagando] = useState(false);
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [movendo, setMovendo] = useState<string[] | null>(null);
  const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);
  const [menuCtx, setMenuCtx] = useState<{ x: number; y: number; linha: Linha } | null>(null);
  const seletorArquivos = useRef<HTMLInputElement>(null);
  const cartao = useRef<HTMLDivElement>(null);
  const [alturaLista, setAlturaLista] = useState<number | null>(null);
  // A lista ocupa exatamente o que sobra da tela (a página não rola; rola só a lista).
  useEffect(() => {
    const medir = () => { const el = cartao.current; if (el) setAlturaLista(Math.max(240, window.innerHeight - el.getBoundingClientRect().top - 8)); };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [desktop, conteudo, erro]);
  const [retangulo, setRetangulo] = useState<{ l: number; t: number; w: number; h: number } | null>(null);
  const ignorarClique = useRef(false);
  const [resumo, setResumo] = useState<{ pastas: number; arquivos: number; notas: number; tarefas: number; midias: number; bytes: number } | null>(null);
  const [menuVazio, setMenuVazio] = useState<{ x: number; y: number } | null>(null);
  const [editandoCaminho, setEditandoCaminho] = useState(false);
  // Config por dispositivo (Aparência › Pastas): sugestões na barra de endereço. Lida ao abrir a barra, sempre em dia.
  const [comSugestoes, setComSugestoes] = useState(() => lerPreferenciasAplicativo().arquivosSugestoesCaminho);
  useEffect(() => {
    const atualizar = () => setComSugestoes(lerPreferenciasAplicativo().arquivosSugestoesCaminho);
    window.addEventListener("ecos:preferencias-aplicativo", atualizar);
    return () => window.removeEventListener("ecos:preferencias-aplicativo", atualizar);
  }, []);
  const [textoCaminho, setTextoCaminho] = useState("");
  const [todasPastas, setTodasPastas] = useState<string[]>([]);
  const [sugIdx, setSugIdx] = useState(-1);
  const [erroCaminho, setErroCaminho] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, { pastas: PastaExplorador[]; arquivos: ArquivoExplorador[] }>>({});
  const carregandoArvore = useRef(new Set<string>());
  const [filtro, setFiltro] = useState("");
  const [filtroPasta, setFiltroPasta] = useState("");
  const [vista, setVista] = useState<PreferenciaVista>(lerVista);
  const alterarVista = (patch: Partial<PreferenciaVista>) => setVista((atual) => {
    const proxima = { ...atual, ...patch };
    try { localStorage.setItem(CHAVE_VISTA, JSON.stringify(proxima)); } catch { /* só conveniência */ }
    return proxima;
  });

  // Trocar de espaço volta à raiz, mas abrir a tela já numa pasta (`?pasta=`) não é uma troca.
  const espacoAnterior = useRef(espaco);
  useEffect(() => {
    if (espacoAnterior.current === espaco) return;
    espacoAnterior.current = espaco;
    setPastaAtual("");
  }, [espaco, setPastaAtual]);

  // Outra pasta, outra seleção e outro filtro.
  useEffect(() => { setSelecao(new Set()); setAncora(null); setFiltroPasta(""); setMenuCtx(null); }, [pastaAtual, espaco]);

  useEffect(() => {
    let vivo = true;
    setErro(null);
    arquivos.listar({ espaco, pasta: pastaAtual })
      .then((r) => {
        if (!vivo) return;
        setConteudo(r);
        // Recarregar a mesma pasta (depois de renomear, mover...) mantém o que ainda existe selecionado.
        const existentes = new Set([...r.pastas, ...r.arquivos].map((i) => i.caminho));
        setSelecao((atual) => new Set([...atual].filter((c) => existentes.has(c))));
      })
      .catch((e) => vivo && setErro(mensagemDeErro(e, "Não foi possível abrir a pasta.")));
    return () => { vivo = false; };
  }, [espaco, pastaAtual, versao]);

  // Totais da pasta com tudo o que há dentro (subpastas incluídas), para o rodapé.
  useEffect(() => {
    if (!desktop) return;
    let vivo = true;
    arquivos.resumo({ espaco, pasta: pastaAtual }).then((r) => vivo && setResumo(r)).catch(() => vivo && setResumo(null));
    return () => { vivo = false; };
  }, [desktop, espaco, pastaAtual, versao]);

  useEffect(() => {
    if (!comArvore) return;
    let vivo = true;
    pastasApi.listar({ recursivo: true, espaco }).then((r) => vivo && setArvore(r.subpastas.map((p) => p.caminho).sort((a, b) => a.localeCompare(b, "pt-BR")))).catch(() => undefined);
    return () => { vivo = false; };
  }, [espaco, versao, comArvore]);

  // Conteúdo de cada pasta já vista, para a árvore lateral mostrar arquivos além de pastas. Carrega sob demanda: a
  // raiz, as pastas expandidas e, com o filtro preenchido, todas (para a busca alcançar a árvore inteira).
  useEffect(() => { setCache({}); }, [espaco, versao]);
  useEffect(() => {
    if (!comArvore) return;
    const querer = new Set(["", ...abertas, ...(filtro.trim() ? arvore : [])]);
    const faltando = [...querer].filter((p) => !(p in cache) && !carregandoArvore.current.has(p));
    if (!faltando.length) return;
    faltando.forEach((p) => carregandoArvore.current.add(p));
    Promise.all(faltando.map((p) => arquivos.listar({ espaco, pasta: p }).then((r) => [p, r] as const).catch(() => [p, { pastas: [] as PastaExplorador[], arquivos: [] as ArquivoExplorador[] }] as const)))
      .then((rs) => {
        rs.forEach(([p]) => carregandoArvore.current.delete(p));
        setCache((c) => ({ ...c, ...Object.fromEntries(rs.map(([p, r]) => [p, { pastas: r.pastas, arquivos: r.arquivos }])) }));
      });
  }, [abertas, cache, espaco, filtro, arvore, comArvore]);

  // A pasta aberta fica visível na árvore: os ancestrais dela se expandem.
  useEffect(() => {
    if (!pastaAtual) return;
    setAbertas((atual) => {
      const proximo = new Set(atual);
      let p = pastaAtual;
      while (p) { proximo.add(p); p = pai(p); }
      return proximo;
    });
  }, [pastaAtual]);

  const linhas: Linha[] = useMemo(() => conteudo ? [
    ...conteudo.pastas.map((p) => ({ caminho: p.caminho, nome: p.nome, pasta: true, info: p })),
    ...conteudo.arquivos.map((a) => ({ caminho: a.caminho, nome: a.nome, pasta: false, arquivo: a })),
  ] : [], [conteudo]);

  /** O que a tela mostra: com o filtro da pasta, e na ordem escolhida (pastas sempre antes dos arquivos). */
  const visiveis = useMemo(() => {
    const termo = semAcento(filtroPasta.trim());
    const base = termo ? linhas.filter((l) => semAcento(`${nomeExibido(l)} ${l.nome}`).includes(termo)) : linhas;
    const por = (a: Linha, b: Linha): number => {
      const nomes = nomeExibido(a).localeCompare(nomeExibido(b), "pt-BR", { numeric: true, sensitivity: "base" });
      if (a.pasta || vista.chave === "nome") return nomes;
      switch (vista.chave) {
        case "tipo": return rotuloDe(a).localeCompare(rotuloDe(b), "pt-BR") || nomes;
        case "tamanho": return (a.arquivo?.tamanho_bytes ?? 0) - (b.arquivo?.tamanho_bytes ?? 0) || nomes;
        default: return (a.arquivo?.modificado_em ?? "").localeCompare(b.arquivo?.modificado_em ?? "") || nomes;
      }
    };
    const ordenar = (lista: Linha[]) => [...lista].sort((a, b) => por(a, b) * vista.dir);
    return [...ordenar(base.filter((l) => l.pasta)), ...ordenar(base.filter((l) => !l.pasta))];
  }, [linhas, filtroPasta, vista.chave, vista.dir]);

  const abrir = useCallback((linha: Linha, evento?: MouseEvent) => {
    if (linha.pasta) { setPastaAtual(linha.caminho); return; }
    const a = linha.arquivo!;
    const destino = a.tipo === "nota" && a.id ? `/notas/nota/${a.id}`
      : a.tipo === "tarefa" && a.id ? `/tarefa/${a.id}`
      : `/media/ver?a=${encodeURIComponent(a.caminho)}&e=${encodeURIComponent(espaco)}`;
    abrirDocumento(destino, evento);
  }, [abrirDocumento, espaco, setPastaAtual]);

  function clicar(linha: Linha, evento: MouseEvent) {
    if (!desktop) { abrir(linha, evento); return; }
    if (evento.shiftKey && ancora) {
      const ordem = visiveis.map((l) => l.caminho);
      const [i, j] = [ordem.indexOf(ancora), ordem.indexOf(linha.caminho)].sort((x, y) => x - y);
      if (i >= 0) { setSelecao(new Set(ordem.slice(i, j + 1))); return; }
    }
    if (evento.ctrlKey || evento.metaKey) {
      setSelecao((atual) => { const p = new Set(atual); if (p.has(linha.caminho)) p.delete(linha.caminho); else p.add(linha.caminho); return p; });
    } else {
      setSelecao(new Set([linha.caminho]));
    }
    setAncora(linha.caminho);
  }

  async function mover(itens: string[], destino: string) {
    if (destinoInvalido(itens, destino)) return;
    // Some da lista na hora (otimista); se o servidor discordar, o recarregamento corrige.
    setConteudo((c) => (c ? { pastas: c.pastas.filter((p) => !itens.includes(p.caminho)), arquivos: c.arquivos.filter((a) => !itens.includes(a.caminho)) } : c));
    setSelecao(new Set());
    try {
      const r = await arquivos.mover({ espaco, itens, destino });
      r.movidos.forEach((m) => acompanhar(m.de, m.para));
      if (r.movidos.length) avisar(`${r.movidos.length} ${r.movidos.length === 1 ? "item movido" : "itens movidos"} para ${destino || "a raiz"}.`, "sucesso");
      if (r.falhas.length) avisar(`Não foi possível mover: ${r.falhas.map((f) => `${f.caminho.split("/").pop()} (${f.motivo})`).join("; ")}.`, "erro");
      notificar();
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível mover."), "erro"); notificar(); }
  }

  /** A pasta aberta (ou uma de cima dela) foi renomeada, movida (`para`) ou excluída (`null`): a tela segue junto. */
  function acompanhar(de: string, para: string | null) {
    if (pastaAtual !== de && !pastaAtual.startsWith(`${de}/`)) return;
    setPastaAtual(para === null ? pai(de) : para + pastaAtual.slice(de.length));
  }

  async function renomear(linha: Linha, novo: string): Promise<string | null> {
    try {
      const r = await arquivos.renomear({ espaco, caminho: linha.caminho, novo_nome: novo });
      setRenomeando(null);
      if (linha.pasta) acompanhar(linha.caminho, r.caminho);
      setSelecao(new Set([r.caminho]));
      avisar(`Renomeado para ${r.caminho.split("/").pop()}.`, "sucesso");
      notificar();
      return null;
    } catch (e) { return mensagemDeErro(e, "Não foi possível renomear."); }
  }

  async function excluir(itens: string[]) {
    setApagando(true);
    try {
      const r = await arquivos.excluir({ espaco, itens });
      if (r.excluidos.length) avisar(`${r.excluidos.length === 1 ? `${r.excluidos[0].split("/").pop()} foi` : `${r.excluidos.length} itens foram`} para a Lixeira.`, "sucesso");
      r.excluidos.forEach((i) => acompanhar(i, null));
      if (r.falhas.length) avisar(`Não foi possível excluir: ${r.falhas.map((f) => f.caminho.split("/").pop()).join(", ")}.`, "erro");
      notificar();
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível excluir."), "erro"); }
    finally { setApagando(false); setExcluindo(null); }
  }

  async function criarPasta(nome: string): Promise<string | null> {
    if (conteudo?.pastas.some((p) => p.nome.toLowerCase() === nome.toLowerCase())) return `Já existe a pasta "${nome}" aqui.`;
    try {
      const r = await pastasApi.criar({ nome, pasta_pai: pastaAtual || undefined, espaco });
      setCriandoPasta(false);
      setSelecao(new Set([r.caminho]));
      avisar(`Pasta ${nome} criada.`, "sucesso");
      notificar();
      return null;
    } catch (e) { return mensagemDeErro(e, "Não foi possível criar a pasta."); }
  }

  /** Envia um por vez (cada um até 120 MB), para a pasta `destino`. */
  async function enviarArquivos(lista: File[], destino: string) {
    if (!lista.length || enviando) return;
    const grandes = lista.filter((f) => f.size > LIMITE_ENVIO);
    const validos = lista.filter((f) => f.size <= LIMITE_ENVIO);
    if (grandes.length) avisar(`Maior que 120 MB, não enviado: ${grandes.map((f) => f.name).join(", ")}.`, "erro");
    if (!validos.length) return;
    const falhas: string[] = [];
    let feitos = 0;
    setEnviando({ feitos, total: validos.length });
    for (const arquivo of validos) {
      try { await arquivos.enviar(espaco, destino, arquivo); } catch { falhas.push(arquivo.name); }
      feitos += 1;
      setEnviando({ feitos, total: validos.length });
    }
    setEnviando(null);
    const ok = validos.length - falhas.length;
    if (ok) avisar(`${ok === 1 ? "1 arquivo enviado" : `${ok} arquivos enviados`} para ${destino || "a raiz"}.`, "sucesso");
    if (falhas.length) avisar(`Não foi possível enviar: ${falhas.join(", ")}.`, "erro");
    notificar();
  }

  /** F2 renomeia o selecionado; Delete manda a seleção para a Lixeira; Backspace sobe uma pasta; Ctrl+A marca tudo. */
  function teclaNaLista(e: KeyboardEvent) {
    if (!desktop || renomeando || excluindo || (e.target as HTMLElement).tagName === "INPUT") return;
    if (e.key === "F2" && selecao.size === 1) {
      const linha = linhas.find((l) => selecao.has(l.caminho));
      if (linha) { e.preventDefault(); setRenomeando(linha); }
    } else if (e.key === "Delete" && selecao.size) {
      e.preventDefault();
      setExcluindo([...selecao]);
    } else if (e.key === "Backspace" && pastaAtual) {
      e.preventDefault();
      setPastaAtual(pai(pastaAtual));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelecao(new Set(visiveis.map((l) => l.caminho)));
    } else if (e.key === "Escape" && selecao.size) {
      setSelecao(new Set());
    }
  }

  /** Seleção por retângulo: arrastar no espaço vazio marca tudo o que o retângulo toca (Ctrl/Shift somam à seleção atual). */
  function iniciarRetangulo(e: MouseEvent<HTMLDivElement>) {
    const caixa = e.currentTarget;
    if (!desktop || e.button !== 0 || (e.target as HTMLElement).closest("[role=row],button,a,input") || e.nativeEvent.offsetX >= caixa.clientWidth) return;
    e.preventDefault();
    caixa.focus();
    const [x0, y0] = [e.clientX, e.clientY];
    // O ponto de partida vale no conteúdo (não na tela): a lista pode rolar durante o arrasto.
    const inicioConteudo = { x: x0 - caixa.getBoundingClientRect().left + caixa.scrollLeft, y: y0 - caixa.getBoundingClientRect().top + caixa.scrollTop };
    const base = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selecao) : new Set<string>();
    let moveu = false;
    let ponteiro = { clientX: x0, clientY: y0 };
    let quadro = 0;
    const atualizar = () => {
      const a = caixa.getBoundingClientRect();
      const ix = inicioConteudo.x + a.left - caixa.scrollLeft;
      const iy = inicioConteudo.y + a.top - caixa.scrollTop;
      const cx = (v: number) => Math.min(Math.max(v, a.left), a.right);
      const cy = (v: number) => Math.min(Math.max(v, a.top), a.bottom);
      const [l, r] = [Math.min(cx(ix), cx(ponteiro.clientX)), Math.max(cx(ix), cx(ponteiro.clientX))];
      const [t, b] = [Math.min(cy(iy), cy(ponteiro.clientY)), Math.max(cy(iy), cy(ponteiro.clientY))];
      setRetangulo({ l, t, w: r - l, h: b - t });
      const novos = new Set(base);
      caixa.querySelectorAll<HTMLElement>("[role=row][data-caminho]").forEach((el) => {
        const q = el.getBoundingClientRect();
        if (q.left < r && q.right > l && q.top < b && q.bottom > t) novos.add(el.dataset.caminho!);
      });
      setSelecao(novos);
    };
    // Perto da borda de cima ou de baixo (ou fora dela), a lista rola sozinha: mais rápido quanto mais longe.
    const rolar = () => {
      if (moveu) {
        const a = caixa.getBoundingClientRect();
        const ZONA = 36;
        const dy = ponteiro.clientY < a.top + ZONA ? -(a.top + ZONA - ponteiro.clientY) : ponteiro.clientY > a.bottom - ZONA ? ponteiro.clientY - (a.bottom - ZONA) : 0;
        if (dy) { caixa.scrollTop += Math.max(-28, Math.min(28, dy / 2)); atualizar(); }
      }
      quadro = requestAnimationFrame(rolar);
    };
    quadro = requestAnimationFrame(rolar);
    const aoMover = (ev: { clientX: number; clientY: number }) => {
      ponteiro = ev;
      if (!moveu && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moveu = true;
      atualizar();
    };
    const aoSoltar = () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("mousemove", aoMover);
      window.removeEventListener("mouseup", aoSoltar);
      setRetangulo(null);
      if (moveu) { ignorarClique.current = true; window.setTimeout(() => { ignorarClique.current = false; }, 0); }
      else if (!base.size) setSelecao(new Set());
    };
    window.addEventListener("mousemove", aoMover);
    window.addEventListener("mouseup", aoSoltar);
  }

  /** Itens de uma ação: com a linha dentro da seleção, vale a seleção inteira (como ao arrastar). */
  const alvosDe = (linha: Linha) => (selecao.has(linha.caminho) && selecao.size > 1 ? [...selecao] : [linha.caminho]);

  function acoes(linha: Linha) {
    return (
      <span data-sem-arraste="" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="flex justify-end">
        <MenuSuspenso
          valor=""
          ariaLabel={`Ações de ${nomeExibido(linha)}`}
          alinhar="dir"
          fixo
          opcoes={[{ valor: "renomear", rotulo: "Renomear", icone: Pencil }, { valor: "mover", rotulo: "Mover para…", icone: FolderInput }, { valor: "excluir", rotulo: "Excluir", icone: Trash2 }]}
          onChange={(v) => {
            if (v === "renomear") setRenomeando(linha);
            else if (v === "mover") setMovendo(alvosDe(linha));
            else setExcluindo(alvosDe(linha));
          }}
          classeGatilho="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"
          gatilho={() => <MoreHorizontal size={16} />}
        />
      </span>
    );
  }

  /** Botão direito numa linha (ou card): o mesmo menu da sidebar. */
  function abrirMenuCtx(linha: Linha, e: MouseEvent, selecionar = true) {
    if (!desktop) return;
    e.preventDefault();
    if (selecionar && !selecao.has(linha.caminho)) { setSelecao(new Set([linha.caminho])); setAncora(linha.caminho); }
    setMenuCtx({ x: e.clientX, y: e.clientY, linha });
  }

  function itensDoMenuCtx(linha: Linha): ItemMenuExplorador[] {
    const lote = alvosDe(linha);
    if (lote.length > 1) {
      return [
        { rotulo: `Mover ${lote.length} itens para…`, icone: FolderInput, acao: () => setMovendo(lote) },
        { rotulo: `Excluir ${lote.length} itens`, icone: Trash2, perigo: true, acao: () => setExcluindo(lote) },
      ];
    }
    return [
      { rotulo: linha.pasta ? "Abrir pasta" : "Abrir", icone: linha.pasta ? FolderOpen : Pencil, acao: () => abrir(linha) },
      { rotulo: "Renomear", icone: Pencil, acao: () => setRenomeando(linha) },
      { rotulo: "Mover para…", icone: FolderInput, acao: () => setMovendo([linha.caminho]) },
      { rotulo: "Excluir", icone: Trash2, perigo: true, acao: () => setExcluindo([linha.caminho]) },
    ];
  }

  /** Arrasta com o ponteiro (mouse ou toque): um item marcado leva todos os marcados; um fora da seleção leva só ele. */
  function arrastar(evento: PointerReact, linha: Linha) {
    if (!desktop) return;
    aoPressionarItem(evento, {
      preparar: () => {
        const itens = selecao.has(linha.caminho) ? [...selecao] : [linha.caminho];
        if (!selecao.has(linha.caminho)) setSelecao(new Set([linha.caminho]));
        return { itens, rotulo: itens.length > 1 ? `${itens.length} itens` : nomeExibido(linha), tipo: linha.pasta ? "pasta" : linha.arquivo?.tipo ?? "arquivo" };
      },
      aoPairar: setAlvo,
      aoSoltar: (destino, itens) => { void mover(itens, destino); },
      aoTerminar: () => setAlvo(null),
    });
  }

  /** Propriedades de um lugar onde dá para soltar itens (pasta da lista, nó da árvore, trecho do caminho). */
  function soltarEm(destino: string) {
    if (!desktop) return {};
    return {
      // Arrastar itens daqui usa o ponteiro (`data-soltar`); o arrastar nativo ficou só para arquivos vindos do computador.
      "data-soltar": destino,
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        // A pasta mais de dentro decide (a lista inteira também aceita, como a pasta aberta).
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setAlvo(destino);
      },
      onDragLeave: () => setAlvo((atual) => (atual === destino ? null : atual)),
      onDrop: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setAlvo(null);
        if (e.dataTransfer.files?.length) void enviarArquivos([...e.dataTransfer.files], destino);
      },
    };
  }

  const realce = (destino: string) => (alvo === destino ? "bg-steel-700/30 ring-1 ring-steel-400" : "");
  const trechos = pastaAtual ? pastaAtual.split("/") : [];

  const alternar = (caminho: string) => setAbertas((a) => { const p = new Set(a); if (p.has(caminho)) p.delete(caminho); else p.add(caminho); return p; });

  /** Nó de pasta da árvore lateral: a seta expande, o nome abre a pasta à direita. */
  function noPasta(p: PastaExplorador, nivel: number) {
    const aberta = abertas.has(p.caminho);
    const conteudoDela = cache[p.caminho];
    const vazia = conteudoDela && !conteudoDela.pastas.length && !conteudoDela.arquivos.length;
    return (
      <li key={p.caminho} role="treeitem" aria-expanded={aberta} aria-selected={pastaAtual === p.caminho}>
        <div
          onPointerDown={(e) => arrastar(e, { caminho: p.caminho, nome: p.nome, pasta: true })}
          className={`group flex h-7 items-center rounded-md pr-1.5 text-[13px] ${pastaAtual === p.caminho ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"} ${realce(p.caminho)}`}
          style={{ paddingLeft: 2 + nivel * 12 }}
          {...soltarEm(p.caminho)}
        >
          <button type="button" tabIndex={-1} aria-label={aberta ? `Recolher ${p.nome}` : `Expandir ${p.nome}`} onClick={() => alternar(p.caminho)} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted ${vazia ? "invisible" : ""}`}>
            {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          <button type="button" onClick={() => { setPastaAtual(p.caminho); if (!aberta) alternar(p.caminho); }} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <IconePasta pasta={p} aberta={aberta} size={14} />
            <span className="truncate">{p.nome}</span>
          </button>
        </div>
        {aberta && <ul role="group">{filhosNaArvore(p.caminho, nivel + 1)}</ul>}
      </li>
    );
  }

  /** Nó de arquivo: nota e tarefa aparecem pelo título; um clique seleciona na lista, dois abrem. */
  function noArquivo(a: ArquivoExplorador, nivel: number) {
    const linha: Linha = { caminho: a.caminho, nome: a.nome, pasta: false, arquivo: a };
    const selecionado = selecao.has(a.caminho) && pai(a.caminho) === pastaAtual;
    return (
      <li key={a.caminho} role="treeitem" aria-selected={selecionado}>
        <button
          type="button"
          onPointerDown={(e) => arrastar(e, linha)}
          onClick={() => { setPastaAtual(pai(a.caminho)); setSelecao(new Set([a.caminho])); setAncora(a.caminho); }}
          onDoubleClick={(e) => abrir(linha, e)}
          title={a.nome}
          className={`flex h-7 w-full items-center gap-1.5 rounded-md pr-1.5 text-left text-[13px] ${selecionado ? "bg-steel-700/25 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}
          style={{ paddingLeft: 2 + nivel * 12 + 20 }}
        >
          <IconeArquivo a={a} personalizados={iconesExtensao} size={14} className={a.fora_do_padrao ? "text-error" : a.tipo === "tarefa" ? "text-cyan" : a.tipo === "nota" ? "text-steel-300" : "text-text-muted"} />
          <span className={`truncate ${a.fora_do_padrao ? "text-error" : ""}`}>{a.titulo ?? a.nome}</span>
        </button>
      </li>
    );
  }

  function filhosNaArvore(caminho: string, nivel: number) {
    const c = cache[caminho];
    if (!c) return <li className="h-7 text-[12px] text-text-muted" style={{ paddingLeft: 2 + nivel * 12 + 20 }}>Carregando…</li>;
    if (!c.pastas.length && !c.arquivos.length) return <li className="h-7 text-[12px] italic text-text-muted" style={{ paddingLeft: 2 + nivel * 12 + 20 }}>vazia</li>;
    return <>{c.pastas.map((p) => noPasta(p, nivel))}{c.arquivos.map((a) => noArquivo(a, nivel))}</>;
  }

  // Filtro da árvore: procura no que já foi carregado (pastas abertas), sem acento e sem caixa.
  const achados = useMemo(() => {
    const termo = semAcento(filtro.trim());
    if (!termo) return null;
    const vistos = new Map<string, ArquivoExplorador>();
    for (const c of Object.values(cache)) for (const a of c.arquivos) if (semAcento(`${a.titulo ?? ""} ${a.nome}`).includes(termo)) vistos.set(a.caminho, a);
    return [...vistos.values()].sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  }, [filtro, cache]);

  const quantasPastas = visiveis.filter((l) => l.pasta).length;
  const quantosArquivos = visiveis.length - quantasPastas;
  const soArquivos = visiveis.filter((l) => l.arquivo);
  const quantasNotas = soArquivos.filter((l) => l.arquivo!.tipo === "nota").length;
  const quantasTarefas = soArquivos.filter((l) => l.arquivo!.tipo === "tarefa").length;
  const quantasMidias = soArquivos.filter((l) => !l.arquivo!.tipo && ["imagem", "audio", "video"].includes(l.arquivo!.categoria)).length;
  // Nota, tarefa e mídia contam à parte: "arquivos" são os demais (PDF, planilhas, texto…), sem somar duas vezes.
  const outrosArquivos = quantosArquivos - quantasNotas - quantasTarefas - quantasMidias;
  const espacoUsado = soArquivos.reduce((t, l) => t + l.arquivo!.tamanho_bytes, 0);
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  const tamanhoSelecionado = visiveis.filter((l) => selecao.has(l.caminho)).reduce((t, l) => t + (l.arquivo?.tamanho_bytes ?? 0), 0);

  /** Itens da janela de mover, com tipo e id (só nota e tarefa trocam de espaço). */
  const detalhesParaMover = (caminhos: string[]): ItemParaMover[] => caminhos.map((caminho) => {
    const l = linhas.find((x) => x.caminho === caminho);
    if (!l) return { caminho, rotulo: caminho.split("/").pop() ?? caminho, tipo: pastaAtual === caminho || pastaAtual.startsWith(`${caminho}/`) ? "pasta" as const : "arquivo" as const };
    return { caminho, rotulo: nomeExibido(l), tipo: l.pasta ? "pasta" as const : l.arquivo?.tipo ?? "arquivo" as const, id: l.arquivo?.id };
  });

  const corDoIcone = (l: Linha) => l.arquivo?.fora_do_padrao ? "text-error" : l.arquivo?.tipo === "tarefa" ? "text-cyan" : l.arquivo?.tipo === "nota" ? "text-steel-300" : "text-text-secondary";
  const concluida = (l: Linha) => l.arquivo?.tipo === "tarefa" && l.arquivo.status === "concluida";
  const dicaDe = (l: Linha) => l.arquivo?.fora_do_padrao ? "Nome de arquivo fora do padrão: corrija em Configurações › Problemas de arquivos" : l.arquivo && nomeExibido(l) !== l.nome ? l.nome : undefined;

  function iconeDaLinha(l: Linha, tamanhoIcone: number) {
    return l.pasta
      ? <IconePasta pasta={l.info!} size={tamanhoIcone} className={l.info?.cor ? "" : "text-steel-300"} />
      : <IconeArquivo a={l.arquivo!} personalizados={iconesExtensao} size={tamanhoIcone} className={corDoIcone(l)} />;
  }

  function Seta({ chave }: { chave: ChaveOrdem }) {
    if (vista.chave !== chave) return null;
    return vista.dir === 1 ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />;
  }
  function ordenarPor(chave: ChaveOrdem) {
    alterarVista(vista.chave === chave ? { dir: vista.dir === 1 ? -1 : 1 } : { chave, dir: 1 });
  }
  const cabecalho = (chave: ChaveOrdem, texto: string, classe = "") => (
    <button type="button" role="columnheader" onClick={() => ordenarPor(chave)} aria-sort={vista.chave === chave ? (vista.dir === 1 ? "ascending" : "descending") : "none"}
      className={`flex items-center gap-1 rounded text-left text-xs font-medium hover:text-text-primary ${vista.chave === chave ? "text-text-primary" : "text-text-muted"} ${classe}`}>{texto}<Seta chave={chave} /></button>
  );

  const linhaDaPasta = (caminho: string): Linha => { const nome = caminho.split("/").pop() ?? caminho; return { caminho, nome, pasta: true, info: { nome, caminho } }; };

  const normalizarCaminho = (t: string) => {
    const partes = t.replace(/\\/g, "/").split("/").map((x) => x.trim()).filter(Boolean);
    if (partes[0] && semAcento(partes[0]) === "raiz") partes.shift();
    return partes.join("/");
  };
  const sugestoes = useMemo(() => {
    if (!editandoCaminho || !comSugestoes) return [];
    const termo = semAcento(normalizarCaminho(textoCaminho));
    const base = termo ? todasPastas.filter((c) => semAcento(c).includes(termo)) : todasPastas;
    return [...base].sort((a, b) => Number(semAcento(b).startsWith(termo)) - Number(semAcento(a).startsWith(termo)) || a.length - b.length).slice(0, 8);
  }, [editandoCaminho, comSugestoes, textoCaminho, todasPastas]);

  function iniciarEdicao() {
    setTextoCaminho(pastaAtual);
    setSugIdx(-1);
    setErroCaminho(null);
    setEditandoCaminho(true);
    pastasApi.listar({ recursivo: true, espaco }).then((r) => setTodasPastas(r.subpastas.map((p) => p.caminho).sort((a, b) => a.localeCompare(b, "pt-BR")))).catch(() => undefined);
  }
  function irPara(destino: string) {
    setEditandoCaminho(false);
    if (destino !== pastaAtual) setPastaAtual(destino);
  }
  function confirmarCaminho() {
    if (sugIdx >= 0 && sugestoes[sugIdx]) { irPara(sugestoes[sugIdx]); return; }
    const alvoTexto = normalizarCaminho(textoCaminho);
    if (!alvoTexto) { irPara(""); return; }
    const achada = todasPastas.find((c) => semAcento(c) === semAcento(alvoTexto));
    if (achada) irPara(achada); else setErroCaminho("Não existe essa pasta.");
  }

  const barraCaminho = (
    <nav aria-label="Caminho" className="relative flex min-h-9 min-w-0 flex-1 items-center gap-1 rounded-xl border border-border bg-surface-1 px-1.5 focus-within:border-steel-400">
      <button type="button" onClick={() => setPastaAtual(pai(pastaAtual))} disabled={!pastaAtual} aria-label="Subir uma pasta" title="Subir uma pasta (Backspace)"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"><ArrowUp size={15} /></button>
      <span className="h-4 w-px shrink-0 bg-border" />
      {editandoCaminho ? (
        <>
          <input
            autoFocus
            value={textoCaminho}
            aria-label="Caminho da pasta"
            placeholder="Digite o caminho da pasta…"
            onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); }}
            onChange={(e) => { setTextoCaminho(e.target.value); setSugIdx(-1); setErroCaminho(null); }}
            onBlur={() => setEditandoCaminho(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmarCaminho(); }
              else if (e.key === "Escape") { e.preventDefault(); setEditandoCaminho(false); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setSugIdx((i) => Math.min(i + 1, sugestoes.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSugIdx((i) => Math.max(i - 1, -1)); }
              else if (e.key === "Tab" && sugestoes.length) { e.preventDefault(); setTextoCaminho(sugestoes[Math.max(sugIdx, 0)]); setSugIdx(-1); }
            }}
            className="min-w-0 flex-1 bg-transparent px-1 text-sm text-text-primary outline-none ring-0 placeholder:text-text-muted" style={{ outline: "none", boxShadow: "none" }}
          />
          {(sugestoes.length > 0 || erroCaminho) && (
            <div className="ecos-sugestoes absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-border bg-surface-1 py-1 shadow-nav" onMouseDown={(e) => e.preventDefault()}>
              {erroCaminho && <p role="alert" className="px-3 py-1.5 text-xs text-error">{erroCaminho}</p>}
              <ul role="listbox" aria-label="Pastas">
                {sugestoes.map((c, i) => (
                  <li key={c} role="option" aria-selected={i === sugIdx}>
                    <button type="button" onClick={() => irPara(c)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === sugIdx ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"}`}>
                      <FolderOpen size={14} className="shrink-0 text-text-muted" /><span className="truncate">{c.split("/").join("  ›  ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-x-auto no-scrollbar">
          <button type="button" onClick={() => setPastaAtual("")} className={`shrink-0 rounded-md px-1.5 py-0.5 text-sm ${trechos.length ? "text-text-secondary hover:bg-surface-2 hover:text-text-primary" : "font-medium text-text-primary"} ${realce("")}`} {...soltarEm("")}>Raiz</button>
          {trechos.map((t, i) => {
            const caminho = trechos.slice(0, i + 1).join("/");
            return <span key={caminho} className="flex shrink-0 items-center gap-0.5"><ChevronRight size={13} className="text-text-muted" /><button type="button" onClick={() => setPastaAtual(caminho)} onContextMenu={(e) => abrirMenuCtx(linhaDaPasta(caminho), e, false)} className={`max-w-48 truncate rounded-md px-1.5 py-0.5 text-sm ${i === trechos.length - 1 ? "font-medium text-text-primary" : "text-text-secondary hover:bg-surface-2 hover:text-text-primary"} ${realce(caminho)}`} {...soltarEm(caminho)}>{t}</button></span>;
          })}
          <span aria-hidden title="Clique para digitar o caminho" onClick={iniciarEdicao} className="min-w-6 flex-1 cursor-text self-stretch" />
        </div>
      )}
    </nav>
  );

  return (
    <div className={`px-4 ${desktop ? "pb-2 pt-2" : "pt-1 pb-nav-safe"}`}>
      {desktop ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {barraCaminho}
          {!comArvore && (
            <label className="flex h-9 w-52 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-2.5 text-text-muted focus-within:border-steel-400">
              <Search size={14} className="shrink-0" />
              <input value={filtroPasta} onChange={(e) => setFiltroPasta(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setFiltroPasta("")} placeholder="Filtrar nesta pasta…" aria-label="Filtrar nesta pasta" className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted" />
              {filtroPasta && <button type="button" aria-label="Limpar filtro" onClick={() => setFiltroPasta("")} className="text-text-muted hover:text-text-primary"><X size={13} /></button>}
            </label>
          )}
          <MenuSuspenso
            valor={vista.chave}
            ariaLabel="Ordenar por"
            alinhar="dir"
            fixo
            opcoes={ORDENS.map((o) => ({ ...o, icone: ArrowUpDown }))}
            onChange={(chave) => alterarVista({ chave })}
            classeGatilho="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface-1 px-2.5 text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
            gatilho={({ atual }) => <><ArrowUpDown size={14} />{atual?.rotulo ?? "Ordenar"}</>}
          />
          <button type="button" onClick={() => alterarVista({ dir: vista.dir === 1 ? -1 : 1 })} aria-label={vista.dir === 1 ? "Ordem crescente: inverter" : "Ordem decrescente: inverter"} title={vista.dir === 1 ? "Crescente" : "Decrescente"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-1 text-text-secondary hover:bg-surface-2 hover:text-text-primary">{vista.dir === 1 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</button>
          <div className="flex shrink-0 rounded-xl border border-border bg-surface-1 p-0.5" role="group" aria-label="Modo de exibição">
            {([["lista", List, "Lista"], ["grade", LayoutGrid, "Grade"]] as const).map(([id, Icone, rotulo]) => (
              <button key={id} type="button" aria-pressed={vista.vista === id} aria-label={rotulo} title={rotulo} onClick={() => alterarVista({ vista: id })}
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${vista.vista === id ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"}`}><Icone size={15} /></button>
            ))}
          </div>
          <button type="button" onClick={() => setCriandoPasta(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3"><FolderPlus size={16} />Nova pasta</button>
          <button type="button" disabled={!!enviando} onClick={() => seletorArquivos.current?.click()} className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"><Upload size={16} />Enviar</button>
        </div>
      ) : (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mb-1 font-display text-2xl text-text-primary">Arquivos</h1>
            <p className="text-sm text-text-muted">Notas, tarefas e qualquer outro arquivo nas suas pastas.</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setCriandoPasta(true)} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3"><FolderPlus size={16} />Nova pasta</button>
            <button type="button" disabled={!!enviando} onClick={() => seletorArquivos.current?.click()} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"><Upload size={16} />Enviar</button>
          </div>
        </div>
      )}
      <input ref={seletorArquivos} type="file" multiple hidden aria-label="Escolher arquivos para enviar" onChange={(e) => { const lista = [...(e.target.files ?? [])]; e.target.value = ""; void enviarArquivos(lista, pastaAtual); }} />

      <div className={comArvore ? "grid grid-cols-[280px_minmax(0,1fr)] gap-4" : ""}>
        {comArvore && (
          <nav aria-label="Explorador" className="sticky top-2 flex max-h-[calc(100dvh-170px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-1">
            <div className="flex items-center gap-1 border-b border-border p-2">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-surface-2 px-2 text-text-muted focus-within:ring-1 focus-within:ring-steel-400">
                <Search size={14} className="shrink-0" />
                <input value={filtro} onChange={(e) => setFiltro(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setFiltro("")} placeholder="Filtrar arquivos…" aria-label="Filtrar arquivos" className="min-w-0 flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted" />
              </label>
              <button type="button" onClick={() => setAbertas(new Set())} aria-label="Recolher tudo" title="Recolher tudo" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><ChevronsDownUp size={15} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1.5">
              {achados ? (
                <ul aria-label="Resultados do filtro">
                  {achados.length === 0 && <li className="px-2 py-3 text-[13px] text-text-muted">Nada encontrado.</li>}
                  {achados.map((a) => noArquivo(a, 0))}
                </ul>
              ) : (
                <ul role="tree" aria-label="Pastas e arquivos">
                  <li role="treeitem" aria-expanded aria-selected={pastaAtual === ""}>
                    <div className={`flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] font-medium ${pastaAtual === "" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2"} ${realce("")}`} {...soltarEm("")}>
                      <button type="button" onClick={() => setPastaAtual("")} className="flex flex-1 items-center gap-1.5 text-left"><FolderOpen size={14} className="text-steel-300" />Raiz</button>
                    </div>
                    <ul role="group">{filhosNaArvore("", 0)}</ul>
                  </li>
                </ul>
              )}
            </div>
          </nav>
        )}
        <section aria-label="Conteúdo da pasta" className="min-w-0">
          {!desktop && (
            <nav aria-label="Caminho" className="mb-2 flex flex-wrap items-center gap-1 text-sm">
              <button type="button" onClick={() => setPastaAtual("")} className={`rounded-md px-1.5 py-0.5 ${trechos.length ? "text-text-secondary hover:text-text-primary" : "font-medium text-text-primary"}`}>Raiz</button>
              {trechos.map((t, i) => {
                const caminho = trechos.slice(0, i + 1).join("/");
                return <span key={caminho} className="flex items-center gap-1"><ChevronRight size={13} className="text-text-muted" /><button type="button" onClick={() => setPastaAtual(caminho)} className={`rounded-md px-1.5 py-0.5 ${i === trechos.length - 1 ? "font-medium text-text-primary" : "text-text-secondary hover:text-text-primary"}`}>{t}</button></span>;
              })}
            </nav>
          )}
          {enviando && !desktop && <p role="status" className="mb-2 text-xs text-steel-300">Enviando {Math.min(enviando.feitos + 1, enviando.total)} de {enviando.total}…</p>}
          {desktop && enviando && <p role="status" className="mb-2 flex min-h-8 items-center text-xs text-steel-300">Enviando {Math.min(enviando.feitos + 1, enviando.total)} de {enviando.total}…</p>}
          {erro ? <EstadoErro mensagem={erro} onTentarDeNovo={() => notificar()} /> : !conteudo ? <EstadoCarregando texto="Carregando…" /> : (
            <div ref={cartao} style={desktop && alturaLista ? { height: alturaLista } : undefined} role="grid" aria-label="Arquivos" aria-multiselectable={desktop} tabIndex={-1} onKeyDown={teclaNaLista} {...soltarEm(pastaAtual)}
              onMouseDown={iniciarRetangulo}
              onContextMenu={(e) => {
                // Botão direito no espaço vazio (as linhas têm o menu delas).
                if (!desktop || (e.target as HTMLElement).closest("[role=row]")) return;
                e.preventDefault();
                setSelecao(new Set());
                setMenuVazio({ x: e.clientX, y: e.clientY });
              }}
              onClick={(e) => { if (ignorarClique.current) return; if (e.target === e.currentTarget) setSelecao(new Set()); }}
              className={`rounded-2xl border border-border bg-surface-1 ${desktop ? "flex flex-col overflow-y-auto [&>*]:shrink-0" : "overflow-hidden"} ${realce(pastaAtual)}`}>
              {desktop && vista.vista === "lista" && (
                <div role="row" className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_110px_90px_110px_32px] gap-3 border-b border-border bg-surface-1 px-3 py-2">
                  {cabecalho("nome", "Nome")}{cabecalho("tipo", "Tipo")}{cabecalho("tamanho", "Tamanho", "justify-end")}{cabecalho("modificado", "Modificado")}<span role="columnheader" aria-label="Ações" />
                </div>
              )}
              {visiveis.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-text-muted">
                  <FolderOpen size={34} strokeWidth={1.3} />
                  <p className="text-sm">{filtroPasta ? "Nada encontrado nesta pasta." : desktop ? "Esta pasta está vazia. Solte arquivos aqui para enviar." : "Esta pasta está vazia."}</p>
                </div>
              )}

              {desktop && vista.vista === "grade" ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5 p-2">
                  {visiveis.map((linha) => {
                    const selecionada = selecao.has(linha.caminho);
                    const s = !linha.pasta && !linha.arquivo?.tipo && linha.arquivo?.categoria !== "markdown" && (marca === "ambos" || marca === "selo") ? selo(linha.arquivo!) : null;
                    return (
                      <div
                        key={linha.caminho}
                        role="row"
                        aria-selected={selecionada}
                        data-caminho={linha.caminho}
          onPointerDown={(e) => arrastar(e, linha)}
                        onClick={(e) => clicar(linha, e)}
                        onDoubleClick={(e) => abrir(linha, e)}
                        onContextMenu={(e) => abrirMenuCtx(linha, e)}
                        onKeyDown={(e) => { if (e.key === "Enter") abrir(linha); }}
                        tabIndex={0}
                        title={dicaDe(linha)}
                        className={`group relative flex min-h-[112px] cursor-default select-none flex-col items-center gap-2 rounded-xl px-2 pb-2 pt-4 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${selecionada ? "bg-steel-700/25 ring-1 ring-steel-400/60" : "hover:bg-surface-2"} ${linha.pasta ? realce(linha.caminho) : ""}`}
                        {...(linha.pasta ? soltarEm(linha.caminho) : {})}
                      >
                        <span className={`absolute right-1 top-1 ${selecionada ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"}`}>{acoes(linha)}</span>
                        {iconeDaLinha(linha, 38)}
                        <span className={`line-clamp-2 w-full break-words text-[13px] leading-snug ${linha.arquivo?.fora_do_padrao ? "text-error" : "text-text-primary"} ${concluida(linha) ? "line-through opacity-50" : ""}`}>{nomeExibido(linha)}</span>
                        <span className="text-[10px] uppercase tracking-wide text-text-muted">{s ?? (linha.pasta ? "Pasta" : linha.arquivo?.tipo ? rotuloDe(linha) : "")}</span>
                        {!!linha.arquivo?.anexos?.length && <span className="absolute left-1 top-1"><BadgeAnexos quantidade={linha.arquivo.anexos.length} aberto={false} aoAlternar={() => abrir(linha)} /></span>}
                      </div>
                    );
                  })}
                </div>
              ) : visiveis.map((linha) => {
                const selecionada = selecao.has(linha.caminho);
                const vermelho = linha.arquivo?.fora_do_padrao;
                const s = !linha.pasta && !linha.arquivo?.tipo && linha.arquivo?.categoria !== "markdown" && (marca === "ambos" || marca === "selo") ? selo(linha.arquivo!) : null;
                const anexos = linha.arquivo?.anexos ?? [];
                const aberto = anexos.length > 0 && anexosAbertos.has(linha.caminho);
                return (
                  <Fragment key={linha.caminho}>
                  <div
                    role="row"
                    aria-selected={selecionada}
                    data-caminho={linha.caminho}
          onPointerDown={(e) => arrastar(e, linha)}
                    onClick={(e) => clicar(linha, e)}
                    onDoubleClick={(e) => desktop && abrir(linha, e)}
                    onContextMenu={(e) => abrirMenuCtx(linha, e)}
                    onKeyDown={(e) => { if (e.key === "Enter") abrir(linha); }}
                    tabIndex={0}
                    title={dicaDe(linha)}
                    data-fora-do-padrao={vermelho || undefined}
                    className={`group grid min-h-11 cursor-default select-none items-center gap-3 border-b border-border/70 px-3 text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${desktop ? "grid-cols-[minmax(0,1fr)_110px_90px_110px_32px]" : "grid-cols-[minmax(0,1fr)_auto_32px]"} ${selecionada ? "bg-steel-700/25" : "hover:bg-surface-2"} ${linha.pasta ? realce(linha.caminho) : ""}`}
                    {...(linha.pasta ? soltarEm(linha.caminho) : {})}
                  >
                    <span role="gridcell" className="flex min-w-0 items-center gap-2.5">
                      {iconeDaLinha(linha, 18)}
                      <span className={`truncate ${vermelho ? "text-error" : "text-text-primary"} ${concluida(linha) ? "line-through opacity-50" : ""}`}>{nomeExibido(linha)}</span>
                      {anexos.length > 0 && <BadgeAnexos quantidade={anexos.length} aberto={aberto} aoAlternar={() => alternarAnexos(linha.caminho)} />}
                    </span>
                    {desktop ? <>
                      <span role="gridcell" className={`flex min-w-0 items-center gap-1.5 text-xs ${vermelho ? "text-error" : "text-text-muted"}`}>
                        <span className="truncate">{vermelho ? "fora do padrão" : rotuloDe(linha)}</span>
                        {/* A extensão sempre aparece: nota e tarefa são .md, e os demais mostram o formato real. */}
                        {linha.arquivo && !vermelho && extensaoDe(linha.arquivo) && <span className="shrink-0 font-mono-value text-[11px] text-text-muted/70">.{extensaoDe(linha.arquivo)}</span>}
                      </span>
                      <span role="gridcell" className="text-right text-xs text-text-muted">{linha.arquivo ? tamanho(linha.arquivo.tamanho_bytes) : ""}</span>
                      <span role="gridcell" className="text-xs text-text-muted">{quando(linha.arquivo?.modificado_em ?? null)}</span>
                    </> : <span role="gridcell" className="text-text-muted">{linha.pasta ? <ChevronRight size={16} /> : <span className="text-xs">{rotuloDe(linha)}</span>}</span>}
                    <span role="gridcell" className={selecionada ? "" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"}>{acoes(linha)}</span>
                  </div>
                  {aberto && anexos.map((m) => (
                    <div key={m.caminho} role="row" tabIndex={0} title={m.nome}
                      onDoubleClick={(e) => desktop && abrirDocumento(rotaDoAnexo(m), e)}
                      onKeyDown={(e) => { if (e.key === "Enter") abrirDocumento(rotaDoAnexo(m)); }}
                      className={`grid min-h-9 cursor-default select-none items-center gap-3 border-b border-border/70 bg-surface-2/40 px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${desktop ? "grid-cols-[minmax(0,1fr)_110px_90px_110px_32px]" : "grid-cols-[minmax(0,1fr)_auto]"}`}>
                      <span role="gridcell" className="flex min-w-0 items-center gap-2.5 pl-7">
                        <IconeArquivo a={anexoComoArquivo(m)} personalizados={iconesExtensao} size={16} className="text-text-muted" />
                        <span className="truncate text-text-secondary">{anexoComoArquivo(m).nome}</span>
                      </span>
                      {desktop ? <>
                        <span role="gridcell" className="text-xs text-text-muted">anexo</span>
                        <span role="gridcell" className="text-right text-xs text-text-muted">{tamanho(m.tamanho_bytes)}</span>
                        <span role="gridcell" /><span role="gridcell" />
                      </> : <span role="gridcell" className="text-xs text-text-muted">{tamanho(m.tamanho_bytes)}</span>}
                    </div>
                  ))}
                  </Fragment>
                );
              })}
          {desktop && conteudo && !erro && (
            <p className="sticky bottom-0 z-10 mt-auto flex h-8 items-center gap-3 border-t border-border bg-surface-1 px-3 text-xs text-text-muted" aria-live="polite">
              <span>
                {[
                  quantasPastas ? plural(quantasPastas, "pasta", "pastas") : "",
                  quantasNotas ? plural(quantasNotas, "nota", "notas") : "",
                  quantasTarefas ? plural(quantasTarefas, "tarefa", "tarefas") : "",
                  quantasMidias ? plural(quantasMidias, "mídia", "mídias") : "",
                  outrosArquivos ? plural(outrosArquivos, "arquivo", "arquivos") : "",
                  espacoUsado ? tamanho(espacoUsado) : "",
                ].filter(Boolean).join(" · ") || "Nenhum item"}
              </span>
              {resumo && resumo.pastas > 0 && (
                <span className="hidden truncate xl:block" title="Total da pasta, contando as subpastas">
                  Com subpastas: {[resumo.pastas ? plural(resumo.pastas, "pasta", "pastas") : "", resumo.notas ? plural(resumo.notas, "nota", "notas") : "", resumo.tarefas ? plural(resumo.tarefas, "tarefa", "tarefas") : "", resumo.midias ? plural(resumo.midias, "mídia", "mídias") : "", resumo.arquivos - resumo.notas - resumo.tarefas - resumo.midias > 0 ? plural(resumo.arquivos - resumo.notas - resumo.tarefas - resumo.midias, "arquivo", "arquivos") : "", tamanho(resumo.bytes)].filter(Boolean).join(" · ")}
                </span>
              )}
              {selecao.size > 0 && <span>{selecao.size} {selecao.size === 1 ? "selecionado" : "selecionados"}{tamanhoSelecionado ? ` · ${tamanho(tamanhoSelecionado)}` : ""}</span>}
            </p>
          )}
            </div>
          )}
        </section>
      </div>
      {revisandoMidias && <RevisarMidias espaco={espaco} aoFechar={() => setRevisandoMidias(false)} aoConcluir={(m) => { setRevisandoMidias(false); avisar(m, "sucesso"); notificar(); }} />}
      {criandoPasta && <NomeDialog titulo="Nova pasta" rotulo="Nome" inicial="" botao="Criar" ocupadoTexto="Criando…" dica={pastaAtual ? `Dentro de ${pastaAtual}.` : "Na raiz."} onFechar={() => setCriandoPasta(false)} onSalvar={criarPasta} />}
      {movendo && <MoverExplorador itens={detalhesParaMover(movendo)} espaco={espaco} aoFechar={() => setMovendo(null)} aoConcluir={(r) => { r.mudancas.forEach((m) => acompanhar(m.de, m.para)); avisar(r.mensagem, "sucesso"); setMovendo(null); setSelecao(new Set()); notificar(); }} />}
      {renomeando && <RenomearDialog linha={renomeando} onFechar={() => setRenomeando(null)} onSalvar={(novo) => renomear(renomeando, novo)} />}
      {retangulo && <div aria-hidden className="pointer-events-none fixed z-50 rounded-sm border border-steel-400 bg-steel-500/20" style={{ left: retangulo.l, top: retangulo.t, width: retangulo.w, height: retangulo.h }} />}
      {menuVazio && <MenuExplorador x={menuVazio.x} y={menuVazio.y} rotulo={pastaAtual ? pastaAtual.split("/").pop()! : "Raiz"} aoFechar={() => setMenuVazio(null)} itens={[
        { rotulo: "Nova pasta", icone: FolderPlus, acao: () => setCriandoPasta(true) },
        { rotulo: "Enviar arquivos", icone: Upload, acao: () => seletorArquivos.current?.click() },
        { rotulo: "Revisar mídias órfãs e duplicadas", icone: Paperclip, acao: () => setRevisandoMidias(true) },
        ...(visiveis.length ? [{ rotulo: "Selecionar tudo", icone: Check, acao: () => setSelecao(new Set(visiveis.map((l) => l.caminho))) }] : []),
        { rotulo: vista.vista === "lista" ? "Ver em grade" : "Ver em lista", icone: vista.vista === "lista" ? LayoutGrid : List, acao: () => alterarVista({ vista: vista.vista === "lista" ? "grade" : "lista" }) },
        ...(pastaAtual ? [{ rotulo: "Subir uma pasta", icone: ArrowUp, acao: () => setPastaAtual(pai(pastaAtual)) }] : []),
        { rotulo: "Atualizar", icone: RotateCw, acao: () => notificar() },
      ]} />}
      {menuCtx && <MenuExplorador x={menuCtx.x} y={menuCtx.y} rotulo={nomeExibido(menuCtx.linha)} itens={itensDoMenuCtx(menuCtx.linha)} aoFechar={() => setMenuCtx(null)} />}
      <ConfirmDeleteDialog
        open={!!excluindo}
        busy={apagando}
        title={excluindo?.length === 1 ? `Excluir ${excluindo[0].split("/").pop()}?` : `Excluir ${excluindo?.length ?? 0} itens?`}
        description={excluindo?.some((c) => linhas.find((l) => l.caminho === c)?.pasta) ? "Vai para a Lixeira com tudo o que tem dentro. Você pode restaurar depois." : "Vai para a Lixeira. Você pode restaurar depois."}
        confirmLabel="Excluir"
        busyLabel="Excluindo…"
        onCancel={() => setExcluindo(null)}
        onConfirm={() => excluindo && void excluir(excluindo)}
      />
    </div>
  );
}
