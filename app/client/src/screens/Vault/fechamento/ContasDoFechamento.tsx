import { useState } from "react";
import { ApiError, vault, type FechamentoContaDisponivelApi } from "@/lib/api";
import { SeloConta } from "../contas/SeloConta";

/**
 * Quais contas entram no Fechamento. Uma conta desmarcada some do extrato, dos totais, das pendências e do pacote
 * para a contabilidade (os lançamentos dela continuam no Cofre). Conta nova entra sozinha.
 */
export function ContasDoFechamento({ contas, aoMudar }: { contas: FechamentoContaDisponivelApi[]; aoMudar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const dentro = contas.filter((c) => !c.fora).length;

  async function alternar(id: string) {
    const fora = contas.filter((c) => (c.id === id ? !c.fora : c.fora)).map((c) => c.id);
    setErro(null);
    setOcupado(true);
    try {
      await vault.fechamento.definirContas(fora);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível guardar a escolha das contas.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="cofre-card fech-contas-escolha">
      <p className="fech-contas-dica">Marque as contas que entram no fechamento. As desmarcadas ficam fora do extrato, dos totais, das pendências e do pacote — os lançamentos delas continuam no Cofre.</p>
      <ul className="fech-contas-lista" aria-label="Contas que entram no fechamento">
        {contas.map((c) => (
          <li key={c.id}>
            <label className="fech-conta-opcao">
              <input type="checkbox" checked={!c.fora} disabled={ocupado} onChange={() => void alternar(c.id)} />
              <SeloConta nome={c.nome} cor={c.cor} codigoBanco={c.codigo_banco} sigla={c.sigla} tamanho="sm" />
              <span>{c.nome}</span>
            </label>
          </li>
        ))}
      </ul>
      <small className="fech-nada">{dentro} de {contas.length} {contas.length === 1 ? "conta" : "contas"} no fechamento</small>
      {erro && <small role="alert" className="fech-erro">{erro}</small>}
    </div>
  );
}
