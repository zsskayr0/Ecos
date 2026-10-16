import { AlertTriangle, CheckCircle2, FileJson, RotateCcw, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { FRASE_MIGRACAO_NEXUS, financeiro } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { contarPacote, dividirEmLotes, juntarRelatorios, lerPacote } from "./migracao-nexus";
import type { PacoteNexus, RelatorioNexus } from "./types";

const TAMANHO_MAXIMO = 120 * 1024 * 1024;
const ROTULOS: Record<string, string> = { categorias: "Categorias", beneficiarios: "Pagadores/recebedores", contas: "Contas", recorrencias: "Recorrências", lancamentos: "Lançamentos", pendencias: "Pendências", exclusoes: "Ocorrências puladas", anexos: "Anexos" };
const ORDEM = Object.keys(ROTULOS);

/**
 * Migração assistida do Nexus. Fluxo: arquivo gerado por `scripts/nexus-exportar.mjs` → simulação (nada é gravado) →
 * conferência de contagem e soma → confirmação → aplicação (o Cofre tira um backup antes e desfaz tudo se algo falhar).
 */
export function MigracaoNexus({ atualizar }: { atualizar: () => void }) {
  const [pacote, setPacote] = useState<PacoteNexus | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioNexus | null>(null);
  const [naoSimulados, setNaoSimulados] = useState(0);
  const [confirmo, setConfirmo] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const contagem = useMemo(() => (pacote ? contarPacote(pacote) : null), [pacote]);
  const aplicado = !!relatorio && !relatorio.dry_run && relatorio.aplicado;
  const podeAplicar = !!relatorio && relatorio.dry_run && relatorio.erros.length === 0 && relatorio.verificacao.confere && confirmo && !ocupado;

  function limpar() {
    setPacote(null); setNome(""); setErro(""); setRelatorio(null); setConfirmo(false); setNaoSimulados(0);
    if (entrada.current) entrada.current.value = "";
  }

  async function ler(file: File | undefined) {
    if (!file) return;
    setErro(""); setRelatorio(null); setConfirmo(false);
    if (file.size > TAMANHO_MAXIMO) { setErro("Arquivo acima de 120 MB. Gere o pacote com --sem-anexos e envie os comprovantes depois."); return; }
    try {
      setPacote(lerPacote(await file.text()));
      setNome(file.name);
    } catch (e) {
      setPacote(null);
      setErro((e as Error).message);
    }
  }

  async function simular() {
    if (!pacote) return;
    setOcupado(true); setErro(""); setRelatorio(null); setConfirmo(false);
    try {
      const { lotes, naoSimulados: fora } = dividirEmLotes(pacote);
      setNaoSimulados(fora);
      setRelatorio(await financeiro.migrarNexus(lotes[0], true));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!pacote || !podeAplicar) return;
    setOcupado(true); setErro("");
    const feitos: RelatorioNexus[] = [];
    try {
      const { lotes } = dividirEmLotes(pacote);
      for (const lote of lotes) {
        const r = await financeiro.migrarNexus(lote, false, FRASE_MIGRACAO_NEXUS);
        feitos.push(r);
        if (!r.aplicado) break;
      }
      setRelatorio(juntarRelatorios(feitos));
      atualizar();
    } catch (e) {
      // Os lotes já aplicados continuam valendo (cada um é atômico); repetir a migração só completa o que faltou.
      if (feitos.length) setRelatorio(juntarRelatorios(feitos));
      setErro(`${(e as Error).message}${feitos.length ? " Parte da migração já foi aplicada; rode de novo para completar, nada será duplicado." : ""}`);
    } finally {
      setOcupado(false);
    }
  }

  const v = relatorio?.verificacao;
  return (
    <article className="cofre-card cofre-csv-import">
      <p>
        Traga tudo do Nexus de uma vez: contas, categorias, pagadores, lançamentos, recorrências, pendências e comprovantes.
        Gere o arquivo com <code>node scripts/nexus-exportar.mjs</code> (só lê o banco do Nexus) e escolha-o aqui. Primeiro
        o Cofre <b>simula</b> sem gravar nada; depois você confere os números e confirma.
      </p>

      {!pacote ? (
        <div className="cofre-csv-drop">
          <Upload size={26} aria-hidden />
          <strong>Escolha o pacote do Nexus (.json)</strong>
          <button type="button" className="cofre-config-btn" onClick={() => entrada.current?.click()}>Escolher arquivo</button>
        </div>
      ) : (
        <div className="cofre-csv-arquivo">
          <FileJson size={18} aria-hidden />
          <div>
            <b>{nome}</b>
            {contagem && <small>{contagem.lancamentos} lançamentos · {contagem.recorrencias} recorrências · {contagem.anexosComArquivo} comprovantes com arquivo · receitas {formatMoeda(contagem.receitasCentavos)} · despesas {formatMoeda(contagem.despesasCentavos)}</small>}
          </div>
          <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={limpar}><RotateCcw size={14} aria-hidden />Trocar arquivo</button>
        </div>
      )}
      <input ref={entrada} className="sr-only" aria-label="Arquivo do Nexus" type="file" accept=".json,application/json" onChange={(e) => void ler(e.target.files?.[0])} />

      {erro && <p role="alert" className="cofre-csv-erro"><AlertTriangle size={14} aria-hidden />{erro}</p>}

      {pacote && !aplicado && (
        <div className="cofre-csv-acoes">
          <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={() => void simular()}>Simular migração (não grava)</button>
        </div>
      )}
      {ocupado && <div role="status" className="cofre-csv-status"><progress aria-label="Processando migração" /> Processando…</div>}

      {relatorio && v && (
        <div className="cofre-csv-revisao">
          <p role="status" className="cofre-csv-status" data-tom={aplicado ? "ok" : undefined}>
            {relatorio.dry_run ? "Simulação concluída: nada foi gravado." : relatorio.aplicado ? "Migração aplicada." : "Migração não aplicada: nada foi gravado."}
            {relatorio.backup && ` Backup antes da migração: ${relatorio.backup}.`}
          </p>
          <div className="cofre-csv-tabela">
            <table>
              <caption className="sr-only">Resultado por tipo de registro</caption>
              <thead><tr><th>Tipo</th><th>Recebidos</th><th>Criados</th><th>Já existiam</th><th>Já migrados</th><th>Sem arquivo</th><th>Erros</th></tr></thead>
              <tbody>
                {ORDEM.filter((k) => relatorio.entidades[k]).map((k) => {
                  const c = relatorio.entidades[k];
                  return <tr key={k}><td>{ROTULOS[k]}</td><td>{c.recebidas}</td><td>{c.criadas}</td><td>{c.reaproveitadas}</td><td>{c.ja_migradas}</td><td>{c.ignoradas}</td><td>{c.com_erro}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <div className="cofre-csv-tabela">
            <table>
              <caption className="sr-only">Conferência de lançamentos</caption>
              <thead><tr><th>Conferência</th><th>Lançamentos</th><th>Receitas</th><th>Despesas</th></tr></thead>
              <tbody>
                <tr><td>No pacote</td><td>{v.origem.lancamentos}</td><td className="font-mono-value">{formatMoeda(v.origem.entradas_centavos)}</td><td className="font-mono-value">{formatMoeda(v.origem.saidas_centavos)}</td></tr>
                <tr><td>Cofre antes</td><td>{v.antes.lancamentos}</td><td className="font-mono-value">{formatMoeda(v.antes.entradas_centavos)}</td><td className="font-mono-value">{formatMoeda(v.antes.saidas_centavos)}</td></tr>
                <tr><td>Cofre {v.projetado ? "depois (projetado)" : "depois"}</td><td>{v.depois.lancamentos}</td><td className="font-mono-value">{formatMoeda(v.depois.entradas_centavos)}</td><td className="font-mono-value">{formatMoeda(v.depois.saidas_centavos)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm" role="status">
            {v.confere ? <><CheckCircle2 size={14} aria-hidden /> Contagem e soma conferem: depois = antes + criados.</> : <><AlertTriangle size={14} aria-hidden /> A conferência de contagem e soma falhou; nada é aplicado.</>}
          </p>
          {naoSimulados > 0 && <p className="text-sm">{naoSimulados} comprovantes com arquivo seguem em envios separados na aplicação e não entram nesta simulação.</p>}
          {relatorio.avisos.length > 0 && <ul className="text-sm">{relatorio.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
          {relatorio.erros.length > 0 && (
            <ul className="cofre-csv-erros">{relatorio.erros.map((e, i) => <li key={i}>{ROTULOS[e.tabela] ?? e.tabela} {e.id}: {e.erro}</li>)}</ul>
          )}
          {relatorio.dry_run && relatorio.erros.length === 0 && (
            <div className="cofre-csv-acoes">
              <label className="text-sm">
                <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />{" "}
                Conferi os números e quero aplicar. O Cofre guarda um backup antes e desfaz tudo se algo falhar.
              </label>
              <button type="button" className="cofre-config-btn cofre-csv-primario" disabled={!podeAplicar} onClick={() => void aplicar()}>Aplicar migração</button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
