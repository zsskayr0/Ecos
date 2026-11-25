import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Columns3, FileText, FileType2, Flag, Folder, FolderCog, FolderTree, LayoutGrid, Paperclip, Rows3, Shapes, SquareCheck, Trash2 } from "lucide-react";
import { COLUNAS_ARQUIVOS, colunasValidas } from "@/lib/colunas-arquivos";
import { TOM } from "@/components/common/MenuSuspenso";
import { Toggle } from "@/components/common/Toggle";
import { limparEscolhaDePastas } from "@/components/views/PastasGrade";
import type { MarcaArquivo, OrdemPastas } from "@/lib/preferencias-aplicativo";
import { Cabecalho, Linha, Secao, Segmentado, Seletor, usePreferencias } from "./campos-config";
import { IconesPorExtensao } from "./IconesPorExtensao";

const ORDENS_PASTAS = [
  { valor: "padrao", rotulo: "Padrão", icone: Rows3, cor: TOM.aco },
  { valor: "nome", rotulo: "Nome (A–Z)", icone: Rows3, cor: TOM.ciano },
  { valor: "itens", rotulo: "Mais itens", icone: Rows3, cor: TOM.violeta },
  { valor: "uso", rotulo: "Mais usadas", icone: Rows3, cor: TOM.aco },
] as const satisfies readonly { valor: OrdemPastas; rotulo: string; icone: typeof Rows3; cor: string }[];

const LAYOUTS_EXPLORADOR = [
  { valor: "trilho", rotulo: "Trilho de ícones (todos os módulos)", icone: FolderTree, cor: TOM.ciano },
  { valor: "empilhado", rotulo: "Enxuto (5 módulos, árvore embaixo)", icone: FolderTree, cor: TOM.violeta },
] as const satisfies readonly { valor: "trilho" | "empilhado"; rotulo: string; icone: typeof FolderTree; cor: string }[];

const MARCAS_ARQUIVO = [
  { valor: "ambos", rotulo: "Ícone e selo (.PDF)", icone: FileType2, cor: TOM.aco },
  { valor: "selo", rotulo: "Só o selo da extensão", icone: FileType2, cor: TOM.ciano },
  { valor: "icone", rotulo: "Só o ícone", icone: FileType2, cor: TOM.violeta },
  { valor: "nenhum", rotulo: "Só o nome", icone: FileType2, cor: TOM.aco },
] as const satisfies readonly { valor: MarcaArquivo; rotulo: string; icone: typeof FileType2; cor: string }[];

const ESTILOS = [{ id: "grade", rotulo: "Grade", Icone: LayoutGrid }, { id: "compacta", rotulo: "Menor", Icone: Rows3 }] as const;

const MINIATURAS = [
  { id: "desligada", rotulo: "Sem" },
  { id: "pequena", rotulo: "Pequena" },
  { id: "media", rotulo: "Média" },
  { id: "grande", rotulo: "Grande" },
] as const;

const ANEXOS = [
  { valor: "perguntar", rotulo: "Perguntar sempre", icone: Paperclip, cor: TOM.aco },
  { valor: "automatico", rotulo: "Excluir automaticamente", icone: Paperclip, cor: TOM.erro },
  { valor: "manter", rotulo: "Manter anexos", icone: Paperclip, cor: TOM.ciano },
] as const;
const DESTINOS = [
  { valor: "sistema", rotulo: "Lixeira do sistema", icone: Trash2, cor: TOM.aco },
  { valor: "ecos", rotulo: "Lixeira do Ecos", icone: Trash2, cor: TOM.ciano },
  { valor: "permanente", rotulo: "Excluir permanentemente", icone: Trash2, cor: TOM.erro },
] as const;

const CLASSE_BOTAO = "flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-border bg-surface-2 px-3 text-sm text-text-primary hover:bg-surface-3";

