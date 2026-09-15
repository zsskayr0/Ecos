import type { ReactNode } from "react";

/**
 * Renderização mínima e real (não simulada) de checkbox / wikilink / código
 * inline, pro preview do editor de Nota (seção 3.6). Não é um parser
 * Markdown completo — cobre exatamente o que a especificação pede.
 */
export function renderMarkdownMini(texto: string): ReactNode[] {
  return texto.split("\n").map((linha, i) => {
    const checkboxMatch = linha.match(/^-\s\[( |x|X)\]\s(.*)$/);
    if (checkboxMatch) {
      const marcado = checkboxMatch[1].toLowerCase() === "x";
      return (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <input type="checkbox" readOnly checked={marcado} className="accent-steel-400" />
          <span className={marcado ? "text-text-muted line-through" : "text-text-primary"}>
            {renderInline(checkboxMatch[2])}
          </span>
        </div>
      );
    }
    return (
      <p key={i} className="py-0.5 text-text-primary">
        {renderInline(linha) || <>&nbsp;</>}
      </p>
    );
  });
}

function renderInline(texto: string): ReactNode[] {
  const partes: ReactNode[] = [];
  const regex = /(\[\[[^\]]+\]\]|`[^`]+`|\*\*[^*]+\*\*)/g;
  let ultimo = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(texto))) {
    if (match.index > ultimo) partes.push(texto.slice(ultimo, match.index));
    const token = match[0];
    if (token.startsWith("[[")) {
      partes.push(
        <span key={key++} className="font-medium text-steel-300">
          {token}
        </span>,
      );
    } else if (token.startsWith("`")) {
      partes.push(
        <code key={key++} className="rounded bg-surface-3 px-1 py-0.5 font-mono-value text-[13px]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      partes.push(
        <strong key={key++} className="font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    ultimo = match.index + token.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return partes;
}
