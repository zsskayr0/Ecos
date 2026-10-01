import { useAppUI } from "@/lib/ui-context";
import { useEspacoFiltro } from "@/lib/use-espaco-filtro";
import { useEffect, useState } from "react";
import { ApiError, eventos, type AtualizarEventoPayload, type AtualizarOcorrenciaPayload, type CategoriaEvento, type Evento } from "@/lib/api";
import { dataLocalISO, instanteLocalISO } from "@/lib/agenda-tempo";
import { deInputData } from "@/lib/eventos";
import { ocorrenciaEfetiva } from "@/lib/eventos-agenda";
import type { EventoLocal } from "@/lib/eventos-locais";
import { EditorEvento, type DadosEvento, type EventoEditavel, type ModoEditor } from "../Agenda/EditorEvento";
import { CategoriasDialog } from "./CategoriasDialog";

interface Props {
  aberto: boolean;
  /** `null` = novo evento. */
  eventoId: string | null;
  /** Início ORIGINAL (ISO) de uma ocorrência de série: edita só ela (a série em si é do Google). */
  ocorrencia?: string | null;
  categorias: CategoriaEvento[];
  /** Dia em que um evento NOVO começa (a Agenda passa o dia que está aberto). Sem isso, hoje. */
  diaInicial?: Date;
  /** Itens da Agenda no período, para o aviso de choque de horário. */
  eventosNoPeriodo?: EventoLocal[];
  passoMin?: number;
  onFechar: () => void;
  /** Depois de criar, editar, cancelar ou excluir. */
  onSalvo: () => void;
  /** Depois de criar/editar/apagar categorias no próprio editor. */
  onCategoriasAlteradas?: () => void;
}

const DIA_MS = 86_400_000;
const meiaNoite = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** O evento do servidor (ou uma ocorrência dele) como o editor o mostra. */
function paraEditavel(e: Evento, ocorrencia?: string | null): EventoEditavel {
  const efetiva = ocorrencia ? ocorrenciaEfetiva(e, ocorrencia) : null;
  const inicio = new Date(efetiva?.inicio ?? e.inicio);
  const fim = new Date(efetiva?.fim ?? e.fim);
  const emSerie = !!e.rrule;
  const multiDia = e.dia_inteiro
    ? Math.round((meiaNoite(fim).getTime() - meiaNoite(inicio).getTime()) / DIA_MS) > 1
    : fim > inicio && dataLocalISO(new Date(fim.getTime() - 1)) !== dataLocalISO(inicio);
  const modo: ModoEditor = ocorrencia ? "ocorrencia" : emSerie && e.origem_google ? "serie-google" : "evento";
  return {
    id: e.id,
    titulo: efetiva?.titulo ?? e.titulo,
    dia: dataLocalISO(inicio),
    minutos: e.dia_inteiro ? null : inicio.getHours() * 60 + inicio.getMinutes(),
    duracaoMin: e.dia_inteiro ? 60 : Math.max(1, Math.round((fim.getTime() - inicio.getTime()) / 60_000)),
    cor: e.cor ?? null,
    local: (efetiva ? efetiva.local : e.local) ?? "",
    descricao: (efetiva ? efetiva.descricao : e.descricao) ?? "",
    categoriaId: e.categoria_id,
    privado: e.visibilidade === "privado",
    origemGoogle: e.origem_google,
    tarefas: e.tarefas,
    notas: e.notas,
    rrule: e.rrule,
    multiDia,
    modo,
  };
}

/** `inicio`/`fim` (ISO/UTC) do que o editor mostra: dia inteiro = meia-noite local até a seguinte. */
function janelaDe(d: DadosEvento): { inicio: string; fim: string } {
  if (d.minutos === null) return { inicio: deInputData(d.dia), fim: deInputData(d.dia, 1) };
  const inicio = instanteLocalISO(d.dia, d.minutos);
  return { inicio, fim: new Date(new Date(inicio).getTime() + d.duracaoMin * 60_000).toISOString() };
}

const mesmoConjunto = (a: { id: string }[], b: { id: string }[]) => a.length === b.length && a.every((x) => b.some((y) => y.id === x.id));

/**
 * Criar/editar evento: carrega o detalhe, abre o editor (o mesmo da Agenda) e traduz o que a pessoa fez em chamadas à API,
 * mandando só o que mudou (mexer só em vínculos ou cor não marca o evento para o Google).
 */
