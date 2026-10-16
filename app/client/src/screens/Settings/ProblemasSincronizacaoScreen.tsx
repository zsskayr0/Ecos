import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { EstadoCarregando } from "@/components/common/EstadoCarregando";
import { EstadoErro } from "@/components/common/EstadoErro";
import { EmptyState } from "@/components/common/EmptyState";
import { calendario, problemasSync, type AcaoProblema, type ProblemaSync } from "@/lib/api";
import { mensagemDeErro } from "@/lib/erros";
import { useRefreshBus } from "@/lib/refresh-bus";
import { Cabecalho } from "./campos-config";

type Agir = Exclude<AcaoProblema, "abrir" | "reautorizar">;

const ROTULO: Record<AcaoProblema, string> = {
  tentar_de_novo: "Tentar de novo",
  abrir: "Abrir o evento",
  manter_local: "Manter o do Ecos",
  manter_google: "Manter o do Google",
  manter_ambos: "Guardar as duas versões",
  desvincular: "Desvincular do Google",
  ignorar: "Ignorar",
  reautorizar: "Reautorizar o Google",
};

/** O que cada ação confirmada faz, dito sem rodeios, antes de a pessoa confirmar. */
const CONFIRMACAO: Partial<Record<AcaoProblema, string>> = {
  manter_local: "A versão do Ecos vai sobrescrever a do Google. O que foi mudado lá será perdido.",
  manter_google: "A mudança feita aqui será descartada e a versão do Google passa a valer.",
  manter_ambos: "Sua versão será guardada como um evento privado \"(versão local)\" e a do Google passa a valer no evento original.",
  desvincular: "O evento deixa de ser sincronizado e fica só no Ecos, como privado. Nada é apagado no Google.",
};

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const OPERACAO: Record<string, string> = { atualizar: "envio de alteração", criar: "envio de evento novo", apagar: "exclusão no Google", excecao: "ocorrência de série" };

