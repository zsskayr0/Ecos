import { useRef, useState, type CSSProperties } from "react";
import { CheckCircle2, FileSignature, HandCoins, Plus, TriangleAlert } from "lucide-react";
import { ANEXO_TAMANHO_MAXIMO_BYTES, ApiError, vault, type CategoriaApi, type FechamentoLucrosApi } from "@/lib/api";
import { formatMoeda } from "@/lib/format";
import { formatBR } from "../nexus/period";
import { CampoCategoria } from "../CampoCategoria";

const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";
const NOME_PADRAO = "Distribuição de lucros";
const estiloI = (i: number) => ({ "--i": i }) as CSSProperties;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Lucros do mês: as distribuições lançadas na categoria escolhida e o recibo assinado de cada uma, que a
 * contabilidade cobra. Sem categoria escolhida, oferece criar a padrão ou usar uma que já existe.
 */
export function LucrosDoMes({ lucros, categorias, abrir, aoMudar }: {
  lucros: FechamentoLucrosApi;
  categorias: CategoriaApi[];
  abrir: (id: string) => void;
  /** Algo foi gravado: o Fechamento recarrega e o resto do Cofre é avisado. */
  aoMudar: () => void;
}) {
  const [trocando, setTrocando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const alvo = useRef<string | null>(null);
  const opcoes = categorias.filter((c) => c.tipo !== "entrada" && !c.arquivada);

  async function escolher(id: string | null) {
    setErro(null);
    setOcupado(true);
    try {
      await vault.fechamento.definirLucros(id);
      setTrocando(false);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível guardar a categoria.");
    } finally {
      setOcupado(false);
    }
  }

  async function criarPadrao() {
    setErro(null);
    setOcupado(true);
    try {
      const existente = opcoes.find((c) => c.nome.trim().toLowerCase() === NOME_PADRAO.toLowerCase() && !c.pai_id);
      const id = existente?.id ?? (await vault.categorias.criar({ nome: NOME_PADRAO, tipo: "saida", cor: "#9b6bd6" })).id;
      await vault.fechamento.definirLucros(id);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível criar a categoria.");
    } finally {
      setOcupado(false);
    }
  }

  async function anexar(arquivos: FileList | null) {
    const arquivo = arquivos?.[0];
    const id = alvo.current;
    if (entrada.current) entrada.current.value = "";
    if (!arquivo || !id) return;
    setErro(null);
    setAviso(null);
    if (arquivo.size > ANEXO_TAMANHO_MAXIMO_BYTES) { setErro(`“${arquivo.name}” passa de 8 MB. Escolha um arquivo menor.`); return; }
    setOcupado(true);
    try {
      const r = await vault.anexos.enviar(id, arquivo, "recibo_lucros");
      if (r.duplicado_em) setAviso(`“${arquivo.name}” já estava anexado a outro lançamento. Foi guardado aqui também.`);
      aoMudar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível anexar o recibo.");
    } finally {
      setOcupado(false);
    }
  }

  if (!lucros.configurada) {
    return (
      <section className="fech-bloco cofre-rise" style={estiloI(4)} aria-label="Lucros do mês">
        <header><h2>Lucros do mês</h2></header>
        <div className="cofre-card fech-lucros-vazio">
          <HandCoins size={26} aria-hidden />
          <p><b>Escolha a categoria da distribuição de lucros.</b></p>
          <small>Os lançamentos dela aparecem aqui, com o recibo assinado de cada uma, e o que estiver sem recibo impede de fechar o mês.</small>
          <div className="fech-lucros-acoes">
            <button type="button" className="cofre-solid" disabled={ocupado} onClick={() => void criarPadrao()}><Plus size={14} aria-hidden />Usar a categoria “{NOME_PADRAO}”</button>
            {opcoes.length > 0 && <div className="fech-lucros-seletor"><CampoCategoria categorias={opcoes} valor={null} onChange={(id) => { if (id) void escolher(id); }} ariaLabel="Usar uma categoria que já existe" placeholder="Ou usar uma que já existe…" /></div>}
          </div>
          {erro && <small role="alert" className="fech-erro">{erro}</small>}
        </div>
      </section>
    );
  }

  return (
    <section className="fech-bloco cofre-rise" style={estiloI(4)} aria-label="Lucros do mês">
      <header>
        <h2>Lucros do mês</h2>
        <p>
          Categoria <b>{lucros.categoria_nome}</b>.{" "}
          <button type="button" className="fech-link" onClick={() => setTrocando((v) => !v)} aria-expanded={trocando}>{trocando ? "Cancelar" : "Trocar categoria"}</button>
        </p>
      </header>
      {trocando && (
        <div className="fech-lucros-seletor fech-lucros-troca">
          <CampoCategoria categorias={opcoes} valor={lucros.categoria_id} onChange={(id) => { if (id && id !== lucros.categoria_id) void escolher(id); }} ariaLabel="Categoria da distribuição de lucros" />
        </div>
      )}
      <input ref={entrada} type="file" accept={ACEITOS} hidden aria-label="Escolher o recibo de lucros" onChange={(e) => void anexar(e.target.files)} />
      {erro && <p role="alert" className="fech-erro fech-lucros-msg">{erro}</p>}
      {aviso && <p role="status" className="fech-lucros-msg">{aviso}</p>}

      {lucros.itens.length === 0 ? (
        <div className="cofre-card cofre-cats-empty"><p>Nenhuma distribuição neste período</p><small>Lance cada distribuição como saída na categoria “{lucros.categoria_nome}”.</small></div>
      ) : (
        <>
          <div className="fech-lucros-resumo">
            <span><b className="cofre-mono">{formatMoeda(lucros.valor_centavos)}</b> em {plural(lucros.quantidade, "distribuição", "distribuições")}</span>
            {lucros.sem_recibo > 0
              ? <span className="fech-selo" data-tom="alerta"><TriangleAlert size={13} aria-hidden />{plural(lucros.sem_recibo, "recibo faltando", "recibos faltando")}</span>
              : <span className="fech-selo" data-tom="ok"><CheckCircle2 size={13} aria-hidden />Todos com recibo</span>}
            {lucros.pendentes > 0 && <span className="fech-selo">{plural(lucros.pendentes, "pendente (fora do total)", "pendentes (fora do total)")}</span>}
          </div>
          <div className="cofre-card cofre-rec-lista">
            <div className="cofre-rec-tabela-rolagem">
              <table className="cofre-rec-tabela fech-tabela">
                <caption className="sr-only">Distribuições de lucros do período e o recibo de cada uma</caption>
                <thead><tr><th scope="col">Data</th><th scope="col">Descrição</th><th scope="col" className="num">Valor</th><th scope="col">Recibo</th></tr></thead>
                <tbody>
                  {lucros.itens.map((i) => (
                    <tr key={i.id} className="fech-linha" data-pendente={i.status === "pendente" || undefined}>
                      <td className="cofre-mono">{formatBR(i.data).slice(0, 5)}</td>
                      <td><button type="button" className="fech-desc" onClick={() => abrir(i.id)} aria-label={`Abrir lançamento ${i.descricao}`}>{i.descricao}</button>{i.status === "pendente" && <small className="fech-nada"> · pendente</small>}</td>
                      <td className="num cofre-mono">{formatMoeda(i.valor_centavos)}</td>
                      <td>
                        {i.recibos > 0
                          ? <button type="button" className="fech-recibo" data-ok onClick={() => abrir(i.id)} aria-label={`Ver ${plural(i.recibos, "recibo", "recibos")} de ${i.descricao}`}><CheckCircle2 size={13} aria-hidden />{plural(i.recibos, "recibo", "recibos")}</button>
                          : <button type="button" className="fech-recibo" disabled={ocupado} onClick={() => { alvo.current = i.id; entrada.current?.click(); }} aria-label={`Anexar recibo de ${i.descricao}`}><FileSignature size={13} aria-hidden />Anexar recibo</button>}
                        {i.recibos === 0 && i.outros_anexos > 0 && <small className="fech-nada">tem comprovante, falta o recibo</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
