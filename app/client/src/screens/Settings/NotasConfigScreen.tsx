import { FileText, Pencil, PanelRight, ScrollText } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { useIsDesktop } from "@/lib/use-viewport";
import { Cabecalho, Linha, Secao, Segmentado, usePreferencias } from "./campos-config";
import { LinhasPastaETags } from "./novo-item-config";

/** Tudo que é só de notas: como uma nota abre e com o que uma nota nova nasce. */
export function NotasConfigScreen() {
  const desktop = useIsDesktop();
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Notas" />

      <Secao titulo="Ao abrir uma nota">
        <Linha Icone={Pencil} titulo="Abrir notas em edição" descricao="Ao abrir uma nota existente, o texto já fica editável. Desligado, ela abre em visualização e você alterna quando quiser.">
          <Toggle checked={prefs.notaAbreEditando} onChange={(notaAbreEditando) => alterar({ notaAbreEditando })} label="Abrir notas em edição" />
        </Linha>
        <Linha Icone={ScrollText} titulo="Leitura no celular" descricao="Fluido: o texto reflui na largura da tela. Página: folha A4 reduzida, com zoom pela pinça. Trocar numa nota vale por 2 minutos depois que você a fecha; depois volta a este padrão. Notas com escrita à mão ficam sempre em Página.">
          <Segmentado valor={prefs.notaModoLeitura} opcoes={[{ id: "fluido", rotulo: "Fluido", Icone: ScrollText }, { id: "pagina", rotulo: "Página", Icone: FileText }]} onChange={(notaModoLeitura) => alterar({ notaModoLeitura })} label="Leitura da nota no celular" />
        </Linha>
        <Linha Icone={Pencil} titulo="Edição no celular" descricao="O modo com que a nota abre ao editar. Pode ser diferente do da leitura, mas aí a tela muda ao tocar em Editar.">
          <Segmentado valor={prefs.notaModoEdicao} opcoes={[{ id: "fluido", rotulo: "Fluido", Icone: ScrollText }, { id: "pagina", rotulo: "Página", Icone: FileText }]} onChange={(notaModoEdicao) => alterar({ notaModoEdicao })} label="Edição da nota no celular" />
        </Linha>
      </Secao>

      <Secao titulo="Nova nota">
        <LinhasPastaETags tipo="nota"
          pasta={prefs.notaNovaPasta} aoMudarPasta={(notaNovaPasta) => alterar({ notaNovaPasta })}
          pastaFixa={prefs.notaNovaPastaFixa} aoMudarPastaFixa={(notaNovaPastaFixa) => alterar({ notaNovaPastaFixa })}
          tagsModo={prefs.notaNovaTagsModo} aoMudarTagsModo={(notaNovaTagsModo) => alterar({ notaNovaTagsModo })}
          tags={prefs.notaNovaTags} aoMudarTags={(notaNovaTags) => alterar({ notaNovaTags })} />
        {desktop && (
          <>
            <Linha Icone={PanelRight} titulo="Barra lateral aberta na criação" descricao="Na criação, o painel de opções (equipe, pasta, tags e anexos) já começa aberto.">
              <Toggle checked={prefs.notaNovaPainelAberto} onChange={(notaNovaPainelAberto) => alterar({ notaNovaPainelAberto })} label="Barra lateral aberta na criação" />
            </Linha>
          </>
        )}
      </Secao>
    </div>
  );
}
