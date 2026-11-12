import { lazy, Suspense, useState } from "react";
import { File, Plus, RotateCcw, X } from "lucide-react";
import { Dialog } from "@/components/common/Dialog";
import { IconePorNome } from "@/components/common/IconePorNome";
import { IconeImagem, idDoIconeImagem } from "@/lib/icones-personalizados";

const IconPicker = lazy(() => import("@/screens/Vault/IconPicker"));

/** Tipos mais comuns; a pessoa pode somar outros pela extensão. */
const COMUNS = ["pdf", "docx", "xlsx", "pptx", "gdoc", "gsheet", "gslides", "jpg", "png", "mp3", "mp4", "zip", "txt", "csv"];

interface Props {
  valor: Record<string, string>;
  onChange: (proximo: Record<string, string>) => void;
  aoFechar: () => void;
}

const limpar = (texto: string) => texto.trim().replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);

function Miniatura({ icone }: { icone: string | undefined }) {
  const imagem = idDoIconeImagem(icone);
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
      {imagem ? <IconeImagem id={imagem} size={16} /> : icone ? <IconePorNome nome={icone} padrao="File" size={16} /> : <File size={16} className="text-text-muted" />}
    </span>
  );
}

/** Ícone próprio por extensão para a árvore lateral. Sem escolha vale o ícone padrão do tipo de arquivo. */
export function IconesPorExtensao({ valor, onChange, aoFechar }: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [nova, setNova] = useState("");
  const extensoes = [...new Set([...COMUNS, ...Object.keys(valor)])];

  function definir(ext: string, icone: string) {
    onChange({ ...valor, [ext]: icone });
  }
  function restaurar(ext: string) {
    const resto = { ...valor };
    delete resto[ext];
    onChange(resto);
  }
  function adicionar() {
    const ext = limpar(nova);
    if (!ext) return;
    setNova("");
    setEditando(ext);
  }

  return (
    <Dialog rotuloId="icones-extensao-titulo" onFechar={aoFechar}>
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col rounded-2xl border border-border bg-surface-1 p-5 shadow-nav">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="icones-extensao-titulo" className="font-semibold text-text-primary">Ícones por tipo de arquivo</h2>
          <button type="button" onClick={aoFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2" aria-label="Fechar"><X size={17} /></button>
        </div>
        <p className="mb-3 text-xs text-text-muted">Vale para os arquivos que não são notas nem tarefas, na árvore do menu lateral. Sem escolha, o Ecos usa o ícone padrão do tipo.</p>

        {editando ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="mb-2 text-sm text-text-secondary">Ícone para arquivos <span className="font-mono-value font-medium uppercase text-text-primary">.{editando}</span></p>
            <div className="ecos-anexos-raiz">
              <Suspense fallback={<p className="text-sm text-text-muted">Carregando ícones…</p>}>
                <IconPicker value={valor[editando] ?? ""} onChange={(nome) => definir(editando, nome)} cor="#9ca3af" personalizados />
              </Suspense>
            </div>
            <button type="button" onClick={() => setEditando(null)} className="mt-4 min-h-10 rounded-lg bg-steel-700 px-3 text-sm font-medium text-on-steel">Concluir</button>
          </div>
        ) : (
          <>
            <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {extensoes.map((ext) => (
                <li key={ext} className="flex items-center gap-3 py-2">
                  <Miniatura icone={valor[ext]} />
                  <span className="flex-1 font-mono-value text-sm uppercase text-text-primary">.{ext}</span>
                  {valor[ext] && <button type="button" onClick={() => restaurar(ext)} aria-label={`Voltar ao padrão em .${ext}`} title="Voltar ao padrão" className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><RotateCcw size={15} /></button>}
                  <button type="button" onClick={() => setEditando(ext)} className="min-h-8 rounded-lg border border-border px-2.5 text-xs font-medium text-text-secondary hover:bg-surface-2">{valor[ext] ? "Trocar" : "Escolher"}</button>
                </li>
              ))}
            </ul>
            <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); adicionar(); }}>
              <input value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Outra extensão (ex.: epub)" aria-label="Outra extensão" className="ecos-input min-w-0 flex-1 !rounded-lg" />
              <button type="submit" disabled={!limpar(nova)} className="flex min-h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-secondary hover:bg-surface-2 disabled:opacity-40"><Plus size={15} />Adicionar</button>
            </form>
          </>
        )}
      </div>
    </Dialog>
  );
}
