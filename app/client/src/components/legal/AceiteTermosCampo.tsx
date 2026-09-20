import type { DocumentoLegal } from "./DocumentoLegalDialog";

/** Checkbox de aceite dos Termos e da Política. Nunca vem marcado; os links abrem o texto sem sair da tela. */
export function AceiteTermosCampo({ marcado, onChange, onLer }: {
  marcado: boolean;
  onChange: (marcado: boolean) => void;
  onLer: (documento: DocumentoLegal) => void;
}) {
  const link = (documento: DocumentoLegal, texto: string) => (
    <button type="button" onClick={() => onLer(documento)} className="font-medium text-steel-300 underline underline-offset-2 hover:text-text-primary">
      {texto}
    </button>
  );
  return (
    <div className="flex items-start gap-3 text-sm text-text-secondary">
      <input
        id="aceite-termos"
        type="checkbox"
        checked={marcado}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-steel-500"
      />
      <span>
        <label htmlFor="aceite-termos" className="cursor-pointer">Li e aceito os </label>
        {link("termos", "Termos de uso")} e a {link("privacidade", "Política de privacidade")}.
      </span>
    </div>
  );
}
