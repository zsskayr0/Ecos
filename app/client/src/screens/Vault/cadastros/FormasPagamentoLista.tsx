import { useMemo, useState } from "react";
import { CreditCard, Pencil, Plus } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { ApiError, vault, type FormaPagamentoApi } from "@/lib/api";
import { formasAtuais, useFormasPagamento } from "@/lib/formas-pagamento-store";
import { casaBusca } from "@/lib/texto-busca";
import { avisar } from "@/lib/toast";
import { corDoTexto, resolverIcone } from "../VaultCategories";
import { CabecalhoLista, CampoBusca, ErroLista, Esqueleto, Vazio } from "./CadastroLista";
import { COR_PADRAO_FORMA, ICONE_PADRAO_FORMA } from "./FormaPagamentoModal";
import { resultadoIndeterminado } from "./useModalFoco";

export function FormaIcone({ forma, tamanho = 16 }: { forma: Pick<FormaPagamentoApi, "icone" | "cor">; tamanho?: number }) {
  const cor = forma.cor ?? COR_PADRAO_FORMA;
  const Icone = resolverIcone(forma.icone ?? ICONE_PADRAO_FORMA);
  return <span className="cofre-cats-icon" style={{ background: cor, color: corDoTexto(cor) }} aria-hidden><Icone size={tamanho} /></span>;
}

export function FormasPagamentoLista({ aoEditar, aoNovo }: { aoEditar: (f: FormaPagamentoApi) => void; aoNovo: () => void }) {
  const formas = useFormasPagamento();
  const [busca, setBusca] = useState("");
  /** Códigos com um PATCH de ativar/desativar em andamento. */
  const [mudando, setMudando] = useState<Set<string>>(new Set());
  const visiveis = useMemo(() => formas.lista.filter((f) => casaBusca(busca, `${f.nome} ${f.codigo}`)), [formas.lista, busca]);

  async function definirAtiva(f: FormaPagamentoApi, ativa: boolean, desfazer = false) {
    setMudando((s) => new Set(s).add(f.codigo));
    try {
      await vault.formasPagamento.atualizar(f.codigo, { ativa });
      await formas.recarregar();
      if (desfazer) avisar(`“${f.nome}” voltou a ficar ${ativa ? "ativa" : "inativa"}.`, "sucesso");
      else avisar(ativa ? `“${f.nome}” ativada.` : `“${f.nome}” desativada. Lançamentos antigos continuam mostrando o nome.`, "sucesso", { rotulo: "Desfazer", aoClicar: () => void aoDesfazer(f, ativa) });
    } catch (e) {
      if (resultadoIndeterminado(e)) {
        await formas.recarregar();
        const atual = formasAtuais()?.find((x) => x.codigo === f.codigo);
        if (atual?.ativa === ativa) avisar(ativa ? `“${f.nome}” ativada.` : `“${f.nome}” desativada.`, "sucesso");
        else avisar("Não deu para confirmar a alteração. Confira a lista e tente de novo.", "erro");
      } else if (e instanceof ApiError && e.status === 403) avisar("Você não tem permissão para alterar as formas de pagamento.", "erro");
      else avisar(e instanceof ApiError ? e.message : "Não foi possível alterar a forma de pagamento.", "erro");
    } finally {
      setMudando((s) => { const n = new Set(s); n.delete(f.codigo); return n; });
    }
  }

  /** Só desfaz se a forma ainda está como esta ação a deixou; se outra pessoa mexeu, avisa em vez de restaurar. */
  async function aoDesfazer(f: FormaPagamentoApi, ativaAplicada: boolean) {
    await formas.recarregar();
    const atual = formasAtuais()?.find((x) => x.codigo === f.codigo);
    if (!atual) { avisar("A forma de pagamento não existe mais.", "neutro"); return; }
    if (atual.ativa !== ativaAplicada) { avisar(`Outra alteração já mudou “${f.nome}”. Nada foi desfeito.`, "neutro"); return; }
    await definirAtiva(atual, !ativaAplicada, true);
  }

  if (formas.erro && formas.indisponivel) return <ErroLista mensagem={formas.erro} aoTentar={() => void formas.recarregar()} />;
  if (formas.carregando || formas.indisponivel) return <Esqueleto rotulo="Carregando formas de pagamento" />;

  const todasInativas = formas.lista.length > 0 && formas.ativas.length === 0;

  return (
    <section aria-label="Formas de pagamento">
      <CabecalhoLista titulo="Formas de pagamento" contagem={`${formas.lista.length} cadastradas`}>
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar forma de pagamento" />
      </CabecalhoLista>
      {todasInativas && <p className="cofre-launch-alert" role="status">Todas as formas estão inativas: novos lançamentos só poderão ficar “sem forma”. Ative alguma ou crie uma nova.</p>}
      {visiveis.length === 0 ? (
        <Vazio icone={<CreditCard size={30} aria-hidden />} titulo="Nenhuma forma encontrada" texto={busca ? "Tente outro nome." : undefined}
          acao={<button type="button" className="cofre-solid" onClick={aoNovo}><Plus size={14} aria-hidden />Nova forma</button>} />
      ) : (
        <ul className="cofre-card cad-lista">
          {visiveis.map((f) => (
            <li key={f.codigo} className="cad-linha" data-inativa={!f.ativa || undefined}>
              <button type="button" className="cad-linha-principal" aria-label={`Editar ${f.nome}`} onClick={() => aoEditar(f)}>
                <FormaIcone forma={f} />
                <span className="cad-linha-texto">
                  <span className="cad-linha-nome"><b>{f.nome}</b>{f.padrao && <em>De fábrica</em>}{!f.ativa && <em className="cad-inativa">Inativa</em>}</span>
                  <small>{f.usos === 0 ? "Sem uso ainda" : `Usada em ${f.usos} ${f.usos === 1 ? "item" : "itens"}`}</small>
                </span>
                <Pencil size={13} className="cofre-cats-edit" aria-hidden />
              </button>
              <Toggle checked={f.ativa} disabled={mudando.has(f.codigo)} label={`${f.ativa ? "Desativar" : "Ativar"} ${f.nome}`} onChange={(v) => void definirAtiva(f, v)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
