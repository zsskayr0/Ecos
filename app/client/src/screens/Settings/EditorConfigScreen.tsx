import { ALargeSmall, Columns3, FileText, Globe2, Link2, Rows3, Scan, Type, ListChecks, PanelRight, Shapes, SpellCheck2, StickyNote, Timer, Zap } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import type { FonteNota, FormasEscrita, LarguraNota, MargemPagina, PapelNota } from "@/lib/preferencias-aplicativo";
import { Cabecalho, Linha, Secao, Segmentado, Seletor, usePreferencias } from "./campos-config";
import { IDIOMAS } from "./idiomas";

const FORMAS_ESCRITA = [
  { valor: "segurar", rotulo: "Ao segurar a caneta parada", icone: Shapes, cor: TOM.aco },
  { valor: "ao-soltar", rotulo: "AutomÃ¡tico, ao soltar", icone: Shapes, cor: TOM.ciano },
  { valor: "desligado", rotulo: "Desligado", icone: Shapes, cor: TOM.violeta },
] as const satisfies readonly { valor: FormasEscrita; rotulo: string; icone: typeof Shapes; cor: string }[];

const ESPERAS_FORMA = [{ id: "400", rotulo: "RÃ¡pido" }, { id: "650", rotulo: "Normal" }, { id: "1000", rotulo: "Lento" }] as const;

const FORMATOS_LINK = [
  { valor: "curto", rotulo: "Menor caminho possÃ­vel", icone: Link2, cor: TOM.aco },
  { valor: "relativo", rotulo: "Caminho relativo", icone: Link2, cor: TOM.ciano },
  { valor: "absoluto", rotulo: "Caminho completo", icone: Link2, cor: TOM.violeta },
] as const;

const FONTES = [
  { valor: "padrao", rotulo: "PadrÃ£o do app", icone: Type, cor: TOM.aco },
  { valor: "serifa", rotulo: "Serifada", icone: Type, cor: TOM.ciano },
  { valor: "sistema", rotulo: "Do sistema", icone: Type, cor: TOM.violeta },
  { valor: "mono", rotulo: "MonoespaÃ§ada", icone: Type, cor: TOM.aco },
] as const satisfies readonly { valor: FonteNota; rotulo: string; icone: typeof Type; cor: string }[];
const TAMANHOS = [
  { valor: "0", rotulo: "AutomÃ¡tico", icone: ALargeSmall, cor: TOM.aco },
  ...[13, 14, 15, 16, 18, 20, 22].map((n) => ({ valor: String(n), rotulo: `${n} px`, icone: ALargeSmall, cor: TOM.ciano })),
] as const;
const ENTRELINHAS = [{ id: "0", rotulo: "Auto" }, { id: "1.3", rotulo: "Justa" }, { id: "1.6", rotulo: "MÃ©dia" }, { id: "2", rotulo: "Dupla" }] as const;
const LARGURAS = [
  { valor: "padrao", rotulo: "Toda a largura", icone: Columns3, cor: TOM.aco },
  { valor: "estreita", rotulo: "Estreita (640 px)", icone: Columns3, cor: TOM.ciano },
  { valor: "media", rotulo: "MÃ©dia (760 px)", icone: Columns3, cor: TOM.ciano },
  { valor: "larga", rotulo: "Larga (960 px)", icone: Columns3, cor: TOM.violeta },
] as const satisfies readonly { valor: LarguraNota; rotulo: string; icone: typeof Type; cor: string }[];
const PAPEIS = [{ id: "desligado", rotulo: "Desligado" }, { id: "a4", rotulo: "A4" }, { id: "carta", rotulo: "Carta" }] as const satisfies readonly { id: PapelNota; rotulo: string }[];
const MARGENS = [{ id: "estreita", rotulo: "Estreita" }, { id: "normal", rotulo: "Normal" }, { id: "larga", rotulo: "Larga" }] as const satisfies readonly { id: MargemPagina; rotulo: string }[];

