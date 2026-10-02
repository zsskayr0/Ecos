import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronDown } from "lucide-react";

const PERGUNTAS = [
  {
    q: "Onde ficam minhas Notas e Tarefas?",
    a: "Em arquivos .md dentro da pasta que você apontou pro Ecos no servidor — nada trafega pra fora sem você configurar sincronização.",
  },
  {
    q: "O que é o Cofre?",
    a: "Um módulo financeiro separado, opcional, protegido por senha própria. Fica isolado do resto do app — nem o servidor principal enxerga o conteúdo sem ele estar destravado.",
  },
  {
    q: "Por que uma Nota está marcada como Órfã?",
    a: "Órfã é o critério de ranking pra Notas sem nenhum link de entrada — ninguém referenciou ela em outro lugar. Não é ruim, só é um sinal de que ela pode estar esquecida.",
  },
  {
    q: "Perdi a senha do Cofre, e agora?",
    a: "Sem a senha, o Cofre não pode ser destravado — é criptografado de propósito. A recovery key da sua conta (mostrada uma única vez no cadastro) não recupera a senha do Cofre, são coisas separadas.",
  },
  {
    q: "Esqueci minha senha de login, e agora?",
    a: "Na tela de login, toque em \"Esqueci minha senha\", informe a recovery key da sua conta (mostrada uma única vez no cadastro) e escolha uma senha nova. Sem a chave, só quem administra o Ecos pode redefinir a senha. A chave não recupera a senha do Cofre.",
  },
  {
    q: "Posso usar de mais de um dispositivo?",
    a: "Sim, mas sincronização é opt-in — configure em Sincronização & Backup. Sem isso, cada dispositivo mantém sua própria cópia local.",
  },
];

/** GAP-05 (continued): a Drawer item with no content described in the spec (section 3.9) — minimal FAQ. */
export function HelpScreen() {
  const navigate = useNavigate();
  const [aberta, setAberta] = useState<number | null>(0);

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <div className="mb-6 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-muted">
          <ChevronLeft size={22} />
        </button>
        <h1 className="font-display text-xl text-text-primary">Central de ajuda</h1>
      </div>

      <div className="flex flex-col gap-2">
        {PERGUNTAS.map((p, i) => (
          <div key={p.q} className="rounded-2xl bg-surface-1">
            <button
              onClick={() => setAberta(aberta === i ? null : i)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left"
            >
              <span className="text-[15px] font-medium text-text-primary">{p.q}</span>
              <ChevronDown size={16} className={`shrink-0 text-text-muted transition-transform ${aberta === i ? "rotate-180" : ""}`} />
            </button>
            {aberta === i && <p className="px-4 pb-4 text-sm text-text-secondary">{p.a}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
