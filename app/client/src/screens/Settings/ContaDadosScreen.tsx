import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, Download, Loader2 } from "lucide-react";
import { ApiError, FRASE_EXCLUIR_CONTA, conta } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { baixarArquivo } from "@/lib/baixar-arquivo";

const mensagem = (e: unknown, padrao: string) => (e instanceof ApiError || e instanceof Error ? e.message : padrao);

/**
 * Conta e dados (LGPD): a pessoa leva os próprios dados embora (`GET /me/export`, um `.zip` com notas, tarefas e
 * anexos) e apaga a conta (`DELETE /me`, com a frase de confirmação) sem falar com o operador do servidor.
 */
export function ContaDadosScreen() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const idFrase = useId();
  const [exportando, setExportando] = useState(false);
  const [exportado, setExportado] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [frase, setFrase] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);
  const [concluida, setConcluida] = useState<string[] | null>(null);

  async function exportar() {
    setExportando(true);
    setExportado(false);
    setErroExportar(null);
    try {
      const zip = await conta.exportar();
      const carimbo = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
      baixarArquivo(zip, `ecos-exportacao-${carimbo}.zip`);
      setExportado(true);
    } catch (e) {
      setErroExportar(mensagem(e, "Não foi possível gerar a exportação. Tente novamente."));
    } finally {
      setExportando(false);
    }
  }

  async function excluir() {
    setExcluindo(true);
    setErroExcluir(null);
    try {
      const { avisos } = await conta.excluir();
      setConcluida(avisos ?? []);
    } catch (e) {
      setErroExcluir(mensagem(e, "Não foi possível excluir a conta. Nada foi apagado; tente novamente."));
    } finally {
      setExcluindo(false);
    }
  }

  // A conta já não existe no servidor; sair limpa o que ficou neste aparelho (token, sessão nativa) e volta ao login.
  const concluir = () => { void logout().catch(() => undefined); };

  if (concluida) {
    return (
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
        <div role="status" className="mt-10 flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={36} strokeWidth={1.5} className="text-success" aria-hidden />
          <h1 className="font-display text-xl text-text-primary">Conta excluída</h1>
          <p className="max-w-sm text-sm text-text-secondary">Sua conta, suas notas, tarefas, anexos e o Cofre foram apagados deste servidor. Isso não pode ser desfeito.</p>
          {concluida.length > 0 && (
            <ul className="max-w-sm list-disc pl-5 text-left text-xs text-text-muted">
              {concluida.map((aviso) => <li key={aviso}>{aviso}</li>)}
            </ul>
          )}
          <button type="button" onClick={concluir} className="mt-3 min-h-11 rounded-2xl bg-surface-2 px-6 text-sm font-semibold text-text-primary">Concluir</button>
        </div>
      </div>
    );
  }

  const fraseCorreta = frase === FRASE_EXCLUIR_CONTA;

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted" aria-label="Voltar">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Conta e dados</h1>
      </div>

      <section aria-labelledby="exportar-titulo" className="mb-8 rounded-2xl bg-surface-1 p-4">
        <h2 id="exportar-titulo" className="mb-1 text-[15px] font-semibold text-text-primary">Exportar meus dados</h2>
        <p className="mb-4 text-sm text-text-secondary">
          Baixe um arquivo <span className="font-mono-value">.zip</span> com suas notas e tarefas (arquivos .md), os anexos, a foto de perfil e um resumo da conta.
          Também entram os itens que você criou em equipes. O Cofre financeiro e a lixeira não entram; o Cofre tem exportação própria.
        </p>
        <button
          type="button"
          onClick={() => void exportar()}
          disabled={exportando}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 py-3 text-sm font-semibold text-text-primary disabled:opacity-60"
        >
          {exportando ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Download size={16} strokeWidth={1.75} aria-hidden />}
          {exportando ? "Gerando arquivo…" : "Exportar meus dados"}
        </button>
        <div aria-live="polite">
          {exportado && <p className="mt-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 size={16} aria-hidden />Arquivo gerado. Confira sua pasta de downloads.</p>}
          {erroExportar && <p role="alert" className="mt-3 text-sm text-error">{erroExportar}</p>}
        </div>
      </section>

      <section aria-labelledby="excluir-titulo" className="rounded-2xl border border-error/40 bg-error/[0.06] p-4">
        <h2 id="excluir-titulo" className="mb-2 flex items-center gap-2 text-sm font-semibold text-error">
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
          Excluir minha conta
        </h2>
        <p className="mb-2 text-sm text-text-secondary">Isto apaga do servidor, <strong className="font-semibold text-text-primary">de forma permanente</strong>:</p>
        <ul className="mb-3 list-disc pl-5 text-sm text-text-secondary">
          <li>sua conta, senha e todas as sessões abertas (em todos os aparelhos);</li>
          <li>suas notas, tarefas e anexos do espaço Pessoal, e o que está na lixeira;</li>
          <li>a foto de perfil, a rotina, as notificações e os dispositivos pareados;</li>
          <li>todos os dados do Cofre: transações, categorias e contas.</li>
        </ul>
        <p className="mb-2 text-sm text-text-secondary">
          <strong className="font-semibold text-text-primary">Equipes:</strong> você sai de todas. Equipes em que você é a única pessoa são apagadas junto, com todo o conteúdo.
          Nas equipes que continuam com outras pessoas, os itens que você criou permanecem para elas, sem o seu nome.
          Se você é dono de uma equipe com outras pessoas, transfira a propriedade antes: enquanto isso, a exclusão é recusada.
        </p>
        <p className="mb-4 text-sm text-text-secondary">
          <strong className="font-semibold text-text-primary">Não pode ser desfeito.</strong> Cópias de segurança que o servidor já tenha gerado (inclusive a que o Cofre tira antes de ser apagado) não são removidas por esta ação. Exporte seus dados antes, se quiser guardá-los.
        </p>

        {!confirmando ? (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="min-h-11 w-full rounded-2xl border border-error/50 py-3 text-center text-sm font-semibold text-error"
          >
            Excluir minha conta
          </button>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => { e.preventDefault(); if (fraseCorreta && !excluindo) void excluir(); }}
          >
            <label htmlFor={idFrase} className="text-xs text-text-secondary">
              Digite <span className="font-mono-value text-text-primary">{FRASE_EXCLUIR_CONTA}</span> para confirmar.
            </label>
            <input
              id={idFrase}
              value={frase}
              onChange={(e) => setFrase(e.target.value)}
              className="ecos-input"
              placeholder={FRASE_EXCLUIR_CONTA}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              disabled={excluindo}
            />
            {erroExcluir && <p role="alert" className="text-sm text-error">{erroExcluir}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={excluindo}
                onClick={() => { setConfirmando(false); setFrase(""); setErroExcluir(null); }}
                className="min-h-11 flex-1 rounded-2xl bg-surface-2 py-2.5 text-sm font-medium text-text-primary disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!fraseCorreta || excluindo}
                className="min-h-11 flex-1 rounded-2xl bg-error py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {excluindo ? "Excluindo…" : "Excluir permanentemente"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
