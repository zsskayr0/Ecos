import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { IconeImagem, enviarIconePersonalizado, removerIconePersonalizado, useIconesPersonalizados } from "@/lib/icones-personalizados";
import { mensagemDeErro } from "@/lib/erros";
import { avisar } from "@/lib/toast";

const nomeDoArquivo = (nome: string) => nome.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();

/** Imagens próprias (ex.: o logo de cada aplicativo) que aparecem no fim do seletor de ícones das pastas, na categoria "Personalizados". */
export function IconesPersonalizadosScreen() {
  const navigate = useNavigate();
  const itens = useIconesPersonalizados();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setEnviando(true);
    for (const arquivo of Array.from(arquivos)) {
      try { await enviarIconePersonalizado(arquivo, nomeDoArquivo(arquivo.name)); }
      catch (e) { avisar(`${arquivo.name}: ${mensagemDeErro(e, "Não foi possível enviar a imagem.")}`); }
    }
    setEnviando(false);
    if (entrada.current) entrada.current.value = "";
  }

  async function remover(id: string, nome: string) {
    try { await removerIconePersonalizado(id); avisar(`“${nome}” removido. Pastas que o usavam voltam ao ícone padrão.`); }
    catch (e) { avisar(mensagemDeErro(e, "Não foi possível remover o ícone.")); }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button aria-label="Voltar" data-voltar onClick={() => navigate(-1)} className="text-text-muted"><ChevronLeft size={22} /></button>
        <h1 className="font-display text-xl text-text-primary">Ícones personalizados</h1>
      </div>
      <p className="mb-4 max-w-xl text-sm text-text-muted">
        Envie imagens PNG, JPEG ou WebP (até 2 MB cada), como o logo de cada aplicativo. Elas aparecem no fim do seletor de ícones das pastas, na categoria “Personalizados”, com as cores originais. Só você enxerga os seus ícones.
      </p>
      <input ref={entrada} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => void enviar(e.target.files)} />
      <button type="button" disabled={enviando} onClick={() => entrada.current?.click()} className="mb-5 inline-flex items-center gap-2 rounded-xl border border-border bg-surface-1 px-4 py-2 text-sm text-text-primary hover:bg-surface-2 disabled:opacity-60">
        {enviando ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Adicionar imagens
      </button>
      {itens === null ? <p className="text-sm text-text-muted">Carregando…</p>
        : itens.length === 0 ? <p className="text-sm text-text-muted">Nenhum ícone personalizado ainda.</p>
        : <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
          {itens.map((i) => (
            <li key={i.id} className="group relative flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface-1 p-3">
              <IconeImagem id={i.id} size={40} />
              <span className="w-full truncate text-center text-xs text-text-primary" title={i.nome}>{i.nome}</span>
              <button type="button" aria-label={`Remover ${i.nome}`} onClick={() => void remover(i.id, i.nome)} className="absolute right-1.5 top-1.5 rounded-md p-1 text-text-muted opacity-0 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>}
    </div>
  );
}
