import * as Icons from "lucide-react";
import type { CategoriaApi } from "@/lib/api";

export const COR_SEM_CATEGORIA = "#6b6c72";
export const CORES = ["#f29a9f", "#fda4af", "#fdba74", "#fcd34d", "#bef264", "#86d7ad", "#5eead4", "#7dd3fc", "#93c5fd", "#a5b4fc", "#c4b5fd", "#f0abfc", "#f9a8d4", "#d4d4d8", "#a8a29e", "#94a3b8"];

export function resolverIcone(nome?: string | null): Icons.LucideIcon {
  if (!nome) return Icons.Tag;
  const mapa = Icons as unknown as Record<string, Icons.LucideIcon>;
  if (mapa[nome]) return mapa[nome];
  const pascal = nome.split(/[-_ ]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return mapa[pascal] ?? Icons.Tag;
}

/** Ícone da categoria sobre a cor dela (o mesmo da tela de Categorias); sem categoria, um ponto de interrogação neutro. */
export function CategoriaIcone({ categoria, tamanho = 16, className = "cofre-cats-icon" }: { categoria?: Pick<CategoriaApi, "icone" | "cor" | "nome"> | null; tamanho?: number; className?: string }) {
  if (!categoria) return <span className={className} style={{ background: COR_SEM_CATEGORIA, color: "#ffffff" }} aria-hidden><Icons.CircleHelp size={tamanho} /></span>;
  const Icone = resolverIcone(categoria.icone);
  return <span className={className} style={{ background: categoria.cor, color: corDoTexto(categoria.cor) }} aria-hidden><Icone size={tamanho} /></span>;
}

/** Texto legível sobre a cor da categoria (preto ou branco, pela luminância). */
export function corDoTexto(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#0b0b0b";
  const n = parseInt(m[1]!, 16);
  const luz = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luz > 0.6 ? "#0b0b0b" : "#ffffff";
}
