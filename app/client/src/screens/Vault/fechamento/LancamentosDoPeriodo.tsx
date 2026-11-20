import { useEffect, useState, type CSSProperties } from "react";
import { Paperclip } from "lucide-react";
import { vault, type FechamentoLancamentoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { formatBR } from "../nexus/period";

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const POR_VEZ = 200;

/**
 * Todos os lançamentos efetivados do período, um por linha (a mesma lista da planilha do pacote): o Fechamento não é só
 * um resumo, quem confere precisa ver cada lançamento. Respeita as contas escolhidas para o fechamento.
 */
export function LancamentosDoPeriodo({ de, ate, versao, abrir }: { de: string; ate: string; versao: number; abrir: (id: string) => void }) {
  const [lista, setLista] = useState<FechamentoLancamentoApi[] | null>(null);
  const [cortado, setCortado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrando, setMostrando] = useState(POR_VEZ);

  useEffect(() => { setLista(null); setMostrando(POR_VEZ); }, [de, ate]);
  useEffect(() => {
    let vivo = true;
    setErro(null);
    vault.fechamento.lancamentos({ data_de: de, data_ate: ate })
      .then((r) => { if (vivo) { setLista(r.lancamentos); setCortado(r.cortado); } })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [de, ate, versao]);

  const visiveis = lista?.slice(0, mostrando) ?? [];
  return (
    <section className="fech-bloco cofre-rise" style={estiloI(5)} aria-label="Lançamentos do período">
      <header>
        <h2>Lançamentos do período</h2>
        {lista && <p>{lista.length} {lista.length === 1 ? "lançamento efetivado" : "lançamentos efetivados"}</p>}
      </header>
      {erro && <p role="alert" className="fech-erro">{erro}</p>}
      {!lista && !erro && <div className="cofre-card fech-lanc-carregando" role="status">Carregando os lançamentos…</div>}
      {lista && lista.length === 0 && <div className="cofre-card cofre-cats-empty"><p>Nenhum lançamento efetivado neste período</p></div>}
      {lista && lista.length > 0 && (
        <div className="cofre-card cofre-rec-lista">
          <div className="cofre-rec-tabela-rolagem">
            <table className="cofre-rec-tabela fech-tabela fech-lanc">
              <caption className="sr-only">Lançamentos efetivados do período, do mais antigo ao mais novo</caption>
              <thead>
                <tr>
                  <th scope="col">Data</th><th scope="col">Conta</th><th scope="col">Descrição</th><th scope="col">Categoria</th><th scope="col" className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => (
                  <tr key={l.id}>
                    <td className="cofre-mono fech-lanc-data">{formatBR(l.data)}</td>
                    <td>{l.conta}</td>
                    <td>
                      <button type="button" className="fech-link fech-lanc-abrir" onClick={() => abrir(l.id)} aria-label={`Abrir lançamento ${l.descricao}, ${formatBR(l.data)}`}>{l.descricao}</button>
                      {(l.beneficiario || l.arquivos > 0) && (
                        <small>{l.beneficiario}{l.beneficiario && l.arquivos > 0 ? " · " : ""}{l.arquivos > 0 && <><Paperclip size={10} aria-hidden /> {l.arquivos}</>}</small>
                      )}
                    </td>
                    <td>{l.categoria ?? <span className="fech-nada">Sem categoria</span>}{l.transferencia && <small>Transferência entre contas</small>}</td>
                    <td className={`num cofre-mono ${l.tipo === "entrada" ? "fech-pos" : "fech-neg"}`}>{l.tipo === "saida" ? "−" : ""}{formatMoeda(l.valor_centavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lista.length > mostrando && (
            <div className="fech-lanc-mais">
              <button type="button" className="cofre-secondary" onClick={() => setMostrando((m) => m + POR_VEZ)}>Mostrar mais {Math.min(POR_VEZ, lista.length - mostrando)} de {lista.length - mostrando} restantes</button>
            </div>
          )}
        </div>
      )}
      {cortado && <p role="status" className="cofre-rec-dica">A lista foi cortada no limite do servidor. Escolha um período menor para ver todos.</p>}
    </section>
  );
}
