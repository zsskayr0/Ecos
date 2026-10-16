import { lazy, Suspense, type CSSProperties } from "react";

const Impl = lazy(() => import("./IconePorNomeImpl"));

/**
 * Ícone do lucide escolhido pelo usuário (nome vindo do servidor). O conjunto completo (~135 kB gzip) não entra no
 * pacote inicial: chega sob demanda, e enquanto isso fica um espaço do mesmo tamanho para o layout não pular.
 */
export function IconePorNome({ nome, padrao, size = 14, style }: { nome: string; padrao?: string; size?: number; style?: CSSProperties }) {
  return (
    <Suspense fallback={<span aria-hidden style={{ display: "inline-block", width: size, height: size }} />}>
      <Impl nome={nome} padrao={padrao} size={size} style={style} />
    </Suspense>
  );
}