/** "Problemas de sincronização": cada item que o Google recusou, o motivo em português e o que fazer. */
export function ProblemasSincronizacaoScreen() {
  const navigate = useNavigate();
  const { notificar } = useRefreshBus();
  const [itens, setItens] = useState<ProblemaSync[] | null>(null);
  const [ignorados, setIgnorados] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [precisaReautorizar, setPrecisaReautorizar] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<{ id: string; acao: Agir } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const [p, c] = await Promise.all([problemasSync.listar(), calendario.config()]);
      setItens(p.items);
      setIgnorados(p.ignorados);
      setPrecisaReautorizar(c.conectados.some((x) => x.provider === "google" && x.precisa_reconectar));
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível carregar os problemas de sincronização.")); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function executar(chave: string, fn: () => Promise<string | void>) {
    setOcupado(chave); setAviso(null); setErro(null);
    try {
      const msg = await fn();
      if (msg) setAviso(msg);
      setConfirmando(null);
      notificar();
      await carregar();
    } catch (e) { setErro(mensagemDeErro(e, "Não foi possível concluir a ação. Nada foi alterado.")); }
    finally { setOcupado(null); }
  }

  const tentarTodos = () => executar("todos", async () => {
    const r = await problemasSync.tentarTodos();
    return r.problemas_abertos ? `${r.problemas_abertos} problema(s) continuam abertos.` : "Tudo sincronizado, sem problemas abertos.";
  });

  const reautorizar = () => executar("reautorizar", async () => {
    const { url } = await calendario.conectar("google");
    window.open(url, "_blank", "noopener,noreferrer");
    return "Autorize no Google na nova janela e volte aqui.";
  });

  function clicar(p: ProblemaSync, acao: AcaoProblema) {
    if (acao === "abrir") { navigate(`/agenda?evento=${encodeURIComponent(p.item_id)}`); return; }
    if (acao === "reautorizar") { void reautorizar(); return; }
    if (CONFIRMACAO[acao]) { setConfirmando({ id: p.id, acao }); return; }
    void executar(`${p.id}:${acao}`, async () => { await problemasSync.agir(p.id, acao); });
  }

  const botao = "min-h-10 rounded-xl px-3 text-sm font-medium disabled:opacity-40";

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Problemas de sincronização" />

      {precisaReautorizar && (
        <div role="alert" className="mb-4 rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} aria-hidden />O Google revogou o acesso do Ecos</p>
          <p className="mt-1 text-xs text-text-secondary">Enquanto não reconectar, nada é sincronizado. Seus eventos e dados continuam no Ecos. Se isso se repete a cada poucos dias, o app OAuth do Google pode estar em modo de teste (os acessos expiram em 7 dias): veja a documentação do Google Calendar.</p>
          <button type="button" onClick={() => void reautorizar()} disabled={ocupado !== null} className={`${botao} mt-2 bg-cyan text-black`}>{ROTULO.reautorizar}</button>
        </div>
      )}

      {erro && <EstadoErro mensagem={erro} onTentarDeNovo={() => void carregar()} />}
      {aviso && <p role="status" className="mb-3 text-sm text-text-secondary">{aviso}</p>}

      {itens === null ? (erro ? null : <EstadoCarregando texto="Carregando…" />) : itens.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Nenhum problema de sincronização." subtitle={ignorados ? `${ignorados} ignorado(s). Eles continuam sendo tentados em segundo plano.` : "Quando o Google recusar algum evento, ele aparece aqui com o motivo e o que fazer."} />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">{itens.length} aberto{itens.length === 1 ? "" : "s"}{ignorados ? ` · ${ignorados} ignorado(s)` : ""}</p>
            <button type="button" onClick={() => void tentarTodos()} disabled={ocupado !== null} className={`${botao} flex items-center gap-1.5 bg-surface-2 text-text-primary`}>
              {ocupado === "todos" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}Tentar de novo todos
            </button>
          </div>
          <ul className="space-y-3">
            {itens.map((p) => (
              <li key={p.id} className="rounded-2xl border border-border bg-surface-1 p-4" data-testid="problema">
                <p className="text-xs text-text-muted">{OPERACAO[p.operacao] ?? p.operacao} · {p.tentativas} tentativa{p.tentativas === 1 ? "" : "s"} · desde {quando(p.primeira_vez)}</p>
                <p className="mt-1 text-[15px] font-semibold text-text-primary">{p.item_titulo}</p>
                <p className="mt-1 text-sm font-medium text-error">{p.titulo}</p>
                <p className="mt-1 text-sm text-text-secondary">{p.explicacao}</p>
                {p.motivo_google && <p className="mt-1 text-xs text-text-muted">Resposta do Google{p.http_status ? ` (${p.http_status})` : ""}: {p.motivo_google}</p>}
                {confirmando?.id === p.id ? (
                  <div role="alertdialog" aria-label={`Confirmar: ${ROTULO[confirmando.acao]}`} className="mt-3 rounded-xl bg-surface-2 p-3">
                    <p className="text-sm text-text-primary">{ROTULO[confirmando.acao]}?</p>
                    <p className="mt-1 text-xs text-text-secondary">{CONFIRMACAO[confirmando.acao]}</p>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => setConfirmando(null)} disabled={ocupado !== null} className={`${botao} bg-surface-1 text-text-primary`}>Cancelar</button>
                      <button type="button" onClick={() => void executar(`${p.id}:${confirmando.acao}`, async () => { await problemasSync.agir(p.id, confirmando.acao, true); })} disabled={ocupado !== null} className={`${botao} bg-error text-white`}>{ocupado ? "Aplicando…" : "Confirmar"}</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.acoes.map((a) => (
                      <button key={a} type="button" onClick={() => clicar(p, a)} disabled={ocupado !== null} className={`${botao} ${a === "ignorar" ? "text-text-muted hover:bg-surface-2" : "bg-surface-2 text-text-primary hover:bg-surface-3"}`}>{ROTULO[a]}</button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
