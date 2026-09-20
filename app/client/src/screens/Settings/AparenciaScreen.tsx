import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, Cpu, Globe2, Moon, SpellCheck2, Sun } from "lucide-react";
import { useTema } from "@/lib/theme";
import { Toggle } from "@/components/common/Toggle";
import { MenuSuspenso, TOM } from "@/components/common/MenuSuspenso";
import { lerPreferenciasAplicativo, salvarPreferenciasAplicativo, type IdiomaAplicativo, type PreferenciasAplicativo } from "@/lib/preferencias-aplicativo";

const IDIOMAS = [
  { valor: "pt-BR", rotulo: "Português do Brasil", icone: Globe2, cor: TOM.aco },
  { valor: "en-US", rotulo: "English (US)", icone: Globe2, cor: TOM.ciano },
  { valor: "es-ES", rotulo: "Español", icone: Globe2, cor: TOM.violeta },
] as const;

/**
 * GAP-04 (continued): "Aparência" is listed in the Settings index
 * (section 3.12) with no content detail. Assumed the minimum consistent
 * with the spec: toggling dark/light, since both modes have their own
 * closed palette in section 1.3 — dark as the product's default.
 */
export function AparenciaScreen() {
  const navigate = useNavigate();
  const { tema, setTema } = useTema();
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
            tema === "dark" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Moon size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Escuro</span>
          <span className="text-xs text-text-muted">Padrão do Ecos</span>
        </button>
        <button
          onClick={() => setTema("light")}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            tema === "light" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Sun size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Claro</span>
          <span className="text-xs text-text-muted">Tom azulado</span>
        </button>
      </div>

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
  return <div className="flex min-h-20 items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"><Icone size={18} className="shrink-0 text-steel-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-text-primary">{titulo}</span><span className="block text-xs leading-relaxed text-text-muted">{descricao}</span></span>{children}</div>;
}

function SeletorIdioma({ valor, onChange, label }: { valor: IdiomaAplicativo; onChange: (v: IdiomaAplicativo) => void; label: string }) {
  return <MenuSuspenso valor={valor} opcoes={IDIOMAS} onChange={onChange} ariaLabel={label} alinhar="dir"
    classeGatilho="flex min-h-10 min-w-44 items-center gap-2 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3"
    gatilho={({ aberto, atual }) => <><span className="min-w-0 flex-1 truncate text-left">{atual?.rotulo}</span><ChevronDown size={15} className={`shrink-0 text-text-muted transition-transform ${aberto ? "rotate-180" : ""}`} /></>} />;
}
