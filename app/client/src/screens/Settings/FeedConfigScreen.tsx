import { useCallback, useEffect, useState } from "react";
import { EyeOff, Eye, Folder, Hash, FileText } from "lucide-react";
import { feed, pastas, tagsApi, type FeedOcultos } from "@/lib/api";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { useAppUI } from "@/lib/ui-context";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { Cabecalho, Linha, Secao } from "./campos-config";

const VAZIO: FeedOcultos = { itens: [], pastas: [], tags: [] };

function Entrada({ Icone, rotulo, detalhe, aoMostrar }: { Icone: typeof Folder; rotulo: string; detalhe?: string; aoMostrar: () => void }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-b border-border/60 px-4 py-2 text-sm last:border-0">
      <Icone size={16} className="shrink-0 text-steel-300" />
      <span className="min-w-0 flex-1"><span className="block truncate text-text-primary">{rotulo}</span>{detalhe && <span className="block truncate text-xs text-text-muted">{detalhe}</span>}</span>
      <button type="button" onClick={aoMostrar} className="flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3 text-xs font-medium text-text-primary hover:bg-surface-3"><Eye size={14} />Mostrar de novo</button>
    </div>
  );
}

const rotuloEspaco = (e: string) => (e === "pessoal" ? "Pessoal" : "Equipe");

/** O que fica de fora do Feed: itens, pastas (com subpastas) e tags escolhidos. Só afeta o Feed. */
export function FeedConfigScreen() {
  const { espacoAtivo } = useAppUI();
  const { notificar } = useRefreshBus();
  const espaco = espacoAtivo === "pessoal" || espacoAtivo.startsWith("equipe:") ? espacoAtivo : "pessoal";
  const [ocultos, setOcultos] = useState<FeedOcultos>(VAZIO);
  const [pastasDisp, setPastasDisp] = useState<string[]>([]);
  const [tagsDisp, setTagsDisp] = useState<string[]>([]);

  useEffect(() => { void feed.ocultos().then(setOcultos).catch(() => avisar("Não foi possível carregar o Feed personalizado.", "erro")); }, []);
  useEffect(() => {
    void pastas.listar({ tipo: "todos", espaco, recursivo: true }).then((r) => setPastasDisp(r.subpastas.map((p) => p.caminho).sort())).catch(() => setPastasDisp([]));
    void tagsApi.listar(espaco).then((r) => setTagsDisp(r.map((t) => t.tag).sort())).catch(() => setTagsDisp([]));
  }, [espaco]);

  const alterar = useCallback(async (alvo: { tipo: "item" | "pasta" | "tag"; ref: string; espaco?: string }, oculto: boolean) => {
    try { setOcultos(await feed.ocultar(alvo, oculto)); notificar(); } catch { avisar("Não foi possível atualizar o Feed.", "erro"); }
  }, [notificar]);

  const pastaOpcoes = pastasDisp.filter((c) => !ocultos.pastas.some((p) => p.espaco === espaco && p.caminho === c)).map((c) => ({ valor: c, rotulo: c.split("/").join(" / ") }));
  const tagOpcoes = tagsDisp.filter((t) => !ocultos.tags.includes(t)).map((t) => ({ valor: t, rotulo: `#${t}` }));

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Feed" />
      <p className="mb-4 text-sm text-text-muted">Escolha o que não quer ver no Feed. O item continua nas listas, nas pastas e na busca. Também dá para ocultar direto no card (ícone <EyeOff size={13} className="inline" />).</p>

      <Secao titulo="Pastas ocultas">
        <Linha Icone={Folder} titulo="Ocultar pasta" descricao={`Esconde tudo da pasta e das subpastas (${rotuloEspaco(espaco)}).`}>
          <SeletorEcos<string> valor="" opcoes={[{ valor: "", rotulo: "Escolher pasta…" }, ...pastaOpcoes]} buscar ariaLabel="Ocultar pasta do Feed" onChange={(v) => v && void alterar({ tipo: "pasta", ref: v, espaco }, true)} />
        </Linha>
        {ocultos.pastas.map((p) => <Entrada key={`${p.espaco}:${p.caminho}`} Icone={Folder} rotulo={p.caminho.split("/").join(" / ")} detalhe={rotuloEspaco(p.espaco)} aoMostrar={() => void alterar({ tipo: "pasta", ref: p.caminho, espaco: p.espaco }, false)} />)}
      </Secao>

      <Secao titulo="Tags ocultas">
        <Linha Icone={Hash} titulo="Ocultar tag" descricao="Notas e tarefas com essa tag saem do Feed.">
          <SeletorEcos<string> valor="" opcoes={[{ valor: "", rotulo: "Escolher tag…" }, ...tagOpcoes]} buscar ariaLabel="Ocultar tag do Feed" onChange={(v) => v && void alterar({ tipo: "tag", ref: v }, true)} />
        </Linha>
        {ocultos.tags.map((t) => <Entrada key={t} Icone={Hash} rotulo={`#${t}`} aoMostrar={() => void alterar({ tipo: "tag", ref: t }, false)} />)}
      </Secao>

      <Secao titulo="Notas e tarefas ocultas">
        {ocultos.itens.length === 0 && <p className="px-4 py-4 text-sm text-text-muted">Nenhum item oculto. Use o ícone de olho cortado no card para ocultar.</p>}
        {ocultos.itens.map((i) => <Entrada key={i.id} Icone={FileText} rotulo={i.titulo ?? "(item removido)"} detalhe={i.tipo ?? undefined} aoMostrar={() => void alterar({ tipo: "item", ref: i.id }, false)} />)}
      </Secao>
    </div>
  );
}
