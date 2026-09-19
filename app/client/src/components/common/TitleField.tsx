import { useLayoutEffect, useRef } from "react";
import { useIsMobile } from "@/lib/use-viewport";

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  className: string;
  autoFocus?: boolean;
}

/**
 * O título fica compacto no desktop, mas no mobile é naturalmente mais
 * longo. Começa com espaço para duas linhas e cresce somente até a terceira
 * para não deslocar o restante do editor de forma inesperada.
 */
export function TitleField({ id, value, onChange, placeholder, ariaLabel, className, autoFocus }: Props) {
  const mobile = useIsMobile();
  const area = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    if (!mobile || !area.current) return;
    const campo = area.current;
    campo.style.height = "auto";
    const estilos = getComputedStyle(campo);
    const alturaMaxima = parseFloat(estilos.lineHeight) * 3
      + parseFloat(estilos.paddingTop) + parseFloat(estilos.paddingBottom)
      + parseFloat(estilos.borderTopWidth) + parseFloat(estilos.borderBottomWidth);
    campo.style.height = `${Math.min(campo.scrollHeight, alturaMaxima)}px`;
  }, [mobile, value]);

  if (!mobile) {
    return <input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} className={className} />;
  }

  return (
    <textarea
      ref={area}
      id={id}
      rows={2}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className={`${className} min-h-[80px] max-h-[108px] resize-none overflow-y-auto leading-7`}
    />
  );
}
