import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CornerDownRight, FileText, Folder, FolderInput, ListChecks, Search, User, Users, X, File as ArquivoIcone } from "lucide-react";
import { arquivos, equipes, notas, pastas, tarefas } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { Dialog } from "@/components/common/Dialog";
import { ArvorePastas } from "@/components/common/ArvorePastas";
import type { MudancaCaminho } from "./AcaoExplorador";

/** Um item a mover. `id` existe só em nota e tarefa: são os únicos que sabem trocar de espaço. */
export interface ItemParaMover {
  caminho: string;
  rotulo: string;
  tipo: "pasta" | "nota" | "tarefa" | "arquivo";
  id?: string;
}

interface Props {
  itens: ItemParaMover[];
  /** Espaço de origem (`pessoal` ou `equipe:<id>`). */
  espaco: string;
  aoFechar: () => void;
  aoConcluir: (r: { mudancas: MudancaCaminho[]; mensagem: string }) => void;
}

interface Espaco { chave: string; nome: string; cor?: string }

const paiDe = (c: string) => c.split("/").slice(0, -1).join("/");
const nomeDe = (c: string) => c.split("/").pop() ?? c;
const juntar = (a: string, b: string) => (a ? `${a}/${b}` : b);

const ICONE: Record<ItemParaMover["tipo"], typeof FileText> = { pasta: Folder, nota: FileText, tarefa: ListChecks, arquivo: ArquivoIcone };

/**
 * Mover em bloco: escolhe o espaço (Pessoal ou uma equipe) e a pasta de destino, vê o que vai e confirma.
 * No mesmo espaço move tudo. Em outro espaço só notas e tarefas (com as mídias) mudam; pastas levam o que têm de nota
 * e tarefa, recriando a estrutura, e o que não é nota nem tarefa fica para trás.
 */