export function EventoDialog({ aberto, eventoId, ocorrencia, categorias, diaInicial, eventosNoPeriodo, passoMin, onFechar, onSalvo, onCategoriasAlteradas }: Props) {
  const [detalhe, setDetalhe] = useState<Evento | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [cats, setCats] = useState(categorias);
  const { espacoAtivo } = useAppUI();
  const filtro = useEspacoFiltro();
  /** Equipe de um evento NOVO: a que está em foco no app, mudável no editor. Evento existente mantém a sua. */
  const [espacoNovo, setEspacoNovo] = useState(filtro ?? espacoAtivo);
  const espaco = detalhe?.espaco ?? espacoNovo;
  const [gerenciando, setGerenciando] = useState(false);

  useEffect(() => { if (aberto) setEspacoNovo(filtro ?? espacoAtivo); }, [aberto, filtro, espacoAtivo]);
  useEffect(() => setCats(categorias), [categorias]);
  // As categorias são por equipe: ao escolher/abrir outra equipe, a lista acompanha.
  useEffect(() => {
    if (!aberto || (eventoId && !detalhe)) return;
    let ativo = true;
    eventos.categorias.listar({ espaco }).then((l) => { if (ativo) setCats(l); }).catch(() => undefined);
    return () => { ativo = false; };
  }, [aberto, eventoId, detalhe, espaco]);
  useEffect(() => {
    setDetalhe(null);
    setErroCarga(null);
    if (!aberto || !eventoId) return;
    let ativo = true;
    eventos.obter(eventoId).then((e) => { if (ativo) setDetalhe(e); }).catch((e) => { if (ativo) setErroCarga(e instanceof ApiError ? e.message : "Não foi possível carregar o evento."); });
    return () => { ativo = false; };
  }, [aberto, eventoId]);

  if (!aberto) return null;
  const sobre = "fixed inset-0 z-50 flex items-center justify-center bg-black/40 lg:absolute lg:z-30";
  if (erroCarga) {
    return <div className={sobre}><div className="rounded-2xl border border-border bg-surface-1 p-6"><p role="alert" className="mb-4 text-sm text-error">{erroCarga}</p><button type="button" onClick={onFechar} className="rounded-xl bg-surface-2 px-4 py-2 text-sm">Fechar</button></div></div>;
  }
  if (eventoId && !detalhe) return <div className={sobre}><p className="rounded-xl bg-surface-1 px-4 py-2 text-sm text-text-muted">Carregando evento...</p></div>;

  const editavel = detalhe ? paraEditavel(detalhe, ocorrencia) : undefined;

  async function salvar(d: DadosEvento) {
    if (!detalhe || !editavel) {
      const j = janelaDe(d);
      await eventos.criar({
        titulo: d.titulo, ...j, dia_inteiro: d.minutos === null, local: d.local ?? null, descricao: d.descricao ?? "",
        categoria_id: d.categoriaId, cor: d.cor, visibilidade: d.privado ? "privado" : "google", espaco,
        tarefas: d.tarefas.map((t) => t.id), notas: d.notas.map((n) => n.id),
      });
      onSalvo();
      return;
    }
    const mudouQuando = d.dia !== editavel.dia || d.minutos !== editavel.minutos || d.duracaoMin !== editavel.duracaoMin;
    const local = d.local ?? "";
    const descricao = d.descricao ?? "";

    if (editavel.modo === "ocorrencia" && ocorrencia) {
      // Só esta ocorrência: só o que mudou em relação ao que ela já mostrava.
      const p: AtualizarOcorrenciaPayload = { original: ocorrencia };
      if (d.titulo !== editavel.titulo) p.titulo = d.titulo;
      if (mudouQuando && !editavel.multiDia && d.minutos !== null) { const j = janelaDe(d); p.inicio = j.inicio; p.fim = j.fim; }
      if (local !== editavel.local.trim()) p.local = local || null;
      if (descricao !== editavel.descricao.trim()) p.descricao = descricao;
      if (Object.keys(p).length > 1) await eventos.atualizarOcorrencia(detalhe.id, p);
      onSalvo();
      return;
    }

    const p: AtualizarEventoPayload = {};
    const soMetadados = editavel.modo === "serie-google"; // a série é do Google: só o que é do Ecos
    if (!soMetadados) {
      if (d.titulo !== editavel.titulo) p.titulo = d.titulo;
      if ((d.minutos === null) !== (editavel.minutos === null)) p.dia_inteiro = d.minutos === null;
      if (mudouQuando && !editavel.multiDia) { const j = janelaDe(d); p.inicio = j.inicio; p.fim = j.fim; }
      if (local !== editavel.local.trim()) p.local = local || null;
      if (descricao !== editavel.descricao.trim()) p.descricao = descricao;
      if ((d.privado ? "privado" : "google") !== detalhe.visibilidade) p.visibilidade = d.privado ? "privado" : "google";
    }
    if (d.categoriaId !== editavel.categoriaId) p.categoria_id = d.categoriaId;
    if (d.cor !== editavel.cor) p.cor = d.cor;
    const tarefasMudaram = !mesmoConjunto(d.tarefas, editavel.tarefas);
    const notasMudaram = !mesmoConjunto(d.notas, editavel.notas);
    // O servidor troca a lista inteira: se só uma mudou, a outra vai junto.
    if (tarefasMudaram || notasMudaram) { p.tarefas = d.tarefas.map((t) => t.id); p.notas = d.notas.map((n) => n.id); }
    if (Object.keys(p).length > 0) await eventos.atualizar(detalhe.id, p);
    onSalvo();
  }

  async function excluir() {
    if (!detalhe) return;
    if (ocorrencia) await eventos.cancelarOcorrencia(detalhe.id, ocorrencia);
    else await eventos.excluir(detalhe.id);
    onSalvo();
  }

  return (
    <>
      <EditorEvento
        key={`${detalhe?.id ?? "novo"}:${ocorrencia ?? ""}`}
        dia={diaInicial ?? new Date()}
        evento={editavel}
        categorias={cats}
        eventos={eventosNoPeriodo}
        passoMin={passoMin}
        onFechar={onFechar}
        onSalvar={salvar}
        onExcluir={editavel ? excluir : undefined}
        onGerenciarCategorias={() => setGerenciando(true)}
        espaco={espaco}
        onEspaco={setEspacoNovo}
        espacoFixo={!!detalhe}
      />
      <CategoriasDialog
        aberto={gerenciando}
        categorias={cats}
        espaco={espaco}
        onFechar={() => setGerenciando(false)}
        onAlterado={() => { eventos.categorias.listar({ espaco }).then(setCats).catch(() => undefined); onCategoriasAlteradas?.(); }}
      />
    </>
  );
}
