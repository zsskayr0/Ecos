import type { ReactNode } from "react";

/** Pontos de uma estrela de 5 pontas centrada em (cx, cy), com uma ponta para cima. */
function estrela(cx: number, cy: number, R: number): string {
  const r = R * 0.382;
  return Array.from({ length: 10 }, (_, i) => {
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    const raio = i % 2 === 0 ? R : r;
    return `${(cx + raio * Math.cos(ang)).toFixed(2)},${(cy + raio * Math.sin(ang)).toFixed(2)}`;
  }).join(" ");
}

const Faixas = ({ cores, vertical = false, pesos }: { cores: string[]; vertical?: boolean; pesos?: number[] }) => {
  const p = pesos ?? cores.map(() => 1);
  const soma = p.reduce((a, b) => a + b, 0);
  let acc = 0;
  return <>{cores.map((cor, i) => {
    const tam = ((vertical ? 30 : 20) * p[i]) / soma;
    const el = vertical ? <rect key={i} x={acc} y={0} width={tam + 0.05} height={20} fill={cor} /> : <rect key={i} x={0} y={acc} width={30} height={tam + 0.05} fill={cor} />;
    acc += tam;
    return el;
  })}</>;
};

const UnionJack = ({ x = 0, y = 0, w = 30, h = 20 }: { x?: number; y?: number; w?: number; h?: number }) => (
  <svg x={x} y={y} width={w} height={h} viewBox="0 0 60 40" preserveAspectRatio="none">
    <rect width="60" height="40" fill="#012169" />
    <path d="M0 0L60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
    <path d="M0 0L60 40M60 0L0 40" stroke="#c8102e" strokeWidth="3" />
    <path d="M30 0V40M0 20H60" stroke="#fff" strokeWidth="13" />
    <path d="M30 0V40M0 20H60" stroke="#c8102e" strokeWidth="8" />
  </svg>
);

