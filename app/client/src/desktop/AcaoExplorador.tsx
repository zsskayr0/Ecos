import { lazy, Suspense, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { arquivos, pastas } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { Dialog } from "@/components/common/Dialog";
import { MoverExplorador, type ItemParaMover } from "./MoverExplorador";

const AparenciaPasta = lazy(() => import("@/components/common/AparenciaPasta"));
const COR_INICIAL = "#7dd3fc";

/** O que a ação vai atingir: uma pasta, ou um arquivo (nota, tarefa ou outro). */
export interface AlvoExplorador {
  caminho: string;
  /** Como aparece nos textos: nome da pasta ou título/nome do arquivo. */
  rotulo: string;
  /** Valor inicial do campo de renomear (pasta: nome; nota/tarefa: título; outro: nome com extensão). */
  nomeEditavel: string;
  pasta: boolean;
  cor?: string | null;
  icone?: string | null;
  /** Vários itens de uma vez (seleção com Ctrl/Shift): só mover e excluir valem. `caminho` é o primeiro deles. */
  lote?: string[];
  /** O que será movido (nome, tipo e id), para a janela de mover mostrar e, entre espaços, levar notas e tarefas. */
  detalhes?: ItemParaMover[];
}

export type TipoAcao = "renomear" | "mover" | "excluir" | "personalizar";

/** `de` é o caminho de antes; `para` o de depois (`null` quando o item foi para a Lixeira). */
export interface MudancaCaminho { de: string; para: string | null }
export interface ResultadoAcao { mudancas: MudancaCaminho[]; mensagem: string }

const paiDe = (caminho: string) => caminho.split("/").slice(0, -1).join("/");

const TITULO: Record<TipoAcao, (a: AlvoExplorador) => string> = {
  renomear: (a) => (a.pasta ? "Renomear pasta" : "Renomear"),
  mover: (a) => (a.lote ? "Mover itens" : a.pasta ? "Mover pasta" : "Mover"),
  excluir: (a) => (a.lote ? "Excluir itens" : a.pasta ? "Excluir pasta" : "Excluir"),
  personalizar: () => "Cor e ícone da pasta",
};

interface Props {
  acao: TipoAcao;
  alvo: AlvoExplorador;
  espaco: string;
  aoFechar: () => void;
  aoConcluir: (resultado: ResultadoAcao) => void;
}

/** Janela de uma ação da árvore lateral: renomear, mover, excluir (vai para a Lixeira) ou personalizar a pasta. */
export function AcaoExplorador(props: Props) {
  const { acao, alvo, espaco, aoFechar, aoConcluir } = props;
  if (acao === "mover") {
    const itens = alvo.detalhes ?? (alvo.lote ?? [alvo.caminho]).map((caminho) => ({ caminho, rotulo: alvo.rotulo, tipo: alvo.pasta ? "pasta" as const : "arquivo" as const }));
    return <MoverExplorador itens={itens} espaco={espaco} aoFechar={aoFechar} aoConcluir={aoConcluir} />;
  }
  return <AcaoSimples {...props} />;
}

function AcaoSimples({ acao, alvo, espaco, aoFechar, aoConcluir }: Props) {
  const [nome, setNome] = useState(alvo.nomeEditavel);
  const [cor, setCor] = useState(alvo.cor ?? "");
  const [icone, setIcone] = useState(alvo.icone ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(trabalho: () => Promise<ResultadoAcao>, falha: string) {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      aoConcluir(await trabalho());
    } catch (e) {
      setErro(mensagemDeErro(e, falha));
      setOcupado(false);
    }
  }

  const renomear = () => executar(async () => {
    const r = await arquivos.renomear({ espaco, caminho: alvo.caminho, novo_nome: nome.trim() });
    return { mudancas: [{ de: alvo.caminho, para: r.caminho }], mensagem: alvo.pasta ? "Pasta renomeada." : "Renomeado." };
  }, "Não foi possível renomear.");

  const personalizar = () => executar(async () => {
    const pai = paiDe(alvo.caminho);
    const novoNome = nome.trim();
    const destino = pai ? `${pai}/${novoNome}` : novoNome;
    await pastas.renomear({ tipo: "nota", espaco, caminho_atual: alvo.caminho, novo_caminho: destino, cor, icone });
    return { mudancas: [{ de: alvo.caminho, para: destino }], mensagem: "Pasta atualizada." };
  }, "Não foi possível salvar a pasta.");

  const itens = alvo.lote ?? [alvo.caminho];

  const excluir = () => executar(async () => {
    const r = await arquivos.excluir({ espaco, itens });
    const motivo = r.falhas.map((f) => f.motivo).join("; ");
    if (r.falhas.length && !r.excluidos.length) throw new Error(motivo);
    const mensagem = itens.length === 1 ? "Enviado para a Lixeira." : `${r.excluidos.length} itens enviados para a Lixeira.${r.falhas.length ? ` Não excluiu ${r.falhas.length}: ${motivo}.` : ""}`;
    return { mudancas: r.excluidos.map((de) => ({ de, para: null })), mensagem };
  }, "Não foi possível excluir.");

  const campoNome = (
    <>
      <label className="mb-2 block text-sm text-text-secondary" htmlFor="explorador-novo-nome">Nome</label>
      <input
        id="explorador-novo-nome"
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => { if (e.key === "Enter" && nome.trim()) void (acao === "personalizar" ? personalizar() : renomear()); }}
        className="ecos-input mb-4 w-full !rounded-lg"
      />
    </>
  );

  return (
    <Dialog rotuloId="explorador-acao-titulo" onFechar={aoFechar}>
      <div className={`w-full rounded-2xl border border-border bg-surface-1 p-5 shadow-nav ${acao === "personalizar" ? "max-h-[90dvh] max-w-lg overflow-y-auto" : "max-w-sm"}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="explorador-acao-titulo" className="font-semibold text-text-primary">{TITULO[acao](alvo)}</h2>
          <button type="button" onClick={aoFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button>
        </div>

        {acao === "renomear" && (
          <>
            {campoNome}
            <button type="button" disabled={ocupado || !nome.trim()} onClick={() => void renomear()} className="flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-on-steel disabled:opacity-40"><Check size={16} />Salvar</button>
          </>
        )}

        {acao === "personalizar" && (
          <>
            {campoNome}
            <Suspense fallback={<p className="text-sm text-text-muted">Carregando…</p>}>
              <AparenciaPasta cor={cor || COR_INICIAL} icone={icone || "Folder"} onCor={setCor} onIcone={setIcone} />
            </Suspense>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={ocupado || !nome.trim()} onClick={() => void personalizar()} className="flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-on-steel disabled:opacity-40"><Check size={16} />Salvar</button>
              {(cor || icone) && <button type="button" onClick={() => { setCor(""); setIcone(""); }} className="min-h-10 rounded-lg px-3 text-sm text-text-secondary hover:bg-surface-2">Voltar ao padrão</button>}
            </div>
          </>
        )}

        {acao === "excluir" && (
          <>
            <p className="text-sm text-text-secondary">
              Excluir <span className="font-medium text-text-primary">{alvo.rotulo}</span>?{" "}
              {alvo.lote ? "Vão para a Lixeira, de onde dá para restaurar (pastas vão com tudo o que há dentro)." : alvo.pasta ? "A pasta e tudo o que há dentro dela vão para a Lixeira." : "Vai para a Lixeira, de onde dá para restaurar."}
            </p>
            <button type="button" disabled={ocupado} onClick={() => void excluir()} className="mt-4 flex min-h-10 items-center gap-2 rounded-lg bg-error px-3 text-sm font-medium text-white disabled:opacity-40"><Trash2 size={16} />Excluir</button>
          </>
        )}

        {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
      </div>
    </Dialog>
  );
}