export function MoverExplorador({ itens, espaco, aoFechar, aoConcluir }: Props) {
  const [espacos, setEspacos] = useState<Espaco[]>([{ chave: "pessoal", nome: "Pessoal" }]);
  const [espacoDestino, setEspacoDestino] = useState(espaco);
  const [destino, setDestino] = useState("");
  const [busca, setBusca] = useState("");
  const [pastasDestino, setPastasDestino] = useState<{ caminho: string; nome: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    equipes.listarMinhas()
      .then((lista) => { if (vivo) setEspacos([{ chave: "pessoal", nome: "Pessoal" }, ...lista.map((e) => ({ chave: `equipe:${e.id}`, nome: e.nome, cor: e.cor }))]); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    pastas.listar({ recursivo: true, tipo: "todos", espaco: espacoDestino })
      .then((r) => { if (vivo) setPastasDestino(r.subpastas); })
      .catch(() => { if (vivo) setPastasDestino([]); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [espacoDestino]);

  const outroEspaco = espacoDestino !== espaco;
  const nomeEspaco = espacos.find((e) => e.chave === espacoDestino)?.nome ?? espacoDestino;
  const opcoes = useMemo(
    () => pastasDestino
      // Dentro do mesmo espaço, uma pasta não vai para dentro dela mesma nem de suas filhas.
      .filter((d) => outroEspaco || !itens.some((i) => d.caminho === i.caminho || d.caminho.startsWith(`${i.caminho}/`)))
      .map((p) => ({ valor: p.caminho, rotulo: p.nome, pasta: true })),
    [pastasDestino, itens, outroEspaco],
  );
  const semMudanca = !outroEspaco && itens.every((i) => paiDe(i.caminho) === destino);
  const quantasPastas = itens.filter((i) => i.tipo === "pasta").length;
  const outros = itens.filter((i) => i.tipo === "arquivo").length;

  function escolherEspaco(chave: string) {
    if (chave === espacoDestino) return;
    setEspacoDestino(chave);
    setDestino("");
    setBusca("");
    setErro(null);
  }

  /** Notas e tarefas de uma pasta (e das subpastas), com a pasta que cada uma deve ter no destino. */
  async function coletar(pasta: string, destinoDaPasta: string, saida: { tipo: "nota" | "tarefa"; id: string; pasta: string }[], ignorados: { n: number }) {
    const r = await arquivos.listar({ espaco, pasta });
    for (const a of r.arquivos) {
      if ((a.tipo === "nota" || a.tipo === "tarefa") && a.id) saida.push({ tipo: a.tipo, id: a.id, pasta: destinoDaPasta });
      else ignorados.n += 1;
    }
    for (const p of r.pastas) await coletar(p.caminho, juntar(destinoDaPasta, p.nome), saida, ignorados);
  }

  async function mover() {
    if (ocupado || semMudanca) return;
    setOcupado(true);
    setErro(null);
    try {
      if (!outroEspaco) {
        const r = await arquivos.mover({ espaco, itens: itens.map((i) => i.caminho), destino });
        const motivo = r.falhas.map((f) => f.motivo).join("; ");
        if (r.falhas.length && !r.movidos.length) throw new Error(motivo);
        const msg = itens.length === 1 ? `Movido para ${destino || "a raiz"}.` : `${r.movidos.length} itens movidos para ${destino || "a raiz"}.${r.falhas.length ? ` Não moveu ${r.falhas.length}: ${motivo}.` : ""}`;
        aoConcluir({ mudancas: r.movidos.map((m) => ({ de: m.de, para: m.para })), mensagem: msg });
        return;
      }
      // Outro espaço: cada nota e tarefa troca de espaço pelo próprio documento (levando as mídias).
      const fila: { tipo: "nota" | "tarefa"; id: string; pasta: string }[] = [];
      const ignorados = { n: 0 };
      for (const item of itens) {
        if (item.tipo === "pasta") await coletar(item.caminho, juntar(destino, nomeDe(item.caminho)), fila, ignorados);
        else if ((item.tipo === "nota" || item.tipo === "tarefa") && item.id) fila.push({ tipo: item.tipo, id: item.id, pasta: destino });
        else ignorados.n += 1;
      }
      if (!fila.length) throw new Error("Não há notas nem tarefas para levar a outro espaço. Pastas vazias e outros arquivos não mudam de espaço.");
      let feitos = 0;
      let falhas = 0;
      for (const f of fila) {
        setProgresso(`Movendo ${feitos + falhas + 1} de ${fila.length}…`);
        try {
          if (f.tipo === "nota") await notas.atualizar(f.id, { pasta: f.pasta, espaco: espacoDestino });
          else await tarefas.atualizar(f.id, { pasta: f.pasta, espaco: espacoDestino });
          feitos += 1;
        } catch { falhas += 1; }
      }
      if (!feitos) throw new Error("Não foi possível mover. Confira se você tem acesso de escrita ao espaço de destino.");
      const resto = [
        falhas ? `${falhas} não ${falhas === 1 ? "foi movido" : "foram movidos"}` : "",
        ignorados.n ? `${ignorados.n} ${ignorados.n === 1 ? "arquivo que não é nota nem tarefa ficou" : "arquivos que não são notas nem tarefas ficaram"} onde estava${ignorados.n === 1 ? "" : "m"}` : "",
      ].filter(Boolean).join("; ");
      aoConcluir({ mudancas: [], mensagem: `${feitos} ${feitos === 1 ? "item movido" : "itens movidos"} para ${nomeEspaco}${destino ? ` › ${destino.split("/").join(" › ")}` : ""}.${resto ? ` ${resto}.` : ""}` });
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível mover."));
      setOcupado(false);
      setProgresso(null);
    }
  }

  const titulo = itens.length === 1 ? `Mover “${itens[0]?.rotulo}”` : `Mover ${itens.length} itens`;
  const visiveis = itens.slice(0, 5);

  return (
    <Dialog rotuloId="mover-explorador-titulo" onFechar={aoFechar}>
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-nav">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id="mover-explorador-titulo" className="flex min-w-0 items-center gap-2 font-semibold text-text-primary"><FolderInput size={17} className="shrink-0 text-steel-300" /><span className="truncate">{titulo}</span></h2>
          <button type="button" onClick={aoFechar} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {itens.length > 1 && (
            <section aria-label="Itens a mover">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Itens ({itens.length})</p>
              <ul className="space-y-0.5 rounded-xl border border-border bg-surface-2/50 p-1.5">
                {visiveis.map((i) => {
                  const Icone = ICONE[i.tipo];
                  return <li key={i.caminho} className="flex items-center gap-2 px-1.5 py-1 text-[13px] text-text-secondary"><Icone size={14} className="shrink-0 text-text-muted" /><span className="truncate">{i.rotulo}</span></li>;
                })}
                {itens.length > visiveis.length && <li className="px-1.5 py-1 text-xs text-text-muted">e mais {itens.length - visiveis.length}…</li>}
              </ul>
            </section>
          )}

          {espacos.length > 1 && (
            <section aria-label="Espaço de destino">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Espaço de destino</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Espaço de destino">
                {espacos.map((e) => {
                  const ativo = e.chave === espacoDestino;
                  const Icone = e.chave === "pessoal" ? User : Users;
                  return (
                    <button key={e.chave} type="button" role="radio" aria-checked={ativo} onClick={() => escolherEspaco(e.chave)} disabled={ocupado}
                      className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm ${ativo ? "border-steel-400 bg-surface-2 text-text-primary" : "border-border text-text-secondary hover:bg-surface-2"}`}>
                      <Icone size={14} style={e.cor ? { color: e.cor } : undefined} className={e.cor ? "" : "text-text-muted"} />
                      <span className="max-w-40 truncate">{e.nome}</span>
                      {e.chave === espaco && <span className="text-[10px] text-text-muted">(atual)</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {outroEspaco && (
            <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-text-secondary">
              Em outro espaço, só <strong className="font-semibold text-text-primary">notas e tarefas</strong> são levadas (com as mídias usadas nelas)
              {quantasPastas ? "; as pastas são recriadas no destino com o que têm de nota e tarefa" : ""}.
              {outros || quantasPastas ? " PDFs, imagens e outros arquivos ficam onde estão, assim como a cor e o ícone das pastas." : ""}
            </p>
          )}

          <section aria-label="Pasta de destino">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Pasta de destino</p>
            <div className="relative mb-2">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pasta…" aria-label="Buscar pasta" className="ecos-input w-full !rounded-lg !pl-8" />
            </div>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
              <button type="button" onClick={() => setDestino("")} aria-pressed={destino === ""}
                className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-surface-3 ${destino === "" ? "bg-steel-700/20 text-text-primary" : "text-text-secondary"}`}>
                <CornerDownRight size={15} className="shrink-0 text-steel-300" />
                <span className="flex-1 truncate">Raiz de {nomeEspaco}</span>
                {destino === "" && <Check size={14} className="shrink-0 text-steel-300" />}
              </button>
              {carregando ? <p className="px-3 py-2 text-sm text-text-muted">Carregando pastas…</p>
                : <ArvorePastas opcoes={opcoes} valores={[destino]} onSelect={setDestino} busca={busca} />}
              {!carregando && !opcoes.length && <p className="px-3 py-2 text-sm text-text-muted">Este espaço ainda não tem pastas.</p>}
            </div>
          </section>
        </div>

        <div className="border-t border-border px-5 py-3.5">
          {erro && <p role="alert" className="mb-2 text-sm text-error">{erro}</p>}
          <div className="flex items-center gap-3">
            <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-text-muted" aria-live="polite">
              {progresso ?? (<><ArrowRight size={13} className="shrink-0" /><span className="truncate">{nomeEspaco}{destino ? ` › ${destino.split("/").join(" › ")}` : " › raiz"}</span></>)}
            </p>
            <button type="button" onClick={aoFechar} disabled={ocupado} className="min-h-10 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-2 disabled:opacity-40">Cancelar</button>
            <button type="button" onClick={() => void mover()} disabled={ocupado || semMudanca || carregando}
              className="flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3.5 text-sm font-medium text-on-steel disabled:opacity-40">
              <FolderInput size={16} />{itens.length === 1 ? "Mover" : `Mover ${itens.length} itens`}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
