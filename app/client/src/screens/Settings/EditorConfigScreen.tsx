import { Globe2, Link2, ListChecks, PanelRight, Shapes, SpellCheck2, StickyNote, Timer, Zap } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import type { FormasEscrita } from "@/lib/preferencias-aplicativo";
import { Cabecalho, Linha, Secao, Segmentado, Seletor, usePreferencias } from "./campos-config";
import { IDIOMAS } from "./idiomas";

const FORMAS_ESCRITA = [
  { valor: "segurar", rotulo: "Ao segurar a caneta parada", icone: Shapes, cor: TOM.aco },
  { valor: "ao-soltar", rotulo: "Automático, ao soltar", icone: Shapes, cor: TOM.ciano },
  { valor: "desligado", rotulo: "Desligado", icone: Shapes, cor: TOM.violeta },
] as const satisfies readonly { valor: FormasEscrita; rotulo: string; icone: typeof Shapes; cor: string }[];

const ESPERAS_FORMA = [{ id: "400", rotulo: "Rápido" }, { id: "650", rotulo: "Normal" }, { id: "1000", rotulo: "Lento" }] as const;

const FORMATOS_LINK = [
  { valor: "curto", rotulo: "Menor caminho possível", icone: Link2, cor: TOM.aco },
  { valor: "relativo", rotulo: "Caminho relativo", icone: Link2, cor: TOM.ciano },
  { valor: "absoluto", rotulo: "Caminho completo", icone: Link2, cor: TOM.violeta },
] as const;

/** O ato de escrever, em notas e em tarefas: captura rápida, modo Focus, ortografia, links e caneta. */
export function EditorConfigScreen() {
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Editor e escrita" />

      <Secao titulo="Captura rápida">
        <Linha Icone={Zap} titulo="Enter cria" descricao="Na captura rápida do Feed. Ctrl+Enter cria o outro tipo e Shift+Enter quebra a linha.">
          <Segmentado valor={prefs.capturaEnter} opcoes={[{ id: "nota", rotulo: "Nota", Icone: StickyNote }, { id: "tarefa", rotulo: "Tarefa", Icone: ListChecks }]} onChange={(capturaEnter) => alterar({ capturaEnter })} label="O que o Enter cria" />
        </Linha>
      </Secao>

      <Secao titulo="Modo Focus">
        <Linha Icone={PanelRight} titulo="Painel lateral do Focus recolhido" descricao="No modo Focus (tarefas e notas) o painel de opções começa fechado, com o texto em primeiro plano. Desligue para ele já abrir. O botão no cabeçalho alterna a qualquer momento.">
          <Toggle checked={prefs.focusPainelRecolhido} onChange={(focusPainelRecolhido) => alterar({ focusPainelRecolhido })} label="Painel lateral do Focus recolhido" />
        </Linha>
      </Secao>

      <Secao titulo="Ortografia">
        <Linha Icone={SpellCheck2} titulo="Verificação ortográfica" descricao="Sublinha possíveis erros enquanto você escreve.">
          <Toggle checked={prefs.corretorOrtografico} onChange={(corretorOrtografico) => alterar({ corretorOrtografico })} label="Verificação ortográfica" />
        </Linha>
        {prefs.corretorOrtografico && (
          <Linha Icone={Globe2} titulo="Idioma do corretor" descricao="Idioma usado nas notas e descrições.">
            <Seletor valor={prefs.idiomaCorretor} opcoes={IDIOMAS} onChange={(idiomaCorretor) => alterar({ idiomaCorretor })} label="Idioma do corretor" />
          </Linha>
        )}
      </Secao>

      <Secao titulo="Links internos">
        <Linha Icone={Link2} titulo="Formato para links novos" descricao="Define como os links internos serão gerados.">
          <Seletor valor={prefs.formatoLink} opcoes={FORMATOS_LINK} onChange={(formatoLink) => alterar({ formatoLink })} label="Formato para links novos" />
        </Linha>
        <Linha Icone={Link2} titulo="Usar wikilinks" descricao="Cria [[links internos]] em vez de links Markdown.">
          <Toggle checked={prefs.usarWikilinks} onChange={(usarWikilinks) => alterar({ usarWikilinks })} label="Usar wikilinks" />
        </Linha>
        <Linha Icone={Link2} titulo="Atualizar links internos" descricao="Ao renomear ou mover um item, atualiza os links que apontam para ele.">
          <Toggle checked={prefs.atualizarLinks} onChange={(atualizarLinks) => alterar({ atualizarLinks })} label="Atualizar links internos" />
        </Linha>
      </Secao>

      <Secao titulo="Escrita à mão">
        <Linha Icone={Shapes} titulo="Reconhecer figuras" descricao="Transforma traços em linha reta, círculo, elipse, triângulo ou retângulo. “Ao segurar” só encaixa se você parar a caneta no fim do traço; “Automático” tenta ao soltar, e pode mexer em letras que lembrem uma figura.">
          <Seletor valor={prefs.escritaFormas} opcoes={FORMAS_ESCRITA} onChange={(escritaFormas) => alterar({ escritaFormas })} label="Reconhecer figuras" />
        </Linha>
        {prefs.escritaFormas === "segurar" && (
          <Linha Icone={Timer} titulo="Tempo de espera" descricao="Quanto tempo a caneta precisa ficar parada para encaixar a figura.">
            <Segmentado valor={String(prefs.escritaEsperaFormaMs <= 500 ? 400 : prefs.escritaEsperaFormaMs >= 850 ? 1000 : 650) as "400" | "650" | "1000"} opcoes={ESPERAS_FORMA} onChange={(v) => alterar({ escritaEsperaFormaMs: Number(v) })} label="Tempo de espera" />
          </Linha>
        )}
      </Secao>
    </div>
  );
}
