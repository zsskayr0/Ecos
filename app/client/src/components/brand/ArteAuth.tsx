import type { CSSProperties } from "react";
import { LogoAnimada } from "@/components/brand/LogoAnimada";

const CURVAS = [
  { d: "M -60 990 C 170 830, 300 650, 470 520 S 700 300, 880 240", cor: "var(--ecos-cyan)", duracao: "9s", atraso: "0s" },
  { d: "M 40 1010 C 250 870, 380 700, 545 600 S 770 420, 900 390", cor: "var(--ecos-violet)", duracao: "11s", atraso: "-4s" },
  { d: "M -140 900 C 50 760, 240 730, 380 560 S 620 210, 840 110", cor: "var(--ecos-steel-400)", duracao: "13s", atraso: "-8s" },
];

/** Cada camada é um trecho da curva com o mesmo ponto de frente — juntas formam um cometa que esmaece na cauda. */
const CAMADAS = [
  { comprimento: 0.4, opacidade: 0.12, largura: 2 },
  { comprimento: 0.24, opacidade: 0.24, largura: 2 },
  { comprimento: 0.12, opacidade: 0.45, largura: 2.2 },
  { comprimento: 0.04, opacidade: 0.95, largura: 2.6 },
];
const COMPRIMENTO_MAX = 0.4;

/**
 * Painel decorativo — só em telas largas; sempre escuro (é arte, não acompanha o tema), com curvas de luz na paleta da marca.
 * `pulso` sobe a cada troca de etapa da introdução: cada valor novo solta uma onda de "eco" a partir da logo.
 */
export function ArteAuth({ pulso = 0 }: { pulso?: number }) {
  return (
    <div aria-hidden className="auth-arte relative hidden overflow-hidden lg:block">
      <div className="auth-arte-brilho auth-arte-brilho-a" />
      <div className="auth-arte-brilho auth-arte-brilho-b" />

      <svg viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
        <defs>
          <filter id="brilho" filterUnits="userSpaceOnUse" x="-200" y="-200" width="1200" height="1400">
            <feGaussianBlur stdDeviation="5" result="desfoque" />
            <feMerge>
              <feMergeNode in="desfoque" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {CURVAS.map((curva) => (
          <g key={curva.d} style={{ color: curva.cor }}>
            <path d={curva.d} pathLength={1} className="auth-linha-base" />
            <g filter="url(#brilho)">
              {CAMADAS.map((camada) => (
                <path
                  key={camada.comprimento}
                  d={curva.d}
                  pathLength={1}
                  className="auth-linha-luz"
                  style={
                    {
                      strokeDasharray: `${camada.comprimento} 3`,
                      strokeOpacity: camada.opacidade,
                      strokeWidth: camada.largura,
                      "--de": camada.comprimento,
                      "--ate": camada.comprimento - (1 + COMPRIMENTO_MAX),
                      animationDuration: curva.duracao,
                      animationDelay: curva.atraso,
                    } as CSSProperties
                  }
                />
              ))}
            </g>
          </g>
        ))}
      </svg>

      {pulso > 0 && (
        <span key={pulso} className="intro-ondas">
          <span className="intro-onda" />
          <span className="intro-onda intro-onda-2" />
        </span>
      )}

      <LogoAnimada tamanho={77} className="absolute left-12 top-12" />

      <div className="auth-arte-vinheta" />
      <p className="absolute bottom-10 left-10 max-w-xs font-display text-2xl font-bold leading-snug text-white/90">
        Seu cofre vivo de notas, tempo e dinheiro.
      </p>
    </div>
  );
}
