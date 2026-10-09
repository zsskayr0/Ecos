import { lazy, Suspense, useRef, useState } from "react";
import { X } from "lucide-react";
import { SeletorEcos } from "@/components/common/SeletorEcos";
import { vault, ApiError, type FormaPagamentoApi, type FormaPagamentoUsoApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { formasAtuais, useFormasPagamento } from "@/lib/formas-pagamento-store";
import { nomeJaExiste, registroReflete } from "@/lib/formas-pagamento";
import { avisar } from "@/lib/toast";
import { CORES, LixeiraAnimada, corDoTexto, resolverIcone } from "../VaultCategories";
import { SeletorCor } from "../contas/SeletorCor";
import { resultadoIndeterminado, useModalFoco } from "./useModalFoco";

const IconPicker = lazy(() => import("../IconPicker"));

export const ICONE_PADRAO_FORMA = "CreditCard";
export const COR_PADRAO_FORMA = CORES[7]!;

/** Criar ou editar uma forma de pagamento; apagar (só as que não são de fábrica) com destino quando há itens usando. */
export function FormaPagamentoModal({ forma, aoFechar, aoMudarDados }: {
  forma?: FormaPagamentoApi;
  aoFechar: () => void;
  /** Avisa que lançamentos/recorrências podem ter mudado (exclusão com destino) para as outras telas recarregarem. */
  aoMudarDados: () => void;
}) {
  const formas = useFormasPagamento();
  const [nome, setNome] = useState(forma?.nome ?? "");
  const [icone, setIcone] = useState(forma?.icone ?? ICONE_PADRAO_FORMA);
  const [cor, setCor] = useState(forma?.cor ?? COR_PADRAO_FORMA);
  const [ocupado, setOcupado] = useState(false);
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** "Não deu para confirmar": o formulário fica como está para tentar de novo. */
  const [indeterminado, setIndeterminado] = useState(false);
  /** Já existe uma forma igual ao que foi enviado (criação sem resposta). */
  const [existente, setExistente] = useState<FormaPagamentoApi | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [uso, setUso] = useState<FormaPagamentoUsoApi | null>(null);
  const [destino, setDestino] = useState("");
  const [saindo, setSaindo] = useState(false);
  const dialogo = useRef<HTMLFormElement>(null);
  const nomeRef = useRef<HTMLInputElement>(null);
  const Previa = resolverIcone(icone);

  function fechar() {
    setSaindo(true);
    window.setTimeout(aoFechar, 160);
  }
  useModalFoco(dialogo, fechar);

  const repetido = nomeJaExiste(formas.lista, nome, forma?.codigo);

  /** Recarrega e devolve a lista atual; `null` se não deu para ler. */
  async function conferir(): Promise<FormaPagamentoApi[] | null> {
    await formas.recarregar();
    return formasAtuais();
  }

  async function salvar() {
    const limpo = nome.trim();
    if (!limpo) { setErroNome("Informe um nome para a forma de pagamento."); nomeRef.current?.focus(); return; }
    setOcupado(true); setErro(null); setErroNome(null); setIndeterminado(false); setExistente(null);
    const enviado = { nome: limpo, icone, cor };
    try {
      if (forma) await vault.formasPagamento.atualizar(forma.codigo, enviado);
      else await vault.formasPagamento.criar(enviado);
      await formas.recarregar();
      avisar(forma ? "Forma de pagamento atualizada." : "Forma de pagamento criada.", "sucesso");
      aoFechar();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) { setErroNome(e.message); setOcupado(false); nomeRef.current?.focus(); return; }
      if (e instanceof ApiError && e.status === 403) { setErro("Você não tem permissão para alterar as formas de pagamento."); setOcupado(false); return; }
      if (!resultadoIndeterminado(e)) { setErro(e instanceof ApiError ? e.message : "Não foi possível salvar."); setOcupado(false); return; }
      // Sem resposta confiável: só afirma o resultado se a lista comprovar tudo o que foi enviado.
      const lista = await conferir();
      if (lista && forma && registroReflete(lista.find((f) => f.codigo === forma.codigo), enviado)) {
        avisar("Forma de pagamento atualizada.", "sucesso");
        aoFechar();
        return;
      }
      if (lista && !forma) {
        const igual = lista.find((f) => f.nome.trim().toLowerCase() === limpo.toLowerCase() && f.icone === icone && f.cor === cor);
        if (igual) { setExistente(igual); setOcupado(false); return; }
      }
      setIndeterminado(true);
      setOcupado(false);
    }
  }

  async function pedirExclusao() {
    if (!forma) return;
    setOcupado(true); setErro(null);
    try {
      const u = await vault.formasPagamento.uso(forma.codigo);
      if (u.transacoes + u.recorrencias === 0) { setUso(null); setConfirmando(true); }
      else { setConfirmando(false); setDestino(""); setUso(u); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { await formas.recarregar(); avisar("A forma de pagamento não existe mais.", "neutro"); aoMudarDados(); aoFechar(); return; }
      setErro(e instanceof ApiError ? e.message : "Não foi possível verificar o uso da forma de pagamento.");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(decisao?: { mover_para: string } | { sem_forma: true }) {
    if (!forma) return;
    setOcupado(true); setErro(null);
    try {
      const r = await vault.formasPagamento.excluir(forma.codigo, decisao);
      await formas.recarregar();
      aoMudarDados();
      avisar(r.movidos ? `Forma de pagamento excluída. ${r.movidos} ${r.movidos === 1 ? "item foi atualizado" : "itens foram atualizados"}.` : "Forma de pagamento excluída.", "sucesso");
      aoFechar();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // O uso mudou desde que o diálogo abriu (ou é de fábrica): olha de novo antes de pedir a decisão.
        await pedirExclusao();
        setErro(e.message);
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        const lista = await conferir();
        if (lista && !lista.some((f) => f.codigo === forma.codigo)) { aoMudarDados(); avisar("A forma de pagamento não existe mais.", "neutro"); aoFechar(); return; }
        setErro("O destino escolhido não existe mais. Escolha outro.");
        setOcupado(false);
        return;
      }
      if (resultadoIndeterminado(e)) {
        const lista = await conferir();
        if (lista && !lista.some((f) => f.codigo === forma.codigo)) {
          // Não prova que esta tentativa apagou, nem para onde foram os itens: mensagem neutra e dados recarregados.
          aoMudarDados();
          avisar("A forma de pagamento não existe mais.", "neutro");
          aoFechar();
          return;
        }
        setErro("Não deu para confirmar a exclusão. Confira a lista e tente de novo.");
        setOcupado(false);
        return;
      }
      setErro(e instanceof ApiError ? e.message : "Não foi possível apagar.");
      setOcupado(false);
    }
  }

  const aviso = repetido && !erroNome ? "Já existe uma forma com este nome. Se for igual, o servidor vai recusar." : null;
  const outras = formas.ativas.filter((f) => f.codigo !== forma?.codigo);

  return (
    <div className="cofre-cats-modal" data-saindo={saindo || undefined}>
      <div className="cofre-cats-backdrop" onClick={fechar} />
      <form ref={dialogo} className="cofre-card cofre-cats-dialog cofre-categoria-dialog" role="dialog" aria-modal="true" aria-label={forma ? "Editar forma de pagamento" : "Nova forma de pagamento"} onSubmit={(e) => { e.preventDefault(); void salvar(); }}>
        <header>
          <span className="cofre-cats-icon lg" style={{ background: cor, color: corDoTexto(cor) }}><Previa size={18} /></span>
          <div><p>{forma ? "EDITAR FORMA DE PAGAMENTO" : "NOVA FORMA DE PAGAMENTO"}</p><h2>{nome.trim() || "Sem nome"}</h2></div>
          <span className="cofre-cats-header-acoes">
            {forma && !forma.padrao && (
              <button type="button" className="cofre-cats-iconbtn cofre-cats-lixeira" aria-label="Apagar forma de pagamento" title="Apagar forma de pagamento" disabled={ocupado || confirmando || !!uso} onClick={() => void pedirExclusao()}>
                <LixeiraAnimada />
              </button>
            )}
            <button type="button" className="cofre-cats-iconbtn cofre-cats-fechar" aria-label="Fechar" onClick={fechar}><X size={18} /></button>
          </span>
        </header>

        {erro && <p className="cofre-launch-alert" role="alert">{erro}</p>}
        {indeterminado && <p className="cofre-launch-alert" role="alert">Não deu para confirmar se foi salvo. Seus dados continuam aqui: confira a lista ou tente de novo.</p>}
        {existente && (
          <div className="cofre-launch-alert" role="alert">
            <p>Já existe “{existente.nome}” com este ícone e esta cor. Pode ter sido criada agora ou antes.</p>
            <div><button type="button" onClick={() => setExistente(null)}>Voltar ao formulário</button><button type="button" onClick={() => { avisar("Usando a forma de pagamento que já existe.", "neutro"); aoFechar(); }}>Usar a forma existente</button></div>
          </div>
        )}

        <div className="cofre-contas-corpo cofre-categoria-corpo">
          <div className="cofre-contas-esq">
            <div className="cofre-cats-field">
              <span>Ícone</span>
              <Suspense fallback={<p className="cofre-cats-none">Carregando ícones…</p>}><IconPicker value={icone} onChange={setIcone} cor={cor} /></Suspense>
            </div>
          </div>
          <div className="cofre-contas-dir">
            <label className="cofre-cats-field">
              <span>Nome</span>
              <input ref={nomeRef} autoFocus value={nome} onChange={(e) => { setNome(e.target.value); setErroNome(null); }} placeholder="Ex.: Cartão de débito" maxLength={40} aria-invalid={!!erroNome || undefined} aria-describedby="forma-nome-ajuda" />
              <small id="forma-nome-ajuda" role={erroNome ? "alert" : undefined} style={{ color: erroNome ? "var(--ecos-error, #ef6c74)" : aviso ? "var(--ecos-warning, #f59e0b)" : "var(--text-faint)" }}>
                {erroNome ?? aviso ?? (forma?.padrao ? "Forma de fábrica: você pode renomear e desativar, mas não apagar." : "Até 40 caracteres.")}
              </small>
            </label>
            <div className="cofre-cats-field">
              <span>Cor</span>
              <SeletorCor valor={cor} onChange={setCor} />
            </div>
          </div>
        </div>

        {confirmando && forma && (
          <div className="cofre-launch-alert" role="alert">
            <p>Apagar “{forma.nome}”? Nenhum lançamento nem recorrência usa esta forma. Essa ação não pode ser desfeita.</p>
            <div><button type="button" onClick={() => setConfirmando(false)}>Cancelar</button><button type="button" disabled={ocupado} onClick={() => void excluir()}>{ocupado ? "Apagando…" : "Apagar"}</button></div>
          </div>
        )}

        {uso && forma && (
          <section className="cofre-launch-alert cofre-cats-uso" role="alert" aria-label={`Apagar ${forma.nome}`}>
            <p>
              “{forma.nome}” é usada por <b>{uso.transacoes} {uso.transacoes === 1 ? "lançamento" : "lançamentos"}</b>
              {uso.recorrencias > 0 && <> e <b>{uso.recorrencias} {uso.recorrencias === 1 ? "recorrência" : "recorrências"}</b></>}.
              Escolha para onde eles vão antes de apagar.
            </p>
            {uso.amostra.length > 0 && (
              <ul className="cofre-cats-uso-lista" aria-label="Lançamentos desta forma de pagamento">
                {uso.amostra.map((t) => (
                  <li key={t.id}>
                    <time>{t.data.split("-").reverse().join("/")}</time>
                    <span>{t.descricao}</span>
                    <strong data-tipo={t.tipo}>{t.tipo === "entrada" ? "+" : "−"}{formatMoeda(t.valor_centavos)}</strong>
                  </li>
                ))}
                {uso.transacoes > uso.amostra.length && <li className="cofre-cats-uso-mais">e mais {uso.transacoes - uso.amostra.length} {uso.transacoes - uso.amostra.length === 1 ? "lançamento" : "lançamentos"}</li>}
              </ul>
            )}
            <div className="cofre-cats-field">
              <span>Mover tudo para</span>
              <SeletorEcos ariaLabel="Mover tudo para" classe="min-h-[40px] max-w-full rounded-[11px] border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px] text-[var(--text)]" valor={destino} onChange={setDestino} opcoes={[{ valor: "", rotulo: "Deixar sem forma de pagamento" }, ...outras.map((f) => ({ valor: f.codigo, rotulo: f.nome }))]} />
            </div>
            <div>
              <button type="button" onClick={() => setUso(null)} disabled={ocupado}>Cancelar</button>
              <button type="button" disabled={ocupado} onClick={() => void excluir(destino ? { mover_para: destino } : { sem_forma: true })}>
                {ocupado ? "Movendo e apagando…" : destino ? "Mover e apagar" : "Deixar sem forma e apagar"}
              </button>
            </div>
          </section>
        )}

        <footer>
          <button type="button" className="cofre-secondary" onClick={fechar}>Cancelar</button>
          <button type="submit" className="cofre-solid" disabled={ocupado || !nome.trim()}>{ocupado && !confirmando && !uso ? "Salvando…" : indeterminado ? "Tentar de novo" : forma ? "Salvar" : "Criar forma"}</button>
        </footer>
      </form>
    </div>
  );
}
