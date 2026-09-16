import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  erro: Error | null;
}

/**
 * Last-resort safety net — a real bug found testing on Android: an
 * uncaught render exception anywhere (e.g. `array.find` on a `null` from
 * a misconfigured server address, see `api.ts`/`server-config.ts`) used
 * to unmount the entire React tree with zero feedback — the app's own
 * `--ecos-base: #000000` background was all that was left, a silent
 * solid black screen. This at least shows something actionable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: { componentStack?: string | null }) {
    console.error("Erro não tratado:", erro, info.componentStack);
  }

  render() {
    if (this.state.erro) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base px-8 text-center">
          <AlertTriangle size={32} strokeWidth={1.5} className="text-error" />
          <div>
            <p className="font-body text-[15px] font-semibold text-text-primary">Algo quebrou.</p>
            <p className="mt-1 max-w-xs text-sm text-text-muted">{this.state.erro.message}</p>
          </div>
          <button
            onClick={() => this.setState({ erro: null })}
            className="rounded-2xl bg-steel-700 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
