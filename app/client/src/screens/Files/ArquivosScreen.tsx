import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, File, FileText, Folder, FolderInput, FolderOpen, FolderPlus, Image as ImageIcon, ListChecks, MoreHorizontal, Music, Pencil, StickyNote, Trash2, Upload, Video, type LucideIcon } from "lucide-react";
import { arquivos, pastas as pastasApi, type ArquivoExplorador } from "@/lib/api";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";
import { Dialog } from "@/components/common/Dialog";
import { MenuSuspenso } from "@/components/common/MenuSuspenso";
import { ArvorePastas } from "@/components/common/ArvorePastas";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useIsDesktop } from "@/lib/use-viewport";
import { useRefreshBus } from "@/lib/refresh-bus";
import { mensagemDeErro } from "@/lib/erros";
import { avisar } from "@/lib/toast";

/** Tipo de dado do arrastar-e-soltar interno: a lista de caminhos lógicos sendo movidos. */
const TIPO_ARRASTE = "application/x-ecos-arquivos";
/** Mesmo limite do servidor por arquivo. */
const LIMITE_ENVIO = 120 * 1024 * 1024;

interface Linha {
  caminho: string;
  nome: string;
  pasta: boolean;
  arquivo?: ArquivoExplorador;
}

const pai = (caminho: string) => (caminho.includes("/") ? caminho.slice(0, caminho.lastIndexOf("/")) : "");

/** Soltar `itens` em `destino` não faz sentido: já estão lá, ou é uma pasta para dentro dela mesma. */
function destinoInvalido(itens: string[], destino: string) {
  return itens.every((i) => pai(i) === destino) || itens.some((i) => destino === i || destino.startsWith(`${i}/`));
}

