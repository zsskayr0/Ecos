import * as Icons from "lucide-react/dist/cjs/lucide-react.js";
import type { CSSProperties } from "react";

/** Ícone do lucide por nome (PascalCase ou kebab). Usa o conjunto completo (ver vite.config.ts): só carrega junto com quem precisa dele. */
export default function IconePorNomeImpl({ nome, padrao = "Circle", size, style }: { nome: string; padrao?: string; size?: number; style?: CSSProperties }) {
  const mapa = Icons as unknown as Record<string, Icons.LucideIcon>;
  const pascal = nome.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  const Icone = mapa[nome] ?? mapa[pascal] ?? mapa[padrao] ?? Icons.Circle;
  return <Icone size={size} style={style} />;
}
