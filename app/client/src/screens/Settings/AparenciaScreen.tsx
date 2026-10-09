import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, Contrast, Cpu, Folder, Globe2, LayoutGrid, Moon, Monitor, Rows3, SpellCheck2, Sun, Wind, ZoomIn } from "lucide-react";
import { useTema } from "@/lib/theme";
import { Toggle } from "@/components/common/Toggle";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { limparEscolhaDePastas } from "@/components/views/PastasGrade";
import { ESCALAS_INTERFACE, lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type AltoContraste, type EstiloPastas, type IdiomaAplicativo, type PreferenciasAplicativo, type ReduzirMovimento } from "@/lib/preferencias-aplicativo";

const IDIOMAS = [
  { valor: "pt-BR", rotulo: "Português do Brasil", icone: Globe2, cor: TOM.aco },
  { valor: "en-US", rotulo: "English (US)", icone: Globe2, cor: TOM.ciano },
  { valor: "es-ES", rotulo: "Español", icone: Globe2, cor: TOM.violeta },
] as const;

const MOVIMENTOS = [
  { valor: "sistema", rotulo: "Usar configuração do sistema", icone: Wind, cor: TOM.aco },
  { valor: "desligado", rotulo: "Desligado", icone: Wind, cor: TOM.ciano },
  { valor: "ligado", rotulo: "Ligado", icone: Wind, cor: TOM.violeta },
] as const;

const CONTRASTES = [
  { valor: "sistema", rotulo: "Usar configuração do sistema", icone: Contrast, cor: TOM.aco },
  { valor: "desligado", rotulo: "Desligado", icone: Contrast, cor: TOM.ciano },
  { valor: "ligado", rotulo: "Ligado", icone: Contrast, cor: TOM.violeta },
] as const;

/**
 * GAP-04 (continued): "Aparência" is listed in the Settings index
 * (section 3.12) with no content detail. Assumed the minimum consistent
 * with the spec: toggling dark/light, since both modes have their own
 * closed palette in section 1.3 — dark as the product's default.
 */
