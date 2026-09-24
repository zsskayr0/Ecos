import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Folder, FolderOpen } from "lucide-react";

export interface OpcaoArvore {
  valor: string;
  rotulo: string;
  pasta?: boolean;
}
interface No extends OpcaoArvore { filhos: No[] }

/** Os caminhos são a identidade: pastas com o mesmo nome continuam distintas. */
export function montarArvore(opcoes: readonly OpcaoArvore[]): No[] {
  const nos = new Map<string, No>();
  for (const o of opcoes.filter((o) => o.pasta)) {
    const partes = o.valor.split("/");
    partes.forEach((nome, i) => {
      const valor = partes.slice(0, i + 1).join("/");
      if (!nos.has(valor)) nos.set(valor, { valor, rotulo: nome, pasta: true, filhos: [] });
    });
  }
  const raizes: No[] = [];
  for (const no of nos.values()) {
    const pai = nos.get(no.valor.slice(0, no.valor.lastIndexOf("/")));
    if (no.valor.includes("/") && pai) pai.filhos.push(no);
    else raizes.push(no);
  }
  const ordenar = (lista: No[]) => {
    lista.sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }));
    lista.forEach((no) => ordenar(no.filhos));
  };
  ordenar(raizes);
  return [...opcoes.filter((o) => !o.pasta).map((o) => ({ ...o, filhos: [] })), ...raizes];
}

/** Lista de divulgação: Tab percorre as ações; setas horizontais expandem/recolhem. */
export function ArvorePastas({ opcoes, valores, onSelect, multipla = false, busca = "", carregarFilhos }: {
  opcoes: readonly OpcaoArvore[]; valores: readonly string[]; onSelect: (valor: string) => void;
  multipla?: boolean; busca?: string;
  /** Quando presente, cada seta consulta somente os filhos daquele caminho. */
  carregarFilhos?: (caminho: string) => Promise<readonly OpcaoArvore[]>;
}) {
  const [opcoesCarregadas, setOpcoesCarregadas] = useState<OpcaoArvore[]>(() => [...opcoes]);
  const [consultadas, setConsultadas] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState<Set<string>>(new Set());
  useEffect(() => { setOpcoesCarregadas([...opcoes]); setConsultadas(new Set()); }, [opcoes]);
  const arvore = useMemo(() => montarArvore(opcoesCarregadas), [opcoesCarregadas]);
  const [expandidas, setExpandidas] = useState<Set<string>>(() => new Set(valores.flatMap((v) => {
    const partes = v.split("/");
    return partes.slice(0, -1).map((_, i) => partes.slice(0, i + 1).join("/"));
  })));
  const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const termo = normalizar(busca.trim());
  const corresponde = (no: No): boolean => !no.pasta || normalizar(no.valor).includes(termo) || no.filhos.some(corresponde);
  const marcarExpandida = (valor: string, aberto: boolean) => setExpandidas((anteriores) => {
    const novas = new Set(anteriores);
    if (aberto) novas.add(valor); else novas.delete(valor);
    return novas;
  });
  async function expandir(valor: string, aberto: boolean) {
    marcarExpandida(valor, aberto);
    if (!aberto || !carregarFilhos || consultadas.has(valor) || carregando.has(valor)) return;
    setCarregando((atuais) => new Set(atuais).add(valor));
    try {
      const filhos = await carregarFilhos(valor);
      setOpcoesCarregadas((atuais) => {
        const porCaminho = new Map(atuais.map((opcao) => [opcao.valor, opcao]));
        filhos.forEach((filho) => porCaminho.set(filho.valor, filho));
        return [...porCaminho.values()];
      });
      setConsultadas((atuais) => new Set(atuais).add(valor));
    } finally {
      setCarregando((atuais) => { const proximas = new Set(atuais); proximas.delete(valor); return proximas; });
    }
  }
  function renderizar(nos: No[], nivel = 0) {
    return nos.filter(corresponde).map((no) => {
      const aberto = !!termo || expandidas.has(no.valor);
      const ativo = valores.includes(no.valor);
      const podeExpandir = no.filhos.length > 0 || (!!carregarFilhos && !consultadas.has(no.valor));
      const carregandoNo = carregando.has(no.valor);
      const Icone = aberto && no.filhos.length ? FolderOpen : Folder;
      return <div key={no.valor}>
        <div className={`flex min-w-0 items-center rounded-lg transition-colors hover:bg-surface-3 motion-reduce:transition-none ${ativo ? "bg-steel-700/20 text-text-primary" : "text-text-secondary"}`}
          style={{ paddingLeft: Math.min(nivel, 6) * 14 }}
          onKeyDown={(e) => {
            if (podeExpandir && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
              e.preventDefault(); void expandir(no.valor, e.key === "ArrowRight");
            }
          }}>
          {podeExpandir ? <button type="button" aria-label={`${aberto ? "Recolher" : "Expandir"} ${no.rotulo}`} aria-expanded={aberto} aria-busy={carregandoNo}
            onClick={() => void expandir(no.valor, !aberto)} className="flex min-h-10 w-9 shrink-0 items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
            <ChevronRight size={15} className={`transition-transform duration-200 motion-reduce:transition-none ${aberto ? "rotate-90" : ""} ${carregandoNo ? "animate-pulse" : ""}`} />
          </button> : <span className="w-9 shrink-0" />}
          <button type="button" role={multipla ? "menuitemcheckbox" : "menuitemradio"} aria-checked={ativo} title={no.pasta ? no.valor.split("/").join(" / ") : no.rotulo}
            onClick={() => onSelect(no.valor)} className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg pr-2.5 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-400">
            {no.pasta && <Icone size={15} className="shrink-0 text-steel-300" />}
            <span className="min-w-0 flex-1 truncate">{no.rotulo}</span>
            {ativo && <Check size={14} className="shrink-0 text-steel-300" />}
          </button>
        </div>
        {no.filhos.length > 0 && aberto && <div className="ecos-subpastas">{renderizar(no.filhos, nivel + 1)}</div>}
      </div>;
    });
  }
  return <div>{renderizar(arvore)}</div>;
}
