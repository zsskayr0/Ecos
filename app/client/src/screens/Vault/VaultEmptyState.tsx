import { Plus } from "lucide-react";
import { CURVAS } from "@/components/brand/LogoAnimada";

function Ilustracao({ carregando }: { carregando?: boolean }) {
  return <div className="cofre-empty-art" data-carregando={carregando || undefined} aria-hidden="true">
    <div className="cofre-empty-card"><i /><i /><i /></div>
    <span className="cofre-empty-badge"><svg viewBox="0 0 680 640" width={22} height={21}>
        <defs><linearGradient id="cofre-empty-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7fd3ff" /><stop offset="1" stopColor="#2f7dff" /></linearGradient></defs>
        {CURVAS.map((d, i) => <path key={i} d={d} fillRule="evenodd" fill="url(#cofre-empty-grad)" />)}
      </svg></span>
  </div>;
}

export function VaultEmptyState({ carregando, titulo, descricao, onNovo }: {
  carregando?: boolean; titulo: string; descricao?: string; onNovo?: () => void;
}) {
  return <div className="cofre-empty" role="status" aria-busy={carregando || undefined}>
    <Ilustracao carregando={carregando} />
    <h3>{titulo}</h3>
    {descricao && <p>{descricao}</p>}
    {onNovo && <button type="button" className="cofre-new-button cofre-empty-action" onClick={onNovo}><Plus size={14} />Novo lançamento</button>}
  </div>;
}