export function AparenciaScreen() {
  const navigate = useNavigate();
  const { modo, setTema } = useTema();
  const [preferencias, setPreferencias] = useState(lerPreferenciasAplicativo);
  const alterar = (patch: Partial<PreferenciasAplicativo>) => setPreferencias((atual) => { const proxima = { ...atual, ...patch }; salvarPreferenciasAplicativo(proxima); return proxima; });

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button data-voltar onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Aparência</h1>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setTema("dark")}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            modo === "dark" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Moon size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Escuro</span>
          <span className="text-xs text-text-muted">Padrão do Ecos</span>
        </button>
        <button
          onClick={() => setTema("light")}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            modo === "light" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Sun size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Claro</span>
          <span className="text-xs text-text-muted">Tom azulado</span>
        </button>
        <button
          onClick={() => setTema("sistema")}
          aria-pressed={modo === "sistema"}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            modo === "sistema" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Monitor size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Sistema</span>
          <span className="text-xs text-text-muted">Acompanha o aparelho</span>
        </button>
      </div>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Acessibilidade</p>
        <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
          <Linha Icone={Contrast} titulo="Alto contraste" descricao="Aumente o contraste para melhorar a visibilidade.">
            <Seletor valor={preferencias.altoContraste} opcoes={CONTRASTES} onChange={(altoContraste: AltoContraste) => alterar({ altoContraste })} label="Alto contraste" />
          </Linha>
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Idioma e escrita</p>
        <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
          <Linha Icone={Globe2} titulo="Idioma" descricao="Altera o idioma de exibição do aplicativo.">
            <SeletorIdioma valor={preferencias.idioma} onChange={(idioma) => alterar({ idioma })} label="Idioma do aplicativo" />
          </Linha>
          <Linha Icone={SpellCheck2} titulo="Verificação ortográfica" descricao="Sublinha possíveis erros enquanto você escreve.">
            <Toggle checked={preferencias.corretorOrtografico} onChange={(corretorOrtografico) => alterar({ corretorOrtografico })} label="Verificação ortográfica" />
          </Linha>
          {preferencias.corretorOrtografico && <Linha Icone={Globe2} titulo="Idioma do corretor" descricao="Idioma usado nas notas e descrições.">
            <SeletorIdioma valor={preferencias.idiomaCorretor} onChange={(idiomaCorretor) => alterar({ idiomaCorretor })} label="Idioma do corretor" />
          </Linha>}
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Conforto</p>
        <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
          <Linha Icone={ZoomIn} titulo="Tamanho da interface" descricao="Aumenta ou reduz textos, espaços e botões de uma vez. Alguns textos pequenos têm tamanho fixo.">
            <div className="flex shrink-0 rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Tamanho da interface">
              {ESCALAS_INTERFACE.map((escala) => (
                <button key={escala} type="button" aria-pressed={preferencias.escalaInterface === escala} onClick={() => alterar({ escalaInterface: escala })} className={`flex h-8 items-center rounded-md px-2.5 font-mono-value text-xs font-medium ${preferencias.escalaInterface === escala ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>{escala}%</button>
              ))}
            </div>
          </Linha>
          <Linha Icone={Wind} titulo="Reduzir movimento" descricao="Tira animações e transições, inclusive o giro do globo. No modo Sistema, segue a configuração do aparelho.">
            <Seletor valor={preferencias.reduzirMovimento} opcoes={MOVIMENTOS} onChange={(reduzirMovimento: ReduzirMovimento) => alterar({ reduzirMovimento })} label="Reduzir movimento" />
          </Linha>
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Pastas</p>
        <div className="rounded-2xl border border-border bg-surface-1">
          <Linha Icone={Folder} titulo="Mostrar pastas ao abrir" descricao="Em Notas e Tarefas as pastas começam ocultas. Ligue para vê-las sempre abertas; o botão da tela continua valendo.">
            <Toggle checked={preferencias.pastasVisiveis} onChange={(pastasVisiveis) => { limparEscolhaDePastas(); alterar({ pastasVisiveis }); }} label="Mostrar pastas ao abrir" />
          </Linha>
          <Linha Icone={LayoutGrid} titulo="Estilo das pastas" descricao="Grade com blocos quadrados, ou grade menor com um nome por linha, como uma lista.">
            <SeletorEstilo valor={preferencias.estiloPastas} onChange={(estiloPastas) => alterar({ estiloPastas })} />
          </Linha>
        </div>
      </section>

      <section className="mt-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Desempenho</p>
        <div className="rounded-2xl border border-border bg-surface-1">
          <Linha Icone={Cpu} titulo="Aceleração de hardware" descricao="Usa a GPU para deixar animações e painéis mais fluidos. A mudança é aplicada ao reiniciar o app.">
            <Toggle checked={preferencias.aceleracaoHardware} onChange={(aceleracaoHardware) => alterar({ aceleracaoHardware })} label="Aceleração de hardware" />
          </Linha>
        </div>
      </section>
    </div>
  );
}

function Linha({ Icone, titulo, descricao, children }: { Icone: typeof Globe2; titulo: string; descricao: string; children: React.ReactNode }) {
  return <div className="flex min-h-20 items-center gap-3 text-sm border-b border-border/60 px-4 py-3 last:border-0"><Icone size={18} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{titulo}</span><span className="block text-xs leading-relaxed text-text-muted">{descricao}</span></span>{children}</div>;
}

function SeletorIdioma({ valor, onChange, label }: { valor: IdiomaAplicativo; onChange: (v: IdiomaAplicativo) => void; label: string }) {
  return <MenuSuspenso valor={valor} opcoes={IDIOMAS} onChange={onChange} ariaLabel={label} alinhar="dir"
    classeGatilho="flex min-h-10 min-w-44 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3"
    gatilho={({ aberto, atual }) => <><span className="min-w-0 flex-1 truncate text-left">{atual?.rotulo}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />;
}

function Seletor<T extends string>({ valor, opcoes, onChange, label }: { valor: T; opcoes: readonly { valor: T; rotulo: string; icone: typeof Globe2; cor: string }[]; onChange: (v: T) => void; label: string }) {
  return <MenuSuspenso valor={valor} opcoes={opcoes} onChange={onChange} ariaLabel={label} alinhar="dir"
    classeGatilho="flex min-h-10 min-w-44 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3"
    gatilho={({ aberto, atual }) => <><span className="min-w-0 flex-1 truncate text-left">{atual?.rotulo}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />;
}

function SeletorEstilo({ valor, onChange }: { valor: EstiloPastas; onChange: (v: EstiloPastas) => void }) {
  const opcoes = [{ id: "grade", Icone: LayoutGrid, rotulo: "Grade" }, { id: "compacta", Icone: Rows3, rotulo: "Menor" }] as const;
  return (
    <div className="flex shrink-0 rounded-lg border border-border bg-surface-2 p-1" role="group" aria-label="Estilo das pastas">
      {opcoes.map(({ id, Icone, rotulo }) => (
        <button key={id} type="button" aria-pressed={valor === id} onClick={() => onChange(id)} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${valor === id ? "bg-surface-3 text-text-primary" : "text-text-muted hover:text-text-secondary"}`}>
          <Icone size={15} strokeWidth={1.75} />{rotulo}
        </button>
      ))}
    </div>
  );
}
