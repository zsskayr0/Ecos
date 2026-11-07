import { pastaDoArquivo as pastaDoArquivoComum } from "@/lib/caminho-item";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FileWarning, Loader2, Wand2 } from "lucide-react";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { EmptyState } from "@/components/common/EmptyState";
import { problemasArquivos, type ProblemaArquivo } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";
import { Cabecalho } from "./campos-config";

const MOTIVO: Record<ProblemaArquivo["problema"], string> = {
  sem_prefixo: "O nome não começa com o prefixo do tipo.",
  prefixo_de_outro_tipo: "O nome tem o prefixo do outro tipo. O item continua sendo o que é; só o nome do arquivo muda.",
};

const nomeDoArquivo = (caminho: string) => caminho.split("/").pop() ?? caminho;
/** Pasta como a pessoa a vê: sem o diretório do espaço nem a árvore física (`marina/Notas/Trabalho/x.md` → `Trabalho`). */
const pastaDoArquivo = (caminho: string) => pastaDoArquivoComum(caminho) ?? "";

/** "Problemas de arquivos": `.md` fora do padrão `note-<Título>.md` / `task-<Título>.md`, com correção um a um ou de todos. */
export function ProblemasArquivosScreen() {
  const { notificar } = useRefreshBus();
  const [itens, setItens] = useState<ProblemaArquivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmandoTodos, setConfirmandoTodos] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try { setItens((await problemasArquivos.listar()).itens); }
    catch (e) { setErro(mensagemDeErro(e, "Não foi possível carregar os problemas de arquivos.")); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function corrigir(chave: string, payload: Parameters<typeof problemasArquivos.corrigir>[0]) {
    setOcupado(chave); setErro(null); setAviso(null);
    try {
      const r = await problemasArquivos.corrigir(payload);
      const partes = [`${r.corrigidos.length} arquivo${r.corrigidos.length === 1 ? "" : "s"} renomeado${r.corrigidos.length === 1 ? "" : "s"}.`];
      if (r.falhas.length) partes.push(`${r.falhas.length} não pôde${r.falhas.length === 1 ? "" : "ram"} ser corrigido${r.falhas.length === 1 ? "" : "s"}: ${r.falhas.map((f) => `${nomeDoArquivo(f.caminho)} (${f.motivo})`).join("; ")}.`);
      setAviso(partes.join(" "));
      setConfirmandoTodos(false);
      notificar();
      await carregar();
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível corrigir. Nenhum arquivo foi alterado.")); }
    finally { setOcupado(null); }
  }

  const botao = "min-h-10 rounded-xl px-3 text-sm font-medium disabled:opacity-40";

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Problemas de arquivos" />
      <p className="mb-4 text-sm text-text-secondary">
        Notas se chamam <code className="text-text-primary">note-Título.md</code> e tarefas <code className="text-text-primary">task-Título.md</code>.
        Corrigir renomeia o arquivo na mesma pasta. Editar um item fora do padrão também o renomeia. O tipo do item nunca muda.
      </p>

      {erro && <EstadoErro mensagem={erro} onTentarDeNovo={() => void carregar()} />}
      {aviso && <p role="status" className="mb-3 text-sm text-text-secondary">{aviso}</p>}

      {itens === null ? (erro ? null : <EstadoCarregando texto="Carregando…" />) : itens.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Todos os arquivos seguem o padrão." subtitle="Quando um .md estiver fora do padrão de nome, ele aparece aqui e em vermelho no explorador." />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">{itens.length} arquivo{itens.length === 1 ? "" : "s"} fora do padrão</p>
            {!confirmandoTodos && (
              <button type="button" onClick={() => setConfirmandoTodos(true)} disabled={ocupado !== null} className={`${botao} flex items-center gap-1.5 bg-surface-2 text-text-primary`}>
                <Wand2 size={15} aria-hidden />Corrigir todos
              </button>
            )}
          </div>
          {confirmandoTodos && (
            <div role="alertdialog" aria-label="Confirmar: corrigir todos" className="mb-3 rounded-xl bg-surface-2 p-3">
              <p className="text-sm text-text-primary">Renomear {itens.length} arquivo{itens.length === 1 ? "" : "s"}?</p>
              <p className="mt-1 text-xs text-text-secondary">Cada arquivo passa a se chamar como mostrado em "Novo nome", na mesma pasta.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirmandoTodos(false)} disabled={ocupado !== null} className={`${botao} bg-surface-1 text-text-primary`}>Cancelar</button>
                <button type="button" onClick={() => void corrigir("todos", { todos: true })} disabled={ocupado !== null} className={`${botao} flex items-center gap-1.5 bg-cyan text-black`}>
                  {ocupado === "todos" && <Loader2 size={15} className="animate-spin" aria-hidden />}Corrigir todos
                </button>
              </div>
            </div>
          )}
          <ul className="space-y-3">
            {itens.map((p) => (
              <li key={`${p.tipo}:${p.id}`} className="rounded-2xl border border-error/40 bg-surface-1 p-4" data-testid="problema-arquivo">
                <p className="text-xs text-text-muted">{p.tipo === "tarefa" ? "Tarefa" : "Nota"}{pastaDoArquivo(p.caminho) ? ` · ${pastaDoArquivo(p.caminho)}` : ""}</p>
                <p className="mt-1 flex items-center gap-2 text-[15px] font-semibold text-error"><FileWarning size={16} aria-hidden />{nomeDoArquivo(p.caminho)}</p>
                <p className="mt-1 text-sm text-text-secondary">{MOTIVO[p.problema]}</p>
                <p className="mt-1 text-sm text-text-secondary">Novo nome: <span className="font-medium text-text-primary">{p.nome_sugerido}</span></p>
                <button type="button" onClick={() => void corrigir(`${p.tipo}:${p.id}`, { itens: [{ tipo: p.tipo, id: p.id }] })} disabled={ocupado !== null} className={`${botao} mt-3 flex items-center gap-1.5 bg-surface-2 text-text-primary hover:bg-surface-3`}>
                  {ocupado === `${p.tipo}:${p.id}` && <Loader2 size={15} className="animate-spin" aria-hidden />}Corrigir
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