/** Como pastas e arquivos aparecem e o que acontece ao excluir. Criar e renomear pastas fica em Gerenciar pastas e tags. */
export function PastasArquivosScreen() {
  const navigate = useNavigate();
  const [prefs, alterar] = usePreferencias();
  const [iconesAbertos, setIconesAbertos] = useState(false);
  const totalIcones = Object.keys(prefs.exploradorIconesExtensao).length;
  const colunasAtivas = colunasValidas(prefs.exploradorColunas);

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Exibição e lixeira" />

      <Secao titulo="Pastas em Notas e Tarefas">
        <Linha Icone={Folder} titulo="Mostrar pastas ao abrir" descricao="Em Notas e Tarefas as pastas começam ocultas. Ligue para vê-las sempre abertas; o botão da tela continua valendo.">
          <Toggle checked={prefs.pastasVisiveis} onChange={(pastasVisiveis) => { limparEscolhaDePastas(); alterar({ pastasVisiveis }); }} label="Mostrar pastas ao abrir" />
        </Linha>
        <Linha Icone={LayoutGrid} titulo="Estilo das pastas" descricao="Grade com blocos quadrados, ou grade menor com um nome por linha, como uma lista.">
          <Segmentado valor={prefs.estiloPastas} opcoes={ESTILOS} onChange={(estiloPastas) => alterar({ estiloPastas })} label="Estilo das pastas" />
        </Linha>
        <Linha Icone={Rows3} titulo="Ordem das pastas" descricao="Como as pastas se organizam em Notas e Tarefas. As fixadas ficam sempre no topo. “Mais usadas” aprende com as pastas que você abre neste aparelho.">
          <Seletor valor={prefs.ordemPastas} opcoes={ORDENS_PASTAS} onChange={(ordemPastas) => alterar({ ordemPastas })} label="Ordem das pastas" />
        </Linha>
        <Linha Icone={FolderCog} titulo="Criar, renomear e organizar" descricao="Pastas e tags de cada espaço têm uma tela própria.">
          <button type="button" onClick={() => navigate("/configuracoes/organizacao")} className={CLASSE_BOTAO}>Gerenciar pastas e tags<ChevronRight size={15} className="text-text-muted" /></button>
        </Linha>
        <Linha Icone={Shapes} titulo="Ícones das pastas" descricao="Envie imagens próprias para usar como ícone de pasta.">
          <button type="button" onClick={() => navigate("/configuracoes/icones")} className={CLASSE_BOTAO}>Ícones personalizados<ChevronRight size={15} className="text-text-muted" /></button>
        </Linha>
      </Secao>

      <Secao titulo="Explorador de arquivos">
        <Linha Icone={FolderTree} titulo="Modo explorador" descricao="No computador, o menu lateral mostra a árvore de arquivos do espaço junto dos módulos (veja o layout abaixo).">
          <Toggle checked={prefs.modoExplorador} onChange={(modoExplorador) => alterar({ modoExplorador })} label="Modo explorador" />
        </Linha>
        {prefs.modoExplorador && (
          <>
            <Linha Icone={FolderTree} titulo="Layout do menu lateral" descricao="Trilho: todos os módulos como ícones, com a árvore de arquivos à direita. Enxuto: só Início, Timeline, Tarefas, Notas e Cofre, com a árvore embaixo.">
              <Seletor valor={prefs.exploradorLayout} opcoes={LAYOUTS_EXPLORADOR} onChange={(exploradorLayout) => alterar({ exploradorLayout })} label="Layout do menu lateral" />
            </Linha>
            <Linha Icone={Flag} titulo="Ícones de tarefa por prioridade" descricao="No modo Explorador, colore os ícones das tarefas em vermelho para prioridade alta, âmbar para média e ciano para baixa.">
              <Toggle checked={prefs.exploradorColorirPrioridade} onChange={(exploradorColorirPrioridade) => alterar({ exploradorColorirPrioridade })} label="Ícones de tarefa por prioridade" />
            </Linha>
            <Linha Icone={FileType2} titulo="Marca dos arquivos na árvore" descricao="Como os arquivos que não são notas nem tarefas (PDF, planilhas, imagens…) aparecem no menu lateral: com ícone, com o selo da extensão à direita, os dois ou só o nome.">
              <Seletor valor={prefs.exploradorMarcaArquivo} opcoes={MARCAS_ARQUIVO} onChange={(exploradorMarcaArquivo) => alterar({ exploradorMarcaArquivo })} label="Marca dos arquivos na árvore" />
            </Linha>
            <Linha Icone={Shapes} titulo="Ícones por tipo de arquivo" descricao="Escolha um ícone próprio para cada extensão. Sem escolha, vale o ícone padrão do tipo.">
              <button type="button" onClick={() => setIconesAbertos(true)} className={CLASSE_BOTAO}>
                {totalIcones ? `${totalIcones} personalizado${totalIcones === 1 ? "" : "s"}` : "Escolher"}
              </button>
            </Linha>
          </>
        )}
        <Linha Icone={Columns3} titulo="Colunas da lista" descricao="O que aparece ao lado do nome na lista da tela de Arquivos. Clique no título da coluna na lista para ordenar por ela.">
          <div className="flex max-w-md flex-wrap justify-end gap-1.5" role="group" aria-label="Colunas da lista">
            {COLUNAS_ARQUIVOS.map((c) => {
              const ativa = colunasAtivas.includes(c.id);
              return (
                <button key={c.id} type="button" aria-pressed={ativa}
                  onClick={() => alterar({ exploradorColunas: COLUNAS_ARQUIVOS.map((x) => x.id).filter((id) => (id === c.id ? !ativa : colunasAtivas.includes(id))) })}
                  className={`min-h-9 rounded-full border px-3 text-sm transition-colors ${ativa ? "border-steel-400 bg-steel-500/20 text-text-primary" : "border-border bg-surface-2 text-text-muted hover:bg-surface-3"}`}>
                  {c.rotulo}
                </button>
              );
            })}
          </div>
        </Linha>
        <Linha Icone={FileText} titulo="Miniatura na grade" descricao="Na grade de Arquivos, notas e tarefas aparecem como uma página A4 com o começo do texto. Escolha o tamanho ou desligue para ver só o ícone.">
          <Segmentado valor={prefs.arquivosMiniatura} opcoes={MINIATURAS} onChange={(arquivosMiniatura) => alterar({ arquivosMiniatura })} label="Tamanho da miniatura" />
        </Linha>
        <Linha Icone={SquareCheck} titulo="Checkbox nas tarefas" descricao="Na lista de Arquivos, ao passar o mouse sobre o ícone da tarefa, ele vira uma caixa para concluir ou reabrir direto na linha.">
          <Toggle checked={prefs.exploradorCheckboxTarefa} onChange={(exploradorCheckboxTarefa) => alterar({ exploradorCheckboxTarefa })} label="Checkbox nas tarefas" />
        </Linha>
        <Linha Icone={FolderTree} titulo="Sugestões na barra de endereço" descricao="Na tela de Arquivos, ao clicar no caminho para digitar, mostra uma lista de pastas que combinam com o que você escreve.">
          <Toggle checked={prefs.arquivosSugestoesCaminho} onChange={(arquivosSugestoesCaminho) => alterar({ arquivosSugestoesCaminho })} label="Sugestões na barra de endereço" />
        </Linha>
      </Secao>

      <Secao titulo="Exclusão e lixeira">
        <Linha Icone={Trash2} titulo="Confirmar antes de excluir" descricao="Evita exclusões acidentais de notas, tarefas e arquivos.">
          <Toggle checked={prefs.confirmarExclusao} onChange={(confirmarExclusao) => alterar({ confirmarExclusao })} label="Confirmar antes de excluir" />
        </Linha>
        <Linha Icone={Trash2} titulo="Itens excluídos" descricao="Escolha o destino padrão ao apagar um item.">
          <Seletor valor={prefs.destinoExclusao} opcoes={DESTINOS} onChange={(destinoExclusao) => alterar({ destinoExclusao })} label="Destino dos itens excluídos" />
        </Linha>
        <Linha Icone={Paperclip} titulo="Anexos ao excluir" descricao="O que fazer com anexos que não são usados em outro lugar.">
          <Seletor valor={prefs.excluirAnexos} opcoes={ANEXOS} onChange={(excluirAnexos) => alterar({ excluirAnexos })} label="Anexos ao excluir" />
        </Linha>
      </Secao>

      {iconesAbertos && <IconesPorExtensao valor={prefs.exploradorIconesExtensao} onChange={(exploradorIconesExtensao) => alterar({ exploradorIconesExtensao })} aoFechar={() => setIconesAbertos(false)} />}
    </div>
  );
}
