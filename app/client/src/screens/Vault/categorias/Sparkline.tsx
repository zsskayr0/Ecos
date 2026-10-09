/** Minigráfico de linha com área; o último ponto é destacado. Sem dados (tudo zero) vira um traço discreto. */
export function Sparkline({ valores, cor, largura = 96, altura = 28, rotulo }: { valores: number[]; cor: string; largura?: number; altura?: number; rotulo?: string }) {
  const max = Math.max(...valores, 0);
  const n = valores.length;
  const passo = n > 1 ? (largura - 6) / (n - 1) : 0;
  const y = (v: number) => (max > 0 ? altura - 3 - (v / max) * (altura - 6) : altura - 3);
  const pontos = valores.map((v, i) => [3 + i * passo, y(v)] as const);
  const linha = pontos.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${pontos[0]?.[0] ?? 3},${altura} ${linha} ${pontos[n - 1]?.[0] ?? 3},${altura}`;
  const ultimo = pontos[n - 1];
  return (
    <svg className="cofre-spark" width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} role="img" aria-label={rotulo ?? "Tendência dos últimos meses"} data-vazio={max === 0 || undefined}>
      {max > 0 && <polygon points={area} fill={cor} opacity={0.14} />}
      <polyline points={linha} fill="none" stroke={cor} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={max > 0 ? 1 : 0.35} />
      {max > 0 && ultimo && <circle cx={ultimo[0]} cy={ultimo[1]} r={2.4} fill={cor} />}
    </svg>
  );
}

/** Variação do último mês contra o anterior, em %; `null` sem base de comparação. */
export function variacaoUltimoMes(valores: number[]): number | null {
  const a = valores[valores.length - 2] ?? 0;
  const b = valores[valores.length - 1] ?? 0;
  return a > 0 ? ((b - a) / a) * 100 : null;
}