const BANDEIRAS: Record<string, () => ReactNode> = {
  Brasil: () => (<>
    <rect width="30" height="20" fill="#009c3b" />
    <polygon points="15,2.2 27.3,10 15,17.8 2.7,10" fill="#ffdf00" />
    <circle cx="15" cy="10" r="4.3" fill="#002776" />
    <path d="M10.9 9.2Q15 8 19.1 11.2" stroke="#fff" strokeWidth="0.8" fill="none" />
  </>),
  Portugal: () => (<>
    <rect width="30" height="20" fill="#ff0000" />
    <rect width="12" height="20" fill="#006600" />
    <circle cx="12" cy="10" r="3.4" fill="#ffd400" />
    <circle cx="12" cy="10" r="2" fill="#fff" stroke="#c8102e" strokeWidth="0.5" />
  </>),
  "Estados Unidos": () => (<>
    <Faixas cores={Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? "#b22234" : "#fff"))} />
    <rect width="12.5" height="10.8" fill="#3c3b6e" />
    {Array.from({ length: 4 }, (_, r) => Array.from({ length: 5 }, (_, c) => <circle key={`${r}${c}`} cx={1.6 + c * 2.3 + (r % 2) * 0.6} cy={1.5 + r * 2.4} r="0.5" fill="#fff" />))}
  </>),
  Canadá: () => (<>
    <rect width="30" height="20" fill="#fff" />
    <rect width="7.5" height="20" fill="#d52b1e" />
    <rect x="22.5" width="7.5" height="20" fill="#d52b1e" />
    <polygon points="15,4 16.4,7.2 18.8,6.4 18,10 20.2,9.4 19.4,12.2 21,12.8 15.6,15 15.6,17 14.4,17 14.4,15 9,12.8 10.6,12.2 9.8,9.4 12,10 11.2,6.4 13.6,7.2" fill="#d52b1e" />
  </>),
  México: () => (<>
    <Faixas cores={["#006847", "#fff", "#ce1126"]} vertical />
    <circle cx="15" cy="10" r="2.6" fill="#8c6a2a" />
    <circle cx="15" cy="10" r="1.5" fill="#6aa84f" />
  </>),
  Argentina: () => (<>
    <Faixas cores={["#74acdf", "#fff", "#74acdf"]} />
    <circle cx="15" cy="10" r="2" fill="#f6b40e" />
  </>),
  Chile: () => (<>
    <rect width="30" height="20" fill="#d52b1e" />
    <rect width="30" height="10" fill="#fff" />
    <rect width="10" height="10" fill="#0039a6" />
    <polygon points={estrela(5, 5, 2.8)} fill="#fff" />
  </>),
  Colômbia: () => (<Faixas cores={["#fcd116", "#003893", "#ce1126"]} pesos={[2, 1, 1]} />),
  Uruguai: () => (<>
    <Faixas cores={Array.from({ length: 9 }, (_, i) => (i % 2 === 0 ? "#fff" : "#0038a8"))} />
    <rect width="11" height="11.1" fill="#fff" />
    <circle cx="5.5" cy="5.5" r="2.6" fill="#fcd116" />
  </>),
  "Reino Unido": () => <UnionJack />,
  Espanha: () => (<>
    <Faixas cores={["#aa151b", "#f1bf00", "#aa151b"]} pesos={[1, 2, 1]} />
    <rect x="6" y="7.5" width="3.4" height="5" rx="0.6" fill="#aa151b" opacity="0.7" />
  </>),
  França: () => (<Faixas cores={["#0055a4", "#fff", "#ef4135"]} vertical />),
  Alemanha: () => (<Faixas cores={["#000", "#dd0000", "#ffce00"]} />),
  Itália: () => (<Faixas cores={["#009246", "#fff", "#ce2b37"]} vertical />),
  "Países Baixos": () => (<Faixas cores={["#ae1c28", "#fff", "#21468b"]} />),
  Suíça: () => (<>
    <rect width="30" height="20" fill="#d52b1e" />
    <rect x="13" y="4" width="4" height="12" fill="#fff" />
    <rect x="9" y="8" width="12" height="4" fill="#fff" />
  </>),
  Japão: () => (<>
    <rect width="30" height="20" fill="#fff" />
    <circle cx="15" cy="10" r="6" fill="#bc002d" />
  </>),
  China: () => (<>
    <rect width="30" height="20" fill="#de2910" />
    <polygon points={estrela(5, 5, 3)} fill="#ffde00" />
    {[[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y], i) => <polygon key={i} points={estrela(x, y, 0.9)} fill="#ffde00" />)}
  </>),
  Índia: () => (<>
    <Faixas cores={["#ff9933", "#fff", "#138808"]} />
    <circle cx="15" cy="10" r="2.5" fill="none" stroke="#000080" strokeWidth="0.5" />
    <circle cx="15" cy="10" r="0.5" fill="#000080" />
  </>),
  Austrália: () => (<>
    <rect width="30" height="20" fill="#012169" />
    <UnionJack w={15} h={10} />
    <polygon points={estrela(7.5, 15.2, 2.4)} fill="#fff" />
    {[[22, 4], [25.5, 8], [22, 17], [19, 10], [23, 11]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === 4 ? 0.6 : 1} fill="#fff" />)}
  </>),
};

/** Bandeira simplificada (vetorial). Sem país conhecido, não desenha nada. */
export function Bandeira({ pais, className }: { pais: string; className?: string }) {
  const desenho = BANDEIRAS[pais];
  if (!desenho) return null;
  return (
    <svg viewBox="0 0 30 20" className={className} role="img" aria-label={`Bandeira: ${pais}`} preserveAspectRatio="none">
      <defs><clipPath id="ecos-bandeira-recorte"><rect width="30" height="20" rx="1.2" /></clipPath></defs>
      <g clipPath="url(#ecos-bandeira-recorte)">{desenho()}</g>
    </svg>
  );
}