/** O ato de escrever, em notas e em tarefas: captura rÃ¡pida, modo Focus, ortografia, links e caneta. */
export function EditorConfigScreen() {
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Editor e escrita" />

      <Secao titulo="Captura rÃ¡pida">
        <Linha Icone={Zap} titulo="Enter cria" descricao="Na captura rÃ¡pida do Feed. Ctrl+Enter cria o outro tipo e Shift+Enter quebra a linha.">
          <Segmentado valor={prefs.capturaEnter} opcoes={[{ id: "nota", rotulo: "Nota", Icone: StickyNote }, { id: "tarefa", rotulo: "Tarefa", Icone: ListChecks }]} onChange={(capturaEnter) => alterar({ capturaEnter })} label="O que o Enter cria" />
        </Linha>
      </Secao>

      <Secao titulo="Texto das notas">
        <Linha Icone={Type} titulo="Fonte" descricao="Fonte do texto das notas. Notas com escrita Ã  mÃ£o mantÃªm a fonte padrÃ£o, para a tinta continuar alinhada.">
          <Seletor valor={prefs.notaFonte} opcoes={FONTES} onChange={(notaFonte) => alterar({ notaFonte })} label="Fonte das notas" />
        </Linha>
        <Linha Icone={ALargeSmall} titulo="Tamanho do texto" descricao="AutomÃ¡tico usa 14 px no computador e 16 px no celular.">
          <Seletor valor={String(prefs.notaTamanho) as (typeof TAMANHOS)[number]["valor"]} opcoes={TAMANHOS} onChange={(v) => alterar({ notaTamanho: Number(v) })} label="Tamanho do texto" />
        </Linha>
        <Linha Icone={Rows3} titulo="Entrelinha" descricao="EspaÃ§o entre as linhas do texto.">
          <Segmentado valor={(ENTRELINHAS.find((e) => Number(e.id) === prefs.notaEntrelinha)?.id ?? "0") as (typeof ENTRELINHAS)[number]["id"]} opcoes={ENTRELINHAS} onChange={(v) => alterar({ notaEntrelinha: Number(v) })} label="Entrelinha" />
        </Linha>
        <Linha Icone={Columns3} titulo="Largura da coluna" descricao="Limita a largura do texto para linhas mais confortÃ¡veis de ler. Vale no modo comum e no Focus.">
          <Seletor valor={prefs.notaLargura} opcoes={LARGURAS} onChange={(notaLargura) => alterar({ notaLargura })} label="Largura da coluna" />
        </Linha>
      </Secao>

      <Secao titulo="Modo pÃ¡gina">
        <Linha Icone={FileText} titulo="Papel" descricao="Mostra a nota como uma folha, com a linha onde cada pÃ¡gina termina, e o PDF exportado usa o mesmo papel e margens. Uma linha sÃ³ com ---pagebreak comeÃ§a uma pÃ¡gina nova no PDF. Sem cabeÃ§alho nem rodapÃ©: palavras e pÃ¡ginas ficam no painel lateral.">
          <Segmentado valor={prefs.notaPapel} opcoes={PAPEIS} onChange={(notaPapel) => alterar({ notaPapel })} label="Papel do modo pÃ¡gina" />
        </Linha>
        {prefs.notaPapel !== "desligado" && (
          <Linha Icone={Scan} titulo="Margens" descricao="Estreita 1,27 cm, normal 2,5 cm, larga 3,5 cm.">
            <Segmentado valor={prefs.notaMargem} opcoes={MARGENS} onChange={(notaMargem) => alterar({ notaMargem })} label="Margens da pÃ¡gina" />
          </Linha>
        )}
      </Secao>

      <Secao titulo="Modo Focus">
        <Linha Icone={PanelRight} titulo="Painel lateral do Focus recolhido" descricao="No modo Focus (tarefas e notas) o painel de opÃ§Ãµes comeÃ§a fechado, com o texto em primeiro plano. Desligue para ele jÃ¡ abrir. O botÃ£o no cabeÃ§alho alterna a qualquer momento.">
          <Toggle checked={prefs.focusPainelRecolhido} onChange={(focusPainelRecolhido) => alterar({ focusPainelRecolhido })} label="Painel lateral do Focus recolhido" />
        </Linha>
      </Secao>

      <Secao titulo="Ortografia">
        <Linha Icone={SpellCheck2} titulo="VerificaÃ§Ã£o ortogrÃ¡fica" descricao="Sublinha possÃ­veis erros enquanto vocÃª escreve.">
          <Toggle checked={prefs.corretorOrtografico} onChange={(corretorOrtografico) => alterar({ corretorOrtografico })} label="VerificaÃ§Ã£o ortogrÃ¡fica" />
        </Linha>
        {prefs.corretorOrtografico && (
          <Linha Icone={Globe2} titulo="Idioma do corretor" descricao="Idioma usado nas notas e descriÃ§Ãµes.">
            <Seletor valor={prefs.idiomaCorretor} opcoes={IDIOMAS} onChange={(idiomaCorretor) => alterar({ idiomaCorretor })} label="Idioma do corretor" />
          </Linha>
        )}
      </Secao>

      <Secao titulo="Links internos">
        <Linha Icone={Link2} titulo="Formato para links novos" descricao="Define como os links internos serÃ£o gerados.">
          <Seletor valor={prefs.formatoLink} opcoes={FORMATOS_LINK} onChange={(formatoLink) => alterar({ formatoLink })} label="Formato para links novos" />
        </Linha>
        <Linha Icone={Link2} titulo="Usar wikilinks" descricao="Cria [[links internos]] em vez de links Markdown.">
          <Toggle checked={prefs.usarWikilinks} onChange={(usarWikilinks) => alterar({ usarWikilinks })} label="Usar wikilinks" />
        </Linha>
        <Linha Icone={Link2} titulo="Atualizar links internos" descricao="Ao renomear ou mover um item, atualiza os links que apontam para ele.">
          <Toggle checked={prefs.atualizarLinks} onChange={(atualizarLinks) => alterar({ atualizarLinks })} label="Atualizar links internos" />
        </Linha>
      </Secao>

      <Secao titulo="Escrita Ã  mÃ£o">
        <Linha Icone={Shapes} titulo="Reconhecer figuras" descricao="Transforma traÃ§os em linha reta, cÃ­rculo, elipse, triÃ¢ngulo ou retÃ¢ngulo. â€œAo segurarâ€ sÃ³ encaixa se vocÃª parar a caneta no fim do traÃ§o; â€œAutomÃ¡ticoâ€ tenta ao soltar, e pode mexer em letras que lembrem uma figura.">
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
