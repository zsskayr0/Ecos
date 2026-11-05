import { useEffect, useState } from "react";
import { FilePlus2, Link2Off } from "lucide-react";
import { links, notas, type LinkPendente } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { EstadoErro } from "@/components/common/EstadoErro";
import { SkeletonItens } from "@/components/common/SkeletonTelas";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAbrirDestino } from "@/lib/wikilinks";
import { avisar } from "@/lib/toast";
import { mensagemDeErro } from "@/lib/erros";

const chaveDe = (l: LinkPendente) => `${l.espaco}\u0000${l.titulo.toLowerCase()}`;

/** Wikilinks `[[...]]` sem nota de destino, com "Criar nota" em um clique. O reindex da criação resolve os links. */
export function LinksQuebradosScreen() {
  const { versao, notificar } = useRefreshBus();
  const abrir = useAbrirDestino();
  const [lista, setLista] = useState<LinkPendente[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [criando, setCriando] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    links.pendentes().then((l) => { if (ativo) { setLista(l); setErro(null); } }).catch((e) => { if (ativo) setErro(mensagemDeErro(e, "Não foi possível carregar os links quebrados.")); });
    return () => { ativo = false; };
  }, [versao, tentativa]);

  async function criar(item: LinkPendente) {
    setCriando(chaveDe(item));
    try {
      await notas.criar({ titulo: item.titulo, espaco: item.espaco, ...(item.pasta_sugerida ? { pasta: item.pasta_sugerida } : {}) });
      setLista((l) => l?.filter((x) => chaveDe(x) !== chaveDe(item)) ?? null);
      avisar(`Nota “${item.titulo}” criada.`, "sucesso");
      notificar();
    } catch (e) {
      avisar(mensagemDeErro(e, "Não foi possível criar a nota."), "erro");
    } finally {
      setCriando(null);
    }
  }

  return (
    <div className="px-4 pt-1 pb-nav-safe">
      <h1 className="mb-1 font-display text-2xl text-text-primary">Links quebrados</h1>
      <p className="mb-5 text-sm text-text-muted">Títulos citados com [[ ]] que ainda não têm nota. Criar a nota liga todos os links de uma vez.</p>
      {erro && <EstadoErro mensagem={erro} onTentarDeNovo={() => setTentativa((n) => n + 1)} />}
      {lista === null ? (
        erro ? null : <SkeletonItens modo="lista" tipo="nota" rotulo="Carregando…" />
      ) : lista.length === 0 && !erro ? (
        <EmptyState icon={Link2Off} title="Nenhum link quebrado." subtitle="Todo [[link]] aponta para uma nota ou tarefa existente." />
      ) : (
        <ul className="flex flex-col gap-3">
          {lista.map((item) => (
            <li key={chaveDe(item)} className="rounded-xl bg-surface-1 p-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{item.titulo}</p>
                  <p className="text-xs text-text-muted">{item.contagem === 1 ? "1 menção" : `${item.contagem} menções`}{item.pasta_sugerida ? ` · pasta ${item.pasta_sugerida}` : ""}</p>
                </div>
                <button type="button" disabled={criando !== null} onClick={() => criar(item)} aria-label={`Criar nota ${item.titulo}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-xs font-medium text-text-primary disabled:opacity-50">
                  <FilePlus2 size={14} aria-hidden />Criar nota
                </button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {item.origens.map((o) => (
                  <li key={`${o.tipo}:${o.id}`}>
                    <button type="button" onClick={(e) => abrir({ tipo: o.tipo, id: o.id }, e)} title={`Abrir ${o.tipo}: ${o.titulo}`}
                      className="max-w-[16rem] truncate rounded-md bg-surface-2 px-2 py-1 text-xs text-text-muted hover:text-text-primary">{o.titulo}</button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
