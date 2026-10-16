import * as Icons from "lucide-react/dist/cjs/lucide-react.js";

/** Ícone do lucide por nome (PascalCase ou kebab). Usa o conjunto completo: importe só de telas já carregadas sob demanda. */
export function resolverIcone(nome?: string | null): Icons.LucideIcon {
  if (!nome) return Icons.Tag;
  const mapa = Icons as unknown as Record<string, Icons.LucideIcon>;
  if (mapa[nome]) return mapa[nome];
  const pascal = nome.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return mapa[pascal] ?? Icons.Tag;
}
