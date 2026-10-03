import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, Receipt, X } from "lucide-react";
import { ApiError, vault, type TipoAnexo } from "@/lib/api";
import { ROTULOS_ANEXO } from "./rotulos";
import { ANEXO_TAMANHO_MAXIMO_BYTES, ehArquivoDoCofre } from "@/lib/tipos-comprovante";
import { prepararComprovante } from "@/lib/preparar-comprovante";

const ACEITOS = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

/**
 * Sobe os anexos escolhidos antes de o lançamento existir. Foto acima do limite é reduzida; o que falhar não impede
 * o resto. Devolve as mensagens de falha (vazio = tudo certo).
 */
export async function enviarAnexosPendentes(transacaoId: string, arquivos: File[], tipo: TipoAnexo = "comprovante"): Promise<string[]> {
  const falhas: string[] = [];
  for (const original of arquivos) {
    try {
      await vault.anexos.enviar(transacaoId, await prepararComprovante(original), tipo);
    } catch (e) {
      falhas.push(e instanceof ApiError || e instanceof Error ? e.message : `Não foi possível anexar “${original.name}”.`);
    }
  }
  return falhas;
}

/** Comprovantes (ou notas fiscais) de um lançamento NOVO: ficam na memória até salvar; aí são enviados ao Cofre. */
export function AnexosPendentes({ arquivos, onChange, tipo = "comprovante" }: { arquivos: File[]; onChange: (arquivos: File[]) => void; tipo?: TipoAnexo }) {
  const r = ROTULOS_ANEXO[tipo];
  const Icone = tipo === "nota_fiscal" ? Receipt : Paperclip;
  const entrada = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Pré-visualização das imagens; as URLs são soltas ao trocar a lista ou sair.
  const previas = useMemo(() => arquivos.map((a) => (a.type.startsWith("image/") && a.type !== "image/heic" ? URL.createObjectURL(a) : null)), [arquivos]);
  useEffect(() => () => { previas.forEach((u) => { if (u) URL.revokeObjectURL(u); }); }, [previas]);

  function adicionar(escolhidos: FileList | null) {
    const lista = Array.from(escolhidos ?? []);
    if (entrada.current) entrada.current.value = "";
    if (!lista.length) return;
    const invalido = lista.find((f) => !ehArquivoDoCofre(f));
    if (invalido) { setErro(`“${invalido.name}” não pode ser anexado. Use PDF, JPEG, PNG, WebP ou HEIC.`); return; }
    // Foto grande é reduzida na hora de enviar; PDF e HEIC acima do limite não têm como, então avisa já.
    const grande = lista.find((f) => f.size > ANEXO_TAMANHO_MAXIMO_BYTES && (f.type === "application/pdf" || f.type === "image/heic"));
    if (grande) { setErro(`“${grande.name}” passa de 8 MB. Escolha um arquivo menor.`); return; }
    setErro(null);
    onChange([...arquivos, ...lista]);
  }

  return (
    <section className="cofre-anexos" data-tipo={tipo} aria-label={`${r.titulo} do lançamento`}>
      <div className="cofre-anexos-head">
        <h3><Icone size={14} aria-hidden />{r.titulo}{arquivos.length > 0 && <span>{arquivos.length}</span>}</h3>
      </div>
      {erro && <p role="alert" className="cofre-transactions-error">{erro}</p>}
      <ul className="cofre-anexos-grade">
        {arquivos.map((a, i) => (
          <li key={`${a.name}-${a.size}-${i}`} className="cofre-anexo-item">
            <div className="cofre-anexo-tile" title={a.name}>
              <span className="cofre-comprovante-thumb">{previas[i] ? <img src={previas[i]!} alt="" /> : <FileText size={28} aria-hidden />}</span>
              <span className="cofre-anexo-nome">{a.name}</span>
            </div>
            <button type="button" className="cofre-anexo-remover" aria-label={`Tirar ${a.name}`} onClick={() => onChange(arquivos.filter((_, j) => j !== i))}><X size={13} aria-hidden /></button>
          </li>
        ))}
        <li className="cofre-anexo-item">
          <button type="button" className="cofre-anexo-novo" onClick={() => entrada.current?.click()}><Icone size={20} aria-hidden /><span>Anexar</span></button>
        </li>
      </ul>
      {arquivos.length === 0 && <p className="cofre-anexos-vazio">{r.titulo} são guardad{tipo === "nota_fiscal" ? "as" : "os"} quando você salvar o lançamento.</p>}
      <input ref={entrada} type="file" accept={ACEITOS} multiple hidden aria-label={`Escolher ${r.plural} do lançamento`} onChange={(e) => adicionar(e.target.files)} />
    </section>
  );
}
