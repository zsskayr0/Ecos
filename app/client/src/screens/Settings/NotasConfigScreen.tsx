import { Maximize2, Pencil } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { useIsDesktop } from "@/lib/use-viewport";
import { Cabecalho, Linha, Secao, usePreferencias } from "./campos-config";
import { LinhasPastaETags } from "./novo-item-config";

/** Tudo que é só de notas: como uma nota abre e com o que uma nota nova nasce. */
export function NotasConfigScreen() {
  const desktop = useIsDesktop();
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Notas" />

      <Secao titulo="Ao abrir uma nota">
        <Linha Icone={Maximize2} titulo="Abrir notas maximizadas" descricao="A nota já abre no modo Focus. O botão de maximizar na janela continua alternando.">
          <Toggle checked={prefs.notaMaximizada} onChange={(notaMaximizada) => alterar({ notaMaximizada })} label="Abrir notas maximizadas" />
        </Linha>
        <Linha Icone={Pencil} titulo="Abrir notas em edição" descricao="Ao abrir uma nota existente, o texto já fica editável. Desligado, ela abre em visualização e você alterna quando quiser.">
          <Toggle checked={prefs.notaAbreEditando} onChange={(notaAbreEditando) => alterar({ notaAbreEditando })} label="Abrir notas em edição" />
        </Linha>
      </Secao>

      <Secao titulo="Nova nota">
        <LinhasPastaETags tipo="nota"
          pasta={prefs.notaNovaPasta} aoMudarPasta={(notaNovaPasta) => alterar({ notaNovaPasta })}
          pastaFixa={prefs.notaNovaPastaFixa} aoMudarPastaFixa={(notaNovaPastaFixa) => alterar({ notaNovaPastaFixa })}
          tagsModo={prefs.notaNovaTagsModo} aoMudarTagsModo={(notaNovaTagsModo) => alterar({ notaNovaTagsModo })}
          tags={prefs.notaNovaTags} aoMudarTags={(notaNovaTags) => alterar({ notaNovaTags })} />
        {desktop && (
          <Linha Icone={Maximize2} titulo="Criar maximizada" descricao="A janela de criação já abre no modo Focus. Sair do Focus fecha a criação, salvando o que foi escrito.">
            <Toggle checked={prefs.notaNovaMaximizada} onChange={(notaNovaMaximizada) => alterar({ notaNovaMaximizada })} label="Criar notas maximizadas" />
          </Linha>
        )}
      </Secao>
    </div>
  );
}