function iconeDe(linha: Linha): LucideIcon {
  if (linha.pasta) return Folder;
  const a = linha.arquivo!;
  if (a.tipo === "nota") return StickyNote;
  if (a.tipo === "tarefa") return ListChecks;
  return { markdown: FileText, pdf: FileText, texto: FileText, imagem: ImageIcon, audio: Music, video: Video, outro: File }[a.categoria];
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

/** Escolher a pasta de destino numa lista (o caminho para mover sem arrastar: celular e teclado). */
function MoverDialog({ itens, pastas, onFechar, onMover }: { itens: string[]; pastas: string[]; onFechar: () => void; onMover: (destino: string) => Promise<void> }) {
  const id = useId();
  const [destino, setDestino] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Fora da lista: as próprias pastas sendo movidas e o que está dentro delas.
  const opcoes = [
    { valor: "", rotulo: "Raiz" },
    ...pastas.filter((p) => !itens.some((i) => p === i || p.startsWith(`${i}/`))).map((p) => ({ valor: p, rotulo: p.split("/").pop()!, pasta: true })),
  ];
  const invalido = destino === null || destinoInvalido(itens, destino);
  const nome = itens.length === 1 ? itens[0].split("/").pop() : `${itens.length} itens`;
  return (
    <Dialog rotuloId={`${id}-t`} onFechar={() => !ocupado && onFechar()}>
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface-1 p-5">
        <h2 id={`${id}-t`} className="mb-1 text-lg font-semibold text-text-primary">Mover {nome}</h2>
        <p className="mb-3 text-xs text-text-muted">{destino === null ? "Escolha a pasta de destino." : `Para: ${destino || "Raiz"}`}</p>
        <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-surface-2 p-1">
          <ArvorePastas opcoes={opcoes} valores={destino === null ? [] : [destino]} onSelect={setDestino} />
        </div>
        <div className="mt-4 flex gap-3">
          <button type="button" disabled={ocupado} onClick={onFechar} className="min-h-11 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary disabled:opacity-40">Cancelar</button>
          <button type="button" disabled={ocupado || invalido} onClick={async () => { setOcupado(true); await onMover(destino!); setOcupado(false); }} className="min-h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white disabled:opacity-40">{ocupado ? "Movendo…" : "Mover aqui"}</button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Explorador de arquivos: a árvore única do espaço (notas, tarefas e qualquer outro arquivo nas mesmas pastas).
 * Desktop: árvore de pastas à esquerda, conteúdo à direita, seleção com Ctrl/Shift e mover arrastando. Mobile:
 * navega e abre com um toque.
 */
export function ArquivosScreen() {
  const desktop = useIsDesktop();
  const abrirDocumento = useAbrirDocumento();
  const { versao, notificar } = useRefreshBus();
  const espaco = useEspacoFiltro() ?? "pessoal";
  const [pastaAtual, setPastaAtual] = useState("");
  const [conteudo, setConteudo] = useState<{ pastas: { nome: string; caminho: string }[]; arquivos: ArquivoExplorador[] } | null>(null);
  const [arvore, setArvore] = useState<string[]>([]);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [ancora, setAncora] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<Linha | null>(null);
  const [excluindo, setExcluindo] = useState<string[] | null>(null);
  const [apagando, setApagando] = useState(false);
  const [criandoPasta, setCriandoPasta] = useState(false);
  const [movendo, setMovendo] = useState<string[] | null>(null);
  const [enviando, setEnviando] = useState<{ feitos: number; total: number } | null>(null);
  const seletorArquivos = useRef<HTMLInputElement>(null);

  useEffect(() => { setPastaAtual(""); }, [espaco]);

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

  useEffect(() => {
    let vivo = true;
    pastasApi.listar({ recursivo: true, espaco }).then((r) => vivo && setArvore(r.subpastas.map((p) => p.caminho).sort((a, b) => a.localeCompare(b, "pt-BR")))).catch(() => undefined);
    return () => { vivo = false; };
  }, [espaco, versao]);

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
    ...conteudo.pastas.map((p) => ({ caminho: p.caminho, nome: p.nome, pasta: true })),
    ...conteudo.arquivos.map((a) => ({ caminho: a.caminho, nome: a.nome, pasta: false, arquivo: a })),
  ] : [], [conteudo]);

  const abrir = useCallback((linha: Linha, evento?: MouseEvent) => {
    if (linha.pasta) { setPastaAtual(linha.caminho); return; }
    const a = linha.arquivo!;
    const destino = a.tipo === "nota" && a.id ? `/notas/nota/${a.id}`
      : a.tipo === "tarefa" && a.id ? `/tarefa/${a.id}`
      : `/media/ver?a=${encodeURIComponent(a.caminho)}&e=${encodeURIComponent(espaco)}`;
    abrirDocumento(destino, evento);
  }, [abrirDocumento, espaco]);

  function clicar(linha: Linha, evento: MouseEvent) {
    if (!desktop) { abrir(linha, evento); return; }
    if (evento.shiftKey && ancora) {
      const ordem = linhas.map((l) => l.caminho);
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
    try {
      const r = await arquivos.mover({ espaco, itens, destino });
      if (r.movidos.length) avisar(`${r.movidos.length} ${r.movidos.length === 1 ? "item movido" : "itens movidos"} para ${destino || "a raiz"}.`, "sucesso");
      if (r.falhas.length) avisar(`Não foi possível mover: ${r.falhas.map((f) => `${f.caminho.split("/").pop()} (${f.motivo})`).join("; ")}.`, "erro");
      notificar();
    } catch (e) { avisar(mensagemDeErro(e, "Não foi possível mover."), "erro"); }
  }

  async function renomear(linha: Linha, novo: string): Promise<string | null> {
    try {
      const r = await arquivos.renomear({ espaco, caminho: linha.caminho, novo_nome: novo });
      setRenomeando(null);
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

  /** F2 renomeia o selecionado; Delete manda a seleção para a Lixeira. */
  function teclaNaLista(e: KeyboardEvent) {
    if (!desktop || renomeando || excluindo) return;
    if (e.key === "F2" && selecao.size === 1) {
      const linha = linhas.find((l) => selecao.has(l.caminho));
      if (linha) { e.preventDefault(); setRenomeando(linha); }
    } else if (e.key === "Delete" && selecao.size) {
      e.preventDefault();
      setExcluindo([...selecao]);
    }
  }

  function acoes(linha: Linha) {
    return (
      <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} className="flex justify-end">
        <MenuSuspenso
          valor=""
          ariaLabel={`Ações de ${linha.nome}`}
          alinhar="dir"
          fixo
          opcoes={[{ valor: "renomear", rotulo: "Renomear", icone: Pencil }, { valor: "mover", rotulo: "Mover para…", icone: FolderInput }, { valor: "excluir", rotulo: "Excluir", icone: Trash2 }]}
          onChange={(v) => {
            if (v === "renomear") setRenomeando(linha);
            // Com a linha dentro da seleção, move a seleção inteira (como ao arrastar).
            else if (v === "mover") setMovendo(selecao.has(linha.caminho) ? [...selecao] : [linha.caminho]);
            else setExcluindo([linha.caminho]);
          }}
          classeGatilho="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3 hover:text-text-primary"
          gatilho={() => <MoreHorizontal size={16} />}
        />
      </span>
    );
  }

  function iniciarArraste(linha: Linha, evento: DragEvent) {
    const itens = selecao.has(linha.caminho) ? [...selecao] : [linha.caminho];
    if (!selecao.has(linha.caminho)) setSelecao(new Set([linha.caminho]));
    evento.dataTransfer.setData(TIPO_ARRASTE, JSON.stringify(itens));
    evento.dataTransfer.effectAllowed = "move";
  }

  /** Propriedades de um lugar onde dá para soltar itens (pasta da lista, nó da árvore, trecho do caminho). */
  function soltarEm(destino: string) {
    if (!desktop) return {};
    return {
      onDragOver: (e: DragEvent) => {
        const interno = e.dataTransfer.types.includes(TIPO_ARRASTE);
        if (!interno && !e.dataTransfer.types.includes("Files")) return;
        // A pasta mais de dentro decide (a lista inteira também aceita, como a pasta aberta).
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = interno ? "move" : "copy";
        setAlvo(destino);
      },
      onDragLeave: () => setAlvo((atual) => (atual === destino ? null : atual)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setAlvo(null);
        if (e.dataTransfer.types.includes(TIPO_ARRASTE)) {
          try { void mover(JSON.parse(e.dataTransfer.getData(TIPO_ARRASTE)) as string[], destino); } catch { /* dado inválido */ }
        } else if (e.dataTransfer.files?.length) {
          void enviarArquivos([...e.dataTransfer.files], destino);
        }
      },
    };
  }

  const realce = (destino: string) => (alvo === destino ? "bg-steel-700/30 ring-1 ring-steel-400" : "");
  const trechos = pastaAtual ? pastaAtual.split("/") : [];

  const filhos = useMemo(() => {
    const mapa = new Map<string, string[]>();
    for (const c of arvore) { const p = pai(c); mapa.set(p, [...(mapa.get(p) ?? []), c]); }
    return mapa;
  }, [arvore]);

  function no(caminho: string, nivel: number) {
    const sub = filhos.get(caminho) ?? [];
    const aberta = abertas.has(caminho);
    const nome = caminho.split("/").pop();
    return (
      <li key={caminho}>
        <div className={`flex min-h-8 items-center rounded-lg pr-2 text-sm ${pastaAtual === caminho ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2"} ${realce(caminho)}`} style={{ paddingLeft: 4 + nivel * 14 }} {...soltarEm(caminho)}>
          <button type="button" aria-label={aberta ? `Recolher ${nome}` : `Expandir ${nome}`} onClick={() => setAbertas((a) => { const p = new Set(a); if (p.has(caminho)) p.delete(caminho); else p.add(caminho); return p; })} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted ${sub.length ? "" : "invisible"}`}>
            {aberta ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <button type="button" onClick={() => setPastaAtual(caminho)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            {aberta && sub.length ? <FolderOpen size={15} className="shrink-0 text-steel-300" /> : <Folder size={15} className="shrink-0 text-steel-300" />}
            <span className="truncate">{nome}</span>
          </button>
        </div>
        {aberta && sub.length > 0 && <ul>{sub.map((s) => no(s, nivel + 1))}</ul>}
      </li>
    );
  }

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mb-1 font-display text-2xl text-text-primary">Arquivos</h1>
          <p className="text-sm text-text-muted">{desktop ? "Notas, tarefas e qualquer outro arquivo nas suas pastas. Arraste para mover, ou solte arquivos do computador para enviar." : "Notas, tarefas e qualquer outro arquivo nas suas pastas."}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setCriandoPasta(true)} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3"><FolderPlus size={16} />Nova pasta</button>
          <button type="button" disabled={!!enviando} onClick={() => seletorArquivos.current?.click()} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3 disabled:opacity-50"><Upload size={16} />Enviar</button>
          <input ref={seletorArquivos} type="file" multiple hidden aria-label="Escolher arquivos para enviar" onChange={(e) => { const lista = [...(e.target.files ?? [])]; e.target.value = ""; void enviarArquivos(lista, pastaAtual); }} />
        </div>
      </div>
      <div className={desktop ? "grid grid-cols-[240px_minmax(0,1fr)] gap-4" : ""}>
        {desktop && (
          <nav aria-label="Pastas" className="max-h-[calc(100dvh-180px)] overflow-auto rounded-2xl bg-surface-1 p-2">
            <div className={`flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-sm ${pastaAtual === "" ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-2"} ${realce("")}`} {...soltarEm("")}>
              <button type="button" onClick={() => setPastaAtual("")} className="flex flex-1 items-center gap-1.5 text-left"><FolderOpen size={15} className="text-steel-300" />Raiz</button>
            </div>
            <ul>{(filhos.get("") ?? []).map((c) => no(c, 0))}</ul>
          </nav>
        )}
        <section aria-label="Conteúdo da pasta" className="min-w-0">
          <nav aria-label="Caminho" className="mb-2 flex flex-wrap items-center gap-1 text-sm">
            <button type="button" onClick={() => setPastaAtual("")} className={`rounded-md px-1.5 py-0.5 ${trechos.length ? "text-text-secondary hover:text-text-primary" : "font-medium text-text-primary"} ${realce("")}`} {...soltarEm("")}>Raiz</button>
            {trechos.map((t, i) => {
              const caminho = trechos.slice(0, i + 1).join("/");
              return <span key={caminho} className="flex items-center gap-1"><ChevronRight size={13} className="text-text-muted" /><button type="button" onClick={() => setPastaAtual(caminho)} className={`rounded-md px-1.5 py-0.5 ${i === trechos.length - 1 ? "font-medium text-text-primary" : "text-text-secondary hover:text-text-primary"} ${realce(caminho)}`} {...soltarEm(caminho)}>{t}</button></span>;
            })}
          </nav>
          {/* Sempre ocupa a mesma altura: a lista não pula entre os dois cliques de um duplo clique. */}
          {enviando && !desktop && <p role="status" className="mb-2 text-xs text-steel-300">Enviando {Math.min(enviando.feitos + 1, enviando.total)} de {enviando.total}…</p>}
          {desktop && (enviando ? (
            <p role="status" className="mb-2 flex min-h-8 items-center text-xs text-steel-300">Enviando {Math.min(enviando.feitos + 1, enviando.total)} de {enviando.total}…</p>
          ) : selecao.size === 0 ? (
            <p className="mb-2 flex min-h-8 items-center text-xs text-text-muted">Duplo clique abre · F2 renomeia · Delete exclui</p>
          ) : (
            <div role="toolbar" aria-label="Ações da seleção" className="mb-2 flex min-h-8 items-center gap-2 text-sm">
              <span className="mr-1 text-text-muted">{selecao.size === 1 ? "1 selecionado" : `${selecao.size} selecionados`}</span>
              {selecao.size === 1 && <button type="button" onClick={() => { const l = linhas.find((x) => selecao.has(x.caminho)); if (l) setRenomeando(l); }} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3"><Pencil size={14} />Renomear</button>}
              <button type="button" onClick={() => setMovendo([...selecao])} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-3"><FolderInput size={14} />Mover</button>
              <button type="button" onClick={() => setExcluindo([...selecao])} className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-error hover:bg-surface-3"><Trash2 size={14} />Excluir</button>
            </div>
          ))}
          {erro ? <EstadoErro mensagem={erro} onTentarDeNovo={() => notificar()} /> : !conteudo ? <EstadoCarregando texto="Carregando…" /> : (
            <div role="grid" aria-label="Arquivos" aria-multiselectable={desktop} onKeyDown={teclaNaLista} {...soltarEm(pastaAtual)} className={`overflow-hidden rounded-2xl border border-border bg-surface-1 ${realce(pastaAtual)}`}>
              {desktop && <div role="row" className="grid grid-cols-[minmax(0,1fr)_110px_90px_100px_32px] gap-3 border-b border-border px-3 py-2 text-xs font-medium text-text-muted"><span role="columnheader">Nome</span><span role="columnheader">Tipo</span><span role="columnheader" className="text-right">Tamanho</span><span role="columnheader">Modificado</span><span role="columnheader" aria-label="Ações" /></div>}
              {linhas.length === 0 && <p className="px-4 py-8 text-center text-sm text-text-muted">{desktop ? "Esta pasta está vazia. Solte arquivos aqui para enviar." : "Esta pasta está vazia."}</p>}
              {linhas.map((linha) => {
                const Icone = iconeDe(linha);
                const selecionada = selecao.has(linha.caminho);
                const vermelho = linha.arquivo?.fora_do_padrao;
                return (
                  <div
                    key={linha.caminho}
                    role="row"
                    aria-selected={selecionada}
                    data-caminho={linha.caminho}
                    draggable={desktop}
                    onDragStart={(e) => iniciarArraste(linha, e)}
                    onClick={(e) => clicar(linha, e)}
                    onDoubleClick={(e) => desktop && abrir(linha, e)}
                    onKeyDown={(e) => { if (e.key === "Enter") abrir(linha); }}
                    tabIndex={0}
                    title={vermelho ? "Nome de arquivo fora do padrão: corrija em Configurações › Problemas de arquivos" : undefined}
                    className={`grid min-h-11 cursor-default select-none items-center gap-3 border-b border-border px-3 text-sm last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400 ${desktop ? "grid-cols-[minmax(0,1fr)_110px_90px_100px_32px]" : "grid-cols-[minmax(0,1fr)_auto_32px]"} ${selecionada ? "bg-steel-700/25" : "hover:bg-surface-2"} ${linha.pasta ? realce(linha.caminho) : ""}`}
                    {...(linha.pasta ? soltarEm(linha.caminho) : {})}
                  >
                    <span role="gridcell" className="flex min-w-0 items-center gap-2.5">
                      <Icone size={17} strokeWidth={1.7} className={`shrink-0 ${vermelho ? "text-error" : linha.pasta ? "text-steel-300" : "text-text-secondary"}`} />
                      <span className={`truncate ${vermelho ? "text-error" : "text-text-primary"}`}>{linha.nome}</span>
                    </span>
                    {desktop ? <>
                      <span role="gridcell" className={`truncate text-xs ${vermelho ? "text-error" : "text-text-muted"}`}>{vermelho ? "fora do padrão" : rotuloDe(linha)}</span>
                      <span role="gridcell" className="text-right text-xs text-text-muted">{linha.arquivo ? tamanho(linha.arquivo.tamanho_bytes) : ""}</span>
                      <span role="gridcell" className="text-xs text-text-muted">{quando(linha.arquivo?.modificado_em ?? null)}</span>
                    </> : <span role="gridcell" className="text-text-muted">{linha.pasta ? <ChevronRight size={16} /> : <span className="text-xs">{rotuloDe(linha)}</span>}</span>}
                    <span role="gridcell">{acoes(linha)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
      {criandoPasta && <NomeDialog titulo="Nova pasta" rotulo="Nome" inicial="" botao="Criar" ocupadoTexto="Criando…" dica={pastaAtual ? `Dentro de ${pastaAtual}.` : "Na raiz."} onFechar={() => setCriandoPasta(false)} onSalvar={criarPasta} />}
      {movendo && <MoverDialog itens={movendo} pastas={arvore} onFechar={() => setMovendo(null)} onMover={async (destino) => { await mover(movendo, destino); setMovendo(null); }} />}
      {renomeando && <RenomearDialog linha={renomeando} onFechar={() => setRenomeando(null)} onSalvar={(novo) => renomear(renomeando, novo)} />}
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
