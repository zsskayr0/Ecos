import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { diffLinhas, type NotaNoServidor } from "@/lib/nota-sincronia";

interface Props {
  servidor: NotaNoServidor;
  meuTitulo: string;
  meuCorpo: string;
  ocupado?: boolean;
  onManterMeu: () => void;
  onUsarServidor: () => void;
}

const BOTAO = "min-h-[40px] rounded-xl border border-border px-3 text-sm text-text-primary transition-colors hover:bg-surface-2 disabled:opacity-40";

/** A nota mudou em outro lugar enquanto esta tela editava: o autosave para até a pessoa escolher. */
export function ConflitoNota({ servidor, meuTitulo, meuCorpo, ocupado = false, onManterMeu, onUsarServidor }: Props) {
  const [vendoDiff, setVendoDiff] = useState(false);
  const linhas = useMemo(() => (vendoDiff ? diffLinhas(servidor.corpo, meuCorpo) : []), [vendoDiff, servidor.corpo, meuCorpo]);
  return (
    <div role="alert" className="mb-5 space-y-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-text-primary">
      <p className="flex items-start gap-2 font-medium"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning" />Esta nota mudou em outro lugar</p>
      <p className="text-text-secondary">Parei de salvar sozinho para não sobrescrever nada. O que você digitou continua guardado neste aparelho.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={ocupado} onClick={onManterMeu} className={BOTAO}>Manter o meu</button>
        <button type="button" disabled={ocupado} onClick={onUsarServidor} className={BOTAO}>Usar o do servidor</button>
        <button type="button" aria-expanded={vendoDiff} onClick={() => setVendoDiff((v) => !v)} className={BOTAO}>{vendoDiff ? "Esconder diferenças" : "Ver diferenças"}</button>
      </div>
      {vendoDiff && (
        <div className="space-y-2">
          {servidor.titulo !== meuTitulo && <p className="text-text-secondary">Título no servidor: <strong className="text-text-primary">{servidor.titulo}</strong> · o seu: <strong className="text-text-primary">{meuTitulo}</strong></p>}
          <p className="text-xs text-text-muted"><span className="text-error">− só no servidor</span> · <span className="text-success">+ só no seu</span></p>
          <pre aria-label="Diferenças por linha" className="max-h-80 overflow-auto rounded-lg bg-surface-1 p-2 font-mono text-xs leading-relaxed">
            {linhas.map((l, i) => (
              <div key={i} className={l.tipo === "removida" ? "bg-error/15 text-error" : l.tipo === "adicionada" ? "bg-success/15 text-success" : "text-text-secondary"}>
                {l.tipo === "removida" ? "− " : l.tipo === "adicionada" ? "+ " : "  "}{l.texto || " "}
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
