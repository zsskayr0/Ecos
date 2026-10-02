import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip } from "lucide-react";
import { ANEXO_TAMANHO_MAXIMO_BYTES, ApiError, vault, type AnexoApi } from "@/lib/api";
import { avisar } from "@/lib/toast";
import { VisualizadorDaTransacao } from "./VisualizadorDaTransacao";

const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

const parar = (e: { stopPropagation: () => void }) => e.stopPropagation();

/**
 * Clipe de cada lançamento na lista. Com anexos, mostra quantos são e, ao clicar, abre o comprovante no visualizador
 * (com o lançamento ao lado). Sem anexos, clicar abre a escolha de arquivo e, depois de enviado, mostra o comprovante.
 * Fica dentro da linha, que abre o lançamento ao ser clicada: por isso nada aqui deixa o clique "vazar" para a linha.
 */
export function BotaoAnexos({ transacaoId, quantidade, descricao, aoMudar }: {
  transacaoId: string;
  quantidade: number;
  descricao: string;
  /** Algo mudou (anexo enviado/removido, lançamento editado): a lista precisa recarregar. */
  aoMudar: () => void;
}) {
  const [anexos, setAnexos] = useState<AnexoApi[] | null>(null);
  const [inicial, setInicial] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  async function abrir(ultimo = false) {
    setOcupado(true);
    try {
      const lista = await vault.anexos.listar(transacaoId);
      if (!lista.length) { avisar("Este lançamento não tem anexos."); return; }
      setInicial(ultimo ? lista.length - 1 : 0);
      setAnexos(lista);
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível abrir os anexos.");
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
      for (const arquivo of lista) await vault.anexos.enviar(transacaoId, arquivo);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ApiError ? e.message : "Não foi possível anexar o arquivo.");
      setOcupado(false);
      return;
    }
    setOcupado(false);
    await abrir(true); // mostra o comprovante que acabou de entrar
  }

  const tem = quantidade > 0;
  return (
    <>
      <button
        type="button"
        className="cofre-clipe"
        data-tem={tem || undefined}
        disabled={ocupado}
        aria-label={tem ? `${quantidade} ${quantidade === 1 ? "anexo" : "anexos"} de ${descricao}` : `Anexar comprovante a ${descricao}`}
        title={tem ? `${quantidade} ${quantidade === 1 ? "anexo" : "anexos"}: clique para ver` : "Anexar comprovante"}
        onClick={(e) => { e.stopPropagation(); if (tem) void abrir(); else entrada.current?.click(); }}
      >
        <Paperclip size={15} aria-hidden />
        {tem && <span className="cofre-clipe-n">{quantidade}</span>}
      </button>
      <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label={`Escolher comprovante para ${descricao}`} onClick={parar} onChange={(e) => void anexar(e.target.files)} />
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
