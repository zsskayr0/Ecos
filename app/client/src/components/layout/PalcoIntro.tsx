import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArteAuth } from "@/components/brand/ArteAuth";
import "@/styles/intro.css";

/** Duração da saída de uma etapa (ms) — deve casar com `--intro-saida` em `intro.css`. */
const SAIDA_MS = 200;

export type DirecaoEtapa = "avancar" | "voltar";

/**
 * Palco de toda a introdução antes do login (carregando → boas-vindas → onde está o Ecos → endereço → login).
 * Em telas largas a arte fica sempre montada à esquerda — as curvas de luz nunca reiniciam entre etapas — e só a coluna
 * da direita troca, com saída e entrada animadas; cada troca solta uma onda de eco a partir da logo. No celular vira só a coluna.
 */
export function PalcoIntro({ etapa, direcao = "avancar", children }: { etapa: string; direcao?: DirecaoEtapa; children: ReactNode }) {
  const [exibida, setExibida] = useState({ etapa, children, direcao });
  const [saindo, setSaindo] = useState(false);
  const [pulso, setPulso] = useState(0);
  const mostrada = useRef(etapa);
  const conteudoAtual = useRef(children);
  conteudoAtual.current = children;

  // Troca de etapa: anima a saída, depois entra a nova (com o conteúdo mais recente daquele momento).
  useEffect(() => {
    if (etapa === mostrada.current) return;
    setSaindo(true);
    setPulso((p) => p + 1);
    const t = window.setTimeout(() => {
      mostrada.current = etapa;
      setExibida({ etapa, children: conteudoAtual.current, direcao });
      setSaindo(false);
    }, SAIDA_MS);
    return () => window.clearTimeout(t);
  }, [etapa, direcao]);

  // Mesma etapa: só acompanha as atualizações de conteúdo (digitação, erros...), sem animar.
  useEffect(() => {
    if (etapa === mostrada.current) setExibida((atual) => (atual.children === children ? atual : { ...atual, children }));
  }, [etapa, children]);

  return (
    <div className="intro-palco min-h-screen bg-base lg:grid lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(440px,540px)] lg:overflow-hidden">
      <ArteAuth pulso={pulso} />
      {/* Só esta coluna rola (o cadastro é mais alto que o login) — a arte fica fixa na altura da janela. */}
      <div className="flex min-h-screen flex-col overflow-y-auto px-6 py-10 lg:min-h-0 lg:px-14">
        <div className="mx-auto my-auto w-full max-w-sm">
          <div
            key={exibida.etapa}
            data-direcao={exibida.direcao}
            className={saindo ? "intro-etapa intro-etapa-saindo" : "intro-etapa intro-etapa-entrando"}
            aria-hidden={saindo || undefined}
          >
            {exibida.children}
          </div>
        </div>
      </div>
    </div>
  );
}
