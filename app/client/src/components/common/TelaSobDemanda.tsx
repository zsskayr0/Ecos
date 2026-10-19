import { Component, Fragment, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { SkeletonTela } from "@/components/common/Skeleton";
import { registrarErro } from "@/lib/registro-erro";

/**
 * Falha ao baixar o pedaço de uma tela carregada sob demanda (rede caiu, versão nova publicada). O `React.lazy`
 * guarda a promessa rejeitada, então tentar de novo exige recarregar a página.
 */
class FalhaDeCarregamento extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };
  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }
  componentDidCatch(erro: Error) {
    registrarErro("falha ao carregar tela sob demanda", erro, null);
  }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-center gap-3 px-8 py-10 text-center">
        <AlertTriangle size={28} strokeWidth={1.5} aria-hidden className="text-error" />
        <p className="text-sm text-text-muted">Não foi possível carregar esta tela. Verifique a conexão e tente de novo.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-2xl bg-steel-700 px-5 py-2.5 text-sm font-semibold text-on-steel"
        >
          Recarregar
        </button>
      </div>
    );
  }
}

const PRAZO_PRESO_MS = 1_200;
const MAX_REINICIOS = 3;

/**
 * Mostra o esqueleto e, se ele continuar na tela depois de {@link PRAZO_PRESO_MS}, pede para remontar a tela. Em alguns
 * navegadores o retry do Suspense nunca roda mesmo com o pedaço já baixado; remontar com outra `key` destrava.
 */
function EsqueletoComReinicio({ aoPreso }: { aoPreso: () => void }) {
  useEffect(() => {
    const id = setTimeout(aoPreso, PRAZO_PRESO_MS);
    return () => clearTimeout(id);
  }, [aoPreso]);
  return <SkeletonTela atrasoMs={120} />;
}

/** Envolve uma tela preguiçosa com estado de carregamento e de erro. */
export function TelaSobDemanda({ children }: { children: ReactNode }) {
  const [tentativa, setTentativa] = useState(0);
  const [aoPreso] = useState(() => () => {
    flushSync(() => setTentativa((n) => (n < MAX_REINICIOS ? n + 1 : n)));
  });
  return (
    <FalhaDeCarregamento>
      <Suspense fallback={<EsqueletoComReinicio key={tentativa} aoPreso={aoPreso} />}>
        <Fragment key={tentativa}>{children}</Fragment>
      </Suspense>
    </FalhaDeCarregamento>
  );
}

export function telaSobDemanda(Tela: ComponentType): ReactNode {
  return (
    <TelaSobDemanda>
      <Tela />
    </TelaSobDemanda>
  );
}
