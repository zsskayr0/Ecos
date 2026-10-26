import type { ReactNode } from "react";
import { estiloDaTag, useCoresDasTags } from "@/lib/tag-cor";

/**
 * Chip de tag na cor do catálogo do espaço. O tamanho e o formato ficam por conta de quem usa (`className`);
 * `espaco` ausente = a cor da tag em qualquer espaço que a tenha.
 */
export function ChipTag({ tag, espaco, className = "", children, titulo, as: Tag = "span" }: { tag: string; espaco?: string; className?: string; children?: ReactNode; titulo?: string; as?: "span" | "li" }) {
  const corDe = useCoresDasTags();
  return <Tag className={className} style={estiloDaTag(corDe(tag, espaco))} title={titulo}>{children ?? <>#{tag}</>}</Tag>;
}
