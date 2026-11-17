import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { CalendarRange, HandCoins } from "lucide-react";
import { vault, type MesPrevistoRecebido, type PrevistoRecebidoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { ErroLista, Vazio } from "../cadastros/CadastroLista";
import { mesCurto, mesesNoIntervalo } from "./formato";

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const LIMITE_MESES = 24;
const somar = (ms: MesPrevistoRecebido[]) => ms.reduce((s, m) => ({ previsto: s.previsto + m.previsto_centavos, recebido: s.recebido + m.recebido_centavos, aberto: s.aberto + m.em_aberto_centavos }), { previsto: 0, recebido: 0, aberto: 0 });

/** O que era para entrar e o que entrou, por residente e mês, com o que ficou em aberto em destaque. */
export function PrevistoRecebido({ de, ate, recarregar, aoAbrir }: { de: string; ate: string; recarregar: number; aoAbrir: (recorrenciaId: string) => void }) {
  const [dados, setDados] = useState<PrevistoRecebidoApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const longo = mesesNoIntervalo(de, ate) > LIMITE_MESES;

  useEffect(() => {
    if (longo) return;
    let vivo = true;
    setErro(null);
    setDados(null);
    vault.mensalidades.previstoRecebido({ data_de: de, data_ate: ate })
      .then((d) => { if (vivo) setDados(d); })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [de, ate, longo, tentativa, recarregar]);

  const total = useMemo(() => somar(dados?.totais ?? []), [dados]);

  if (longo) return <Vazio icone={<CalendarRange size={28} aria-hidden />} titulo="Período longo demais" texto="Escolha um período de até 24 meses para comparar o previsto com o recebido." />;
  if (erro) return <ErroLista mensagem={erro} aoTentar={() => setTentativa((n) => n + 1)} />;
  if (!dados) return <div className="cofre-cats-skeleton" role="status" aria-label="Carregando previsto e recebido">{[0, 1, 2].map((i) => <div key={i} style={estiloI(i)} />)}</div>;
  if (dados.linhas.length === 0) return <Vazio icone={<HandCoins size={28} aria-hidden />} titulo="Nada para comparar ainda" texto="Quando houver mensalidades cadastradas, aqui aparece o que era para entrar e o que entrou em cada mês." />;

  const umMes = dados.meses.length === 1;
  return (
    <>
      <div className="cofre-cats-trio cofre-rise" style={estiloI(1)}>
        <Resumo rotulo="Previsto no período" valor={total.previsto} />
        <Resumo rotulo="Recebido" valor={total.recebido} tom="pos" />
        <Resumo rotulo="Em aberto" valor={total.aberto} tom={total.aberto > 0 ? "neg" : undefined} />
      </div>
      <div className="cofre-card cofre-rec-lista cofre-rise" style={estiloI(2)}>
        <div className="cofre-rec-tabela-rolagem">
          <table className="cofre-rec-tabela mens-tabela" data-um-mes={umMes || undefined}>
            <caption className="sr-only">Previsto e recebido por residente e mês</caption>
            <thead>
              {umMes ? (
                <tr><th scope="col">Residente</th><th scope="col" className="num">Previsto</th><th scope="col" className="num">Recebido</th><th scope="col" className="num">Em aberto</th></tr>
              ) : (
                <tr><th scope="col">Residente</th>{dados.meses.map((m) => <th key={m} scope="col" className="num">{mesCurto(m)}</th>)}<th scope="col" className="num">Em aberto</th></tr>
              )}
            </thead>
            <tbody>
              {dados.linhas.map((l) => {
                const porMes = new Map(l.meses.map((m) => [m.mes, m]));
                const soma = somar(l.meses);
                const nome = l.beneficiario_nome?.trim() || l.descricao;
                return (
                  <tr key={l.recorrencia_id} onClick={() => aoAbrir(l.recorrencia_id)}>
                    <th scope="row"><button type="button" className="cofre-rec-titulo" aria-label={`Abrir ${nome}`}>{nome}</button></th>
                    {umMes ? (
                      <><td className="num cofre-mono">{formatMoeda(soma.previsto)}</td><td className="num cofre-mono">{formatMoeda(soma.recebido)}</td></>
                    ) : dados.meses.map((m) => <Celula key={m} mes={porMes.get(m)} />)}
                    <td className="num cofre-mono mens-aberto" data-ativo={soma.aberto > 0 || undefined}>{soma.aberto > 0 ? formatMoeda(soma.aberto) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                {umMes ? (
                  <><td className="num cofre-mono">{formatMoeda(total.previsto)}</td><td className="num cofre-mono">{formatMoeda(total.recebido)}</td></>
                ) : dados.meses.map((m) => <Celula key={m} mes={dados.totais.find((t) => t.mes === m)} />)}
                <td className="num cofre-mono mens-aberto" data-ativo={total.aberto > 0 || undefined}>{total.aberto > 0 ? formatMoeda(total.aberto) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {!umMes && <p className="cofre-rec-dica mens-legenda">Em cada mês: o que entrou, sobre o que era previsto. Em vermelho, o que ficou em aberto.</p>}
    </>
  );
}

/** Mês de um residente: recebido sobre previsto; o que faltou aparece em destaque. */
function Celula({ mes }: { mes: MesPrevistoRecebido | undefined }) {
  if (!mes || (mes.previsto_centavos === 0 && mes.recebido_centavos === 0)) return <td className="num mens-celula" data-vazia>—</td>;
  return (
    <td className="num mens-celula" data-aberto={mes.em_aberto_centavos > 0 || undefined}>
      <b className="cofre-mono">{formatMoeda(mes.recebido_centavos)}</b>
      <small className="cofre-mono">de {formatMoeda(mes.previsto_centavos)}</small>
      {mes.em_aberto_centavos > 0 && <em className="cofre-mono">falta {formatMoeda(mes.em_aberto_centavos)}</em>}
    </td>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: "pos" | "neg" }) {
  return <div className="cofre-card cofre-cats-card mens-resumo"><span>{rotulo}</span><b className="cofre-mono" data-tom={tom}>{formatMoeda(valor)}</b></div>;
}
