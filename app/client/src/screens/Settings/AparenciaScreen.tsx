import { Contrast, Cpu, Wind, ZoomIn, type LucideIcon } from "lucide-react";
import { useTema } from "@/lib/theme";
import { Toggle } from "@/components/common/Toggle";
import { TOM } from "@/components/common/MenuSuspenso";
import { ESCALAS_INTERFACE, type AltoContraste, type ReduzirMovimento } from "@/lib/preferencias-aplicativo";
import { SeletorTema } from "./SeletorTema";
import { Cabecalho, Linha, Secao, Seletor, SegmentadoDeslizante, usePreferencias } from "./campos-config";

const MOVIMENTOS = [
  { valor: "sistema", rotulo: "Seguir o sistema", icone: Wind, cor: TOM.aco },
  { valor: "desligado", rotulo: "Desligado", icone: Wind, cor: TOM.ciano },
  { valor: "ligado", rotulo: "Ligado", icone: Wind, cor: TOM.violeta },
] as const satisfies readonly { valor: ReduzirMovimento; rotulo: string; icone: LucideIcon; cor: string }[];

const CONTRASTES = [
  { valor: "sistema", rotulo: "Seguir o sistema", icone: Contrast, cor: TOM.aco },
  { valor: "desligado", rotulo: "Desligado", icone: Contrast, cor: TOM.ciano },
  { valor: "ligado", rotulo: "Ligado", icone: Contrast, cor: TOM.violeta },
] as const satisfies readonly { valor: AltoContraste; rotulo: string; icone: LucideIcon; cor: string }[];

/** Só o que muda a cara do Ecos: tema, tamanho, contraste e movimento. Idioma, pastas e escrita têm telas próprias. */
export function AparenciaScreen() {
  const { modo, setTema } = useTema();
  const [prefs, alterar] = usePreferencias();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Aparência" />

      <SeletorTema modo={modo} aoEscolher={setTema} reduzirMovimento={prefs.reduzirMovimento === "ligado"} />

      <Secao titulo="Tamanho e contraste">
        <Linha Icone={ZoomIn} titulo="Tamanho da interface" descricao="Aumenta ou reduz textos, espaços e botões de uma vez. Alguns textos pequenos têm tamanho fixo.">
          <SegmentadoDeslizante valor={prefs.escalaInterface} opcoes={ESCALAS_INTERFACE} onChange={(escalaInterface) => alterar({ escalaInterface })} label="Tamanho da interface" rotuloDe={(e) => `${e}%`} />
        </Linha>
        <Linha Icone={Contrast} titulo="Alto contraste" descricao="Aumente o contraste para melhorar a visibilidade.">
          <Seletor valor={prefs.altoContraste} opcoes={CONTRASTES} onChange={(altoContraste) => alterar({ altoContraste })} label="Alto contraste" />
        </Linha>
      </Secao>

      <Secao titulo="Movimento e desempenho">
        <Linha Icone={Wind} titulo="Reduzir movimento" descricao="Tira animações e transições, inclusive o giro do globo. No modo Sistema, segue a configuração do aparelho.">
          <Seletor valor={prefs.reduzirMovimento} opcoes={MOVIMENTOS} onChange={(reduzirMovimento) => alterar({ reduzirMovimento })} label="Reduzir movimento" />
        </Linha>
        <Linha Icone={Cpu} titulo="Aceleração de hardware" descricao="Usa a GPU para deixar animações e painéis mais fluidos. A mudança é aplicada ao reiniciar o app.">
          <Toggle checked={prefs.aceleracaoHardware} onChange={(aceleracaoHardware) => alterar({ aceleracaoHardware })} label="Aceleração de hardware" />
        </Linha>
      </Secao>
    </div>
  );
}
