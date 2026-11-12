import { useEffect, useId, useMemo, useState } from "react";
import { Dialog } from "@/components/common/Dialog";
import { ApiError, revisaoMidias, type ItemRevisaoMidia, type RevisaoMidias } from "@/lib/api";

function tamanho(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Revisão das mídias da biblioteca que nenhuma nota ou tarefa usa (órfãs) e dos arquivos repetidos (duplicados).
 * Só as órfãs podem ser descartadas, e vão para a lixeira (dá para restaurar); o que alguma nota usa nunca é tocado.
 */
export function RevisarMidias({ espaco, aoFechar, aoConcluir }: { espaco?: string; aoFechar: () => void; aoConcluir: (mensagem: string) => void }) {
  const id = useId();
  const [dados, setDados] = useState<RevisaoMidias | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    revisaoMidias.revisar(espaco).then((r) => {
      if (!vivo) return;
      setDados(r);
      setMarcadas(new Set(r.orfas.map((o) => o.caminho)));
    }).catch((e) => vivo && setErro(e instanceof ApiError ? e.message : "Não foi possível analisar as mídias."));
    return () => { vivo = false; };
  }, [espaco]);

  const bytesMarcados = useMemo(() => (dados?.orfas ?? []).filter((o) => marcadas.has(o.caminho)).reduce((t, o) => t + o.tamanho_bytes, 0), [dados, marcadas]);
  const alternar = (c: string) => setMarcadas((m) => { const n = new Set(m); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  async function descartar() {
    setOcupado(true);
    try {
      const r = await revisaoMidias.descartar([...marcadas]);
      aoConcluir(r.ignorados.length
        ? `${r.descartados.length} movidas para a lixeira; ${r.ignorados.length} não puderam ser movidas.`
        : `${r.descartados.length} ${r.descartados.length === 1 ? "mídia movida" : "mídias movidas"} para a lixeira.`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível mover as mídias.");
      setOcupado(false);
    }
  }

  const linha = (m: ItemRevisaoMidia, comCheck: boolean) => (
    <li key={m.caminho} className="flex items-center gap-2 py-1 text-sm">
      {comCheck
        ? <input type="checkbox" checked={marcadas.has(m.caminho)} onChange={() => alternar(m.caminho)} disabled={ocupado} aria-label={`Descartar ${m.nome}`} className="h-4 w-4 shrink-0 accent-steel-500" />
        : <span className={`h-2 w-2 shrink-0 rounded-full ${m.referenciada ? "bg-cyan" : "bg-text-muted/50"}`} aria-hidden />}
      <span className="min-w-0 flex-1 truncate text-text-primary" title={m.caminho}>{m.nome}</span>
      <span className="shrink-0 text-xs text-text-muted">{m.caminho.split("/")[2] ?? ""}</span>
      <span className="w-16 shrink-0 text-right text-xs text-text-muted">{tamanho(m.tamanho_bytes)}</span>
    </li>
  );

  return (
    <Dialog rotuloId={`${id}-t`} onFechar={() => !ocupado && aoFechar()}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface-1 p-5">
        <h2 id={`${id}-t`} className="text-lg font-semibold text-text-primary">Mídias órfãs e duplicadas</h2>
        {!dados && !erro && <p className="mt-4 text-sm text-text-muted">Analisando a biblioteca…</p>}
        {erro && <p role="alert" className="mt-3 text-sm text-error">{erro}</p>}
        {dados && (
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            <section>
              <h3 className="text-sm font-medium text-text-primary">Órfãs ({dados.orfas.length} · {tamanho(dados.bytes_orfas)})</h3>
              <p className="text-xs text-text-muted">Nenhuma nota ou tarefa usa estas mídias. Ao descartar, elas vão para a lixeira e podem ser restauradas.</p>
              {dados.orfas.length === 0 ? <p className="mt-2 text-sm text-text-muted">Nenhuma mídia órfã.</p> : <ul className="mt-1 divide-y divide-border/60">{dados.orfas.map((m) => linha(m, true))}</ul>}
            </section>
            <section className="mt-5">
              <h3 className="text-sm font-medium text-text-primary">Duplicadas ({dados.duplicadas.length} {dados.duplicadas.length === 1 ? "grupo" : "grupos"})</h3>
              <p className="text-xs text-text-muted">Arquivos com conteúdo idêntico. Ponto azul = alguma nota usa; cinza = órfã (e pode ser descartada acima). Cópias que notas usam não são mexidas.</p>
              {dados.duplicadas.map((g, i) => <ul key={i} className="mt-2 rounded-lg border border-border/60 px-2">{g.map((m) => linha(m, false))}</ul>)}
            </section>
          </div>
        )}
        <div className="mt-4 flex gap-3">
          <button type="button" disabled={ocupado} onClick={aoFechar} className="min-h-11 flex-1 rounded-xl bg-surface-2 px-4 text-sm font-medium text-text-primary disabled:opacity-40">Fechar</button>
          <button type="button" disabled={ocupado || !marcadas.size} onClick={descartar} className="min-h-11 flex-1 rounded-xl bg-steel-500 px-4 text-sm font-semibold text-white disabled:opacity-40">
            {ocupado ? "Movendo…" : `Mover ${marcadas.size} para a lixeira (${tamanho(bytesMarcados)})`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
