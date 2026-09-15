import { useNavigate } from "react-router-dom";
import { ChevronLeft, Moon, Sun } from "lucide-react";
import { useTema } from "@/lib/theme";

/**
 * GAP-04 (continuação): "Aparência" está listada no índice de Configurações
 * (seção 3.12) sem detalhamento de conteúdo. Assumido o mínimo consistente
 * com a especificação: alternar dark/light, já que ambos os modos têm
 * paleta própria fechada na seção 1.3 — dark como padrão do produto.
 */
export function AparenciaScreen() {
  const navigate = useNavigate();
  const { tema, setTema } = useTema();

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-5 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Aparência</h1>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setTema("dark")}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            tema === "dark" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Moon size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Escuro</span>
          <span className="text-xs text-text-muted">Padrão do Ecos</span>
        </button>
        <button
          onClick={() => setTema("light")}
          className={`flex flex-1 flex-col items-center gap-2 rounded-2xl border p-5 ${
            tema === "light" ? "border-steel-400 bg-surface-1" : "border-border bg-surface-1/50"
          }`}
        >
          <Sun size={22} strokeWidth={1.5} className="text-steel-300" />
          <span className="text-sm font-medium text-text-primary">Claro</span>
          <span className="text-xs text-text-muted">Tom azulado</span>
        </button>
      </div>
    </div>
  );
}
