import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Receipt } from "lucide-react";
import { ANEXO_TAMANHO_MAXIMO_BYTES, ApiError, vault, type AnexoApi, type TipoAnexo } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { VisualizadorDaTransacao } from "./VisualizadorDaTransacao";
import { ROTULOS_ANEXO } from "./rotulos";

const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

const parar = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Ícone de comprovante (clipe) ou de nota fiscal (recibo) de cada lançamento na lista. Só o ícone: ele fica mais forte
 * quando há arquivo, e a contagem aparece na dica. Com arquivos, clicar abre o visualizador (com o lançamento ao lado);
 * sem, abre a escolha de arquivo e, depois de enviado, mostra o que entrou.
 * Fica dentro da linha, que abre o lançamento ao ser clicada: por isso nada aqui deixa o clique "vazar" para a linha.
 */
export function BotaoAnexos({ transacaoId, quantidade, descricao, aoMudar, tipo = "comprovante" }: {
  transacaoId: string;
  quantidade: number;
  descricao: string;
  /** Algo mudou (anexo enviado/removido, lançamento editado): a lista precisa recarregar. */
  aoMudar: () => void;
  tipo?: TipoAnexo;
}) {
  const [anexos, setAnexos] = useState<AnexoApi[] | null>(null);
  const [inicial, setInicial] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const r = ROTULOS_ANEXO[tipo];
  const Icone = tipo === "nota_fiscal" ? Receipt : Paperclip;

  async function abrir(ultimo = false) {
    setOcupado(true);
    try {
      const lista = (await vault.anexos.listar(transacaoId)).filter((a) => a.tipo === tipo);
      if (!lista.length) { avisar(`Este lançamento não tem ${r.plural}.`); return; }
      setInicial(ultimo ? lista.length - 1 : 0);
      setAnexos(lista);
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : `Não foi possível abrir ${r.artigoPlural} ${r.plural}.`);
    } finally {
      setOcupado(false);
    }
  }

  async function anexar(arquivos: FileList | null) {
    const lista = Array.from(arquivos ?? []);
    if (entrada.current) entrada.current.value = "";
    if (!lista.length) return;
    const grande = lista.find((f) => f.size > ANEXO_TAMANHO_MAXIMO_BYTES);
    if (grande) { avisar(`“${grande.name}” passa de 8 MB. Escolha um arquivo menor.`); return; }
    setOcupado(true);
    try {
      for (const arquivo of lista) await vault.anexos.enviar(transacaoId, arquivo, tipo);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível anexar o arquivo.");
      setOcupado(false);
      return;
    }
    setOcupado(false);
    await abrir(true); // mostra o arquivo que acabou de entrar
  }

  const tem = quantidade > 0;
  const contagem = `${quantidade} ${quantidade === 1 ? r.singular : r.plural}`;
  return (
    <>
      <button
        type="button"
        className="cofre-clipe"
        data-tipo={tipo}
        data-tem={tem || undefined}
        disabled={ocupado}
        aria-label={tem ? `${contagem} de ${descricao}` : `Anexar ${r.singular} a ${descricao}`}
        title={tem ? `${contagem}: clique para ver` : `Anexar ${r.singular}`}
        onClick={(e) => { e.stopPropagation(); if (tem) void abrir(); else entrada.current?.click(); }}
      >
        <Icone size={15} aria-hidden />
      </button>
      <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label={`Escolher ${r.singular} para ${descricao}`} onClick={parar} onChange={(e) => void anexar(e.target.files)} />
      {anexos && createPortal(
        // O visualizador sai da linha (portal), mas os eventos do React ainda subiriam até ela e abririam o lançamento.
        <div onClick={parar} onKeyDown={parar}>
          <VisualizadorDaTransacao transacaoId={transacaoId} anexos={anexos} inicial={inicial} comLancamento onFechar={() => setAnexos(null)} aoMudar={aoMudar} />
        </div>,
        document.querySelector(".cofre-app") ?? document.body,
      )}
    </>
  );
}
