import { useState, type CSSProperties } from "react";
import { ArrowLeftRight, CheckCircle2, Plus, TriangleAlert, X } from "lucide-react";
import { ApiError, vault, type CategoriaApi, type FechamentoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { CampoCategoria } from "../CampoCategoria";
import { categoriasSugeridasParaTransferencia } from "./analise";

const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Transferências entre contas próprias: dinheiro que saiu de uma conta e entrou em outra não é receita nem despesa.
 * A pessoa diz quais categorias representam isso; o Fechamento tira esses lançamentos de entradas, saídas e resultado
 * e mostra o líquido por conta, e aqui avisa quando falta lançar o outro lado.
 */
export function TransferenciasEntreContas({ transferencias, categorias, idLucros, aoMudar }: {
  transferencias: FechamentoApi["transferencias"];
  categorias: CategoriaApi[];
  /** Categoria de lucros escolhida, para não sugerir a mesma como transferência. */
  idLucros: string | null;
  aoMudar: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const escolhidas = transferencias.categorias;
  const ids = escolhidas.map((c) => c.id);
  const sugeridas = categoriasSugeridasParaTransferencia(categorias, ids, idLucros);
  const opcoes = categorias.filter((c) => !c.arquivada && !ids.includes(c.id) && c.id !== idLucros);

  async function gravar(novos: string[]) {
    setErro(null);
    setOcupado(true);
    try {
      await vault.fechamento.definirTransferencias(novos);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível guardar as categorias de transferência.");
    } finally {
      setOcupado(false);
    }
  }

  if (!transferencias.configurada) {
    return (
      <section className="fech-bloco cofre-rise" style={estiloI(4)} aria-label="Transferências entre contas">
        <header><h2>Transferências entre contas</h2></header>
        <div className="cofre-card fech-lucros-vazio">
          <ArrowLeftRight size={26} aria-hidden />
          <p><b>Há dinheiro que muda de uma conta sua para outra?</b></p>
          <small>Marque as categorias usadas nessas movimentações. Elas deixam de contar como entrada e saída (não são receita nem despesa) e aparecem à parte no extrato de cada conta.</small>
          <div className="fech-lucros-acoes">
            {sugeridas.length > 0 && (
              <button type="button" className="cofre-solid" disabled={ocupado} onClick={() => void gravar(sugeridas.map((c) => c.id))}>
                <Plus size={14} aria-hidden />Usar {sugeridas.map((c) => `“${c.nome}”`).join(" e ")}
              </button>
            )}
            {opcoes.length > 0 && <div className="fech-lucros-seletor"><CampoCategoria categorias={opcoes} valor={null} onChange={(id) => { if (id) void gravar([id]); }} ariaLabel="Marcar uma categoria como transferência" placeholder={sugeridas.length > 0 ? "Ou escolher outra…" : "Escolher a categoria…"} /></div>}
          </div>
          {erro && <small role="alert" className="fech-erro">{erro}</small>}
        </div>
      </section>
    );
  }

  return (
    <section className="fech-bloco cofre-rise" style={estiloI(4)} aria-label="Transferências entre contas">
      <header>
        <h2>Transferências entre contas</h2>
        <p>Ficam fora de entradas, saídas e resultado; o líquido de cada conta está no extrato.</p>
      </header>
      <div className="cofre-card fech-transf">
        <ul className="fech-chips" aria-label="Categorias marcadas como transferência">
          {escolhidas.map((c) => (
            <li key={c.id} className="fech-chip">
              <span>{c.nome}</span>
              <button type="button" disabled={ocupado} onClick={() => void gravar(ids.filter((i) => i !== c.id))} aria-label={`Deixar de tratar “${c.nome}” como transferência`}><X size={12} aria-hidden /></button>
            </li>
          ))}
        </ul>
        {opcoes.length > 0 && <div className="fech-lucros-seletor"><CampoCategoria categorias={opcoes} valor={null} onChange={(id) => { if (id) void gravar([...ids, id]); }} ariaLabel="Marcar mais uma categoria como transferência" placeholder="Adicionar categoria…" /></div>}
        <div className="fech-lucros-resumo">
          <span>{plural(transferencias.quantidade, "lançamento", "lançamentos")} no período:{" "}
            <b className="cofre-mono">{formatMoeda(transferencias.entradas)}</b> entrando e <b className="cofre-mono">{formatMoeda(transferencias.saidas)}</b> saindo</span>
          {transferencias.quantidade === 0
            ? null
            : transferencias.equilibrada
              ? <span className="fech-selo" data-tom="ok"><CheckCircle2 size={13} aria-hidden />Se compensam</span>
              : <span className="fech-selo" data-tom="alerta"><TriangleAlert size={13} aria-hidden />Faltam {formatMoeda(Math.abs(transferencias.liquido))} {transferencias.liquido < 0 ? "entrando em alguma conta" : "saindo de alguma conta"}</span>}
        </div>
        {erro && <small role="alert" className="fech-erro">{erro}</small>}
      </div>
    </section>
  );
}
