import { ALargeSmall, Columns3, FileText, Globe2, Link2, ListOrdered, ListTree, Rows3, Scan, Type, ListChecks, PanelRight, Shapes, SpellCheck2, StickyNote, Timer, Zap } from "lucide-react";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import type { FonteNota, FormasEscrita, LarguraNota, MargemPagina, PapelNota } from "@/lib/preferencias-aplicativo";
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

const FONTES = [
  { valor: "padrao", rotulo: "Padrão do app", icone: Type, cor: TOM.aco },
  { valor: "serifa", rotulo: "Serifada", icone: Type, cor: TOM.ciano },
  { valor: "sistema", rotulo: "Do sistema", icone: Type, cor: TOM.violeta },
  { valor: "mono", rotulo: "Monoespaçada", icone: Type, cor: TOM.aco },
] as const satisfies readonly { valor: FonteNota; rotulo: string; icone: typeof Type; cor: string }[];
const TAMANHOS = [
  { valor: "0", rotulo: "Automático", icone: ALargeSmall, cor: TOM.aco },
  ...[13, 14, 15, 16, 18, 20, 22].map((n) => ({ valor: String(n), rotulo: `${n} px`, icone: ALargeSmall, cor: TOM.ciano })),
] as const;
const ENTRELINHAS = [{ id: "0", rotulo: "Auto" }, { id: "1.3", rotulo: "Justa" }, { id: "1.6", rotulo: "Média" }, { id: "2", rotulo: "Dupla" }] as const;
const PAPEIS = [{ id: "desligado", rotulo: "Desligado" }, { id: "a4", rotulo: "A4" }, { id: "carta", rotulo: "Carta" }] as const satisfies readonly { id: PapelNota; rotulo: string }[];
const MARGENS = [{ id: "estreita", rotulo: "Estreita" }, { id: "normal", rotulo: "Normal" }, { id: "larga", rotulo: "Larga" }] as const satisfies readonly { id: MargemPagina; rotulo: string }[];

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

      <Secao titulo="Texto das notas">
        <Linha Icone={Type} titulo="Fonte" descricao="Fonte do texto das notas. Notas com escrita à mão mantêm a fonte padrão, para a tinta continuar alinhada.">
          <Seletor valor={prefs.notaFonte} opcoes={FONTES} onChange={(notaFonte) => alterar({ notaFonte })} label="Fonte das notas" />
        </Linha>
        <Linha Icone={ALargeSmall} titulo="Tamanho do texto" descricao="Automático usa 14 px no computador e 16 px no celular.">
          <Seletor valor={String(prefs.notaTamanho) as (typeof TAMANHOS)[number]["valor"]} opcoes={TAMANHOS} onChange={(v) => alterar({ notaTamanho: Number(v) })} label="Tamanho do texto" />
        </Linha>
        <Linha Icone={Rows3} titulo="Entrelinha" descricao="Espaço entre as linhas do texto.">
          <Segmentado valor={(ENTRELINHAS.find((e) => Number(e.id) === prefs.notaEntrelinha)?.id ?? "0") as (typeof ENTRELINHAS)[number]["id"]} opcoes={ENTRELINHAS} onChange={(v) => alterar({ notaEntrelinha: Number(v) })} label="Entrelinha" />
        </Linha>
      </Secao>

      <Secao titulo="Modo página">
        <Linha Icone={FileText} titulo="Papel" descricao="Mostra a nota como uma folha, com a linha onde cada página termina, e o PDF exportado usa o mesmo papel e margens. Uma linha só com ---pagebreak começa uma página nova no PDF. Sem cabeçalho nem rodapé: palavras e páginas ficam no painel lateral.">
          <Segmentado valor={prefs.notaPapel} opcoes={PAPEIS} onChange={(notaPapel) => alterar({ notaPapel })} label="Papel do modo página" />
        </Linha>
        {prefs.notaPapel !== "desligado" && (
          <Linha Icone={Scan} titulo="Margens" descricao="Estreita 1,27 cm, normal 2,5 cm, larga 3,5 cm.">
            <Segmentado valor={prefs.notaMargem} opcoes={MARGENS} onChange={(notaMargem) => alterar({ notaMargem })} label="Margens da página" />
          </Linha>
        )}
      </Secao>

      <Secao titulo="Modo Focus">
        <Linha Icone={PanelRight} titulo="Painel lateral do Focus recolhido" descricao="No modo Focus (tarefas e notas) o painel de opções começa fechado, com o texto em primeiro plano. Desligue para ele já abrir. O botão no cabeçalho alterna a qualquer momento.">
          <Toggle checked={prefs.focusPainelRecolhido} onChange={(focusPainelRecolhido) => alterar({ focusPainelRecolhido })} label="Painel lateral do Focus recolhido" />
        </Linha>
        <Linha Icone={ListTree} titulo="Sumário aberto ao abrir" descricao="O painel do sumário (à esquerda, com os títulos da nota ou tarefa) já aparece ao abrir. Desligado, ele começa oculto; o botão de lista no cabeçalho abre e fecha a qualquer momento.">
          <Toggle checked={prefs.sumarioAbertoAoAbrir} onChange={(sumarioAbertoAoAbrir) => alterar({ sumarioAbertoAoAbrir })} label="Sumário aberto ao abrir" />
        </Linha>
      </Secao>

      <Secao titulo="Títulos">
        <Linha Icone={ListOrdered} titulo="Numerar títulos" descricao="Mostra 1, 1.1, 1.1.1 antes dos títulos das notas, no editor, na leitura, no sumário e no PDF. O texto da nota não muda.">
          <Toggle checked={prefs.numerarTitulos} onChange={(numerarTitulos) => alterar({ numerarTitulos })} label="Numerar títulos" />
        </Linha>
        <Linha Icone={ListTree} titulo="Sumário no PDF" descricao="Coloca a lista de títulos no início do PDF da nota. É gerado na hora da exportação; nada é escrito na nota.">
          <Toggle checked={prefs.sumarioNoPdf} onChange={(sumarioNoPdf) => alterar({ sumarioNoPdf })} label="Sumário no PDF" />
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
        <Linha Icone={Shapes} titulo="Reconhecer figuras" descricao="Transforma traços em linha reta, círculo, elipse, triângulo ou retângulo. â€œAo segurarâ€ só encaixa se você parar a caneta no fim do traço; â€œAutomáticoâ€ tenta ao soltar, e pode mexer em letras que lembrem uma figura.">
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
