import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { ApiError, eventos, type TempoPorCategoria as Tempo } from "@/lib/api";
import { EmptyState } from "@/components/common/EmptyState";
import { formatarDuracao, larguraRelativa } from "@/lib/eventos";

const COR_SEM_CATEGORIA = "#64748B";

interface Props {
  de: Date;
  ate: Date;
  /** Muda quando algo foi criado/editado, para recarregar. */
  versao: number;
  onEscolherCategoria: (categoriaId: string | null) => void;
}

/** Quanto tempo foi para cada categoria no período (eventos com hora; dia inteiro não conta). */
export function TempoPorCategoria({ de, ate, versao, onEscolherCategoria }: Props) {
  const [dados, setDados] = useState<Tempo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const deIso = de.toISOString();
  const ateIso = ate.toISOString();

  useEffect(() => {
    let ativo = true;
    setDados(null);
    eventos.tempo({ de: deIso, ate: ateIso }).then((d) => { if (ativo) { setDados(d); setErro(null); } })
      .catch((e) => { if (ativo) setErro(e instanceof ApiError ? e.message : "Não foi possível calcular o tempo. Tente novamente."); });
    return () => { ativo = false; };
  }, [deIso, ateIso, versao]);

  if (erro) return <p role="alert" className="text-sm text-error">{erro}</p>;
  if (!dados) return <p className="py-10 text-center text-sm text-text-muted">Calculando...</p>;
  if (dados.itens.length === 0) {
    return <>
      <EmptyState icon={Clock} title="Nenhum tempo em eventos neste período." subtitle="Crie eventos com categoria para ver quanto tempo vai em reuniões, foco, estudos…" />
      {dados.recorrentes_ignorados > 0 && <AvisoSeries n={dados.recorrentes_ignorados} />}
    </>;
  }
  const maximo = Math.max(...dados.itens.map((i) => i.minutos));
  return (
    <div>
      <p className="mb-4 text-sm text-text-muted">Total em eventos: <strong className="text-text-primary">{formatarDuracao(dados.total_min)}</strong></p>
      <ul className="flex flex-col gap-3">
        {dados.itens.map((item) => {
          const cor = item.cor ?? COR_SEM_CATEGORIA;
          return (
            <li key={item.categoria_id ?? "sem"}>
              <button type="button" onClick={() => onEscolherCategoria(item.categoria_id)} aria-label={`Ver eventos de ${item.nome}`} className="block w-full rounded-xl p-2 text-left transition-colors hover:bg-surface-2">
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cor }} /><span className="truncate font-medium text-text-primary">{item.nome}</span></span>
                  <span className="shrink-0 text-text-secondary">{formatarDuracao(item.minutos)} <span className="text-xs text-text-muted">· {item.quantidade} {item.quantidade === 1 ? "evento" : "eventos"}</span></span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${larguraRelativa(item.minutos, maximo)}%`, backgroundColor: cor }} /></div>
              </button>
            </li>
          );
        })}
      </ul>
      {dados.recorrentes_ignorados > 0 && <AvisoSeries n={dados.recorrentes_ignorados} />}
    </div>
  );
}

function AvisoSeries({ n }: { n: number }) {
  return <p role="note" className="mt-5 rounded-xl bg-surface-2 px-3 py-2 text-xs text-text-muted">{n} {n === 1 ? "evento recorrente ficou" : "eventos recorrentes ficaram"} de fora da soma: a contagem de ocorrências das séries ainda não está disponível.</p>;
}
