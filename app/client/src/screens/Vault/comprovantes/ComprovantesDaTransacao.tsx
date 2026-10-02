import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { ANEXO_TAMANHO_MAXIMO_BYTES, ApiError, vault, type AnexoApi } from "@/lib/api";
import { MiniaturaDoAnexo } from "./Miniatura";
import { VisualizadorDaTransacao } from "./VisualizadorDaTransacao";

const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

/**
 * Anexos de um lançamento, mostrados como miniaturas do próprio comprovante: clicar abre o visualizador (com setas se
 * houver mais de um), anexar e remover ficam aqui mesmo. O arquivo fica cifrado dentro do Cofre.
 */
export function ComprovantesDaTransacao({ transacaoId, aoMudar }: { transacaoId: string; aoMudar?: () => void }) {
  const [anexos, setAnexos] = useState<AnexoApi[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aberto, setAberto] = useState<number | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function carregar() {
    try {
      setAnexos((await vault.anexos.listar(transacaoId)) ?? []);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível carregar os anexos.");
      setAnexos((atual) => atual ?? []);
    }
  }
  useEffect(() => {
    setAnexos(null);
    setErro(null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transacaoId]);

  async function enviar(arquivos: FileList | null) {
    const lista = Array.from(arquivos ?? []);
    if (entrada.current) entrada.current.value = "";
    if (!lista.length) return;
    setErro(null);
    setAviso(null);
    const grande = lista.find((f) => f.size > ANEXO_TAMANHO_MAXIMO_BYTES);
    if (grande) { setErro(`“${grande.name}” passa de 8 MB. Escolha um arquivo menor.`); return; }
    setEnviando(true);
    try {
      for (const arquivo of lista) {
        const r = await vault.anexos.enviar(transacaoId, arquivo);
        if (r.duplicado_em) setAviso(`“${arquivo.name}” já estava anexado a outro lançamento. Foi guardado aqui também.`);
      }
      await carregar();
      aoMudar?.();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível anexar o arquivo.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover(anexo: AnexoApi) {
    if (!window.confirm(`Remover “${anexo.nome_arquivo}”? O arquivo será apagado do Cofre.`)) return;
    setErro(null);
    try {
      await vault.anexos.excluir(anexo.id);
      await carregar();
      aoMudar?.();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível remover o arquivo.");
    }
  }

  return (
    <section className="cofre-anexos" aria-label="Anexos do lançamento">
      <div className="cofre-anexos-head">
        <h3><Paperclip size={14} aria-hidden />Anexos{anexos && anexos.length > 0 && <span>{anexos.length}</span>}</h3>
      </div>
      {erro && <p role="alert" className="cofre-transactions-error">{erro}</p>}
      {aviso && <p role="status" className="cofre-transactions-feedback">{aviso}</p>}
      {anexos === null ? <p className="cofre-anexos-vazio" role="status">Carregando anexos…</p> : (
        <ul className="cofre-anexos-grade">
          {anexos.map((a, i) => (
            <li key={a.id} className="cofre-anexo-item">
              <button type="button" className="cofre-anexo-tile" onClick={() => setAberto(i)} aria-label={`Abrir ${a.nome_arquivo}`} title={a.nome_arquivo}>
                <MiniaturaDoAnexo id={a.id} mime={a.mime_type} />
                <span className="cofre-anexo-nome">{a.nome_arquivo}</span>
              </button>
              <button type="button" className="cofre-anexo-remover" aria-label={`Remover ${a.nome_arquivo}`} onClick={() => void remover(a)}><X size={13} aria-hidden /></button>
            </li>
          ))}
          <li className="cofre-anexo-item">
            <button type="button" className="cofre-anexo-novo" disabled={enviando} onClick={() => entrada.current?.click()}>
              <Paperclip size={20} aria-hidden />
              <span>{enviando ? "Enviando…" : "Anexar"}</span>
            </button>
          </li>
        </ul>
      )}
      {anexos !== null && anexos.length === 0 && <p className="cofre-anexos-vazio">Nenhum anexo neste lançamento. Anexe um PDF ou uma foto (até 8 MB).</p>}
      <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label="Escolher arquivos de comprovante" onChange={(e) => void enviar(e.target.files)} />
      {aberto !== null && anexos && <VisualizadorDaTransacao transacaoId={transacaoId} anexos={anexos} inicial={aberto} onFechar={() => setAberto(null)} aoMudar={aoMudar} />}
    </section>
  );
}
