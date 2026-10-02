import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import jsQR from "jsqr";
import { AlertTriangle, CameraOff, Keyboard, Loader2, X } from "lucide-react";
import { codigoDoQrConvite } from "@/lib/qr-convite";
import "./escanear-qr.css";

type Estado = "iniciando" | "lendo" | "negada" | "sem-camera" | "indisponivel" | "falha";

const LADO_MAX = 640; // o decodificador não precisa de mais que isso, e mantém a leitura leve em celulares fracos
const INTERVALO_MS = 120;

const PROBLEMAS: Record<Exclude<Estado, "iniciando" | "lendo">, { titulo: string; corpo: string }> = {
  negada: { titulo: "Sem acesso à câmera", corpo: "O Ecos só usa a câmera para ler o QR code de convite. Libere a câmera nas permissões do aplicativo e tente de novo." },
  "sem-camera": { titulo: "Nenhuma câmera encontrada", corpo: "Este aparelho não tem câmera disponível. Digite o código do convite no lugar." },
  indisponivel: { titulo: "Câmera indisponível aqui", corpo: "O navegador só libera a câmera em endereços seguros (https). Abra o Ecos pelo aplicativo ou digite o código do convite." },
  falha: { titulo: "Não foi possível abrir a câmera", corpo: "Ela pode estar em uso por outro aplicativo. Feche-o e tente de novo." },
};

const CANTOS = ["left-0 top-0 rounded-tl-2xl border-l-4 border-t-4", "right-0 top-0 rounded-tr-2xl border-r-4 border-t-4", "bottom-0 left-0 rounded-bl-2xl border-b-4 border-l-4", "bottom-0 right-0 rounded-br-2xl border-b-4 border-r-4"];

/**
 * Leitor de QR code de convite. A câmera só é pedida aqui (ao abrir a tela) e é desligada ao sair. Ao ler um convite
 * válido, segue para `/entrar/<código>`, que aceita o convite e abre a equipe.
 */
export function EscanearQrScreen() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const quadro = useRef<HTMLCanvasElement | null>(null);
  const [estado, setEstado] = useState<Estado>("iniciando");
  const [aviso, setAviso] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const abrirCamera = useCallback(async (): Promise<MediaStream | null> => {
    setEstado("iniciando");
    setAviso(null);
    if (!navigator.mediaDevices?.getUserMedia) { setEstado("indisponivel"); return null; }
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : "";
      setEstado(nome === "NotAllowedError" || nome === "SecurityError" ? "negada" : nome === "NotFoundError" || nome === "OverconstrainedError" ? "sem-camera" : "falha");
      return null;
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    let fluxo: MediaStream | null = null;
    let timer = 0;

    function ler() {
      const v = video.current;
      if (!vivo || !v) return;
      if (v.readyState >= 2 && v.videoWidth > 0) {
        const escala = Math.min(1, LADO_MAX / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * escala);
        const h = Math.round(v.videoHeight * escala);
        const c = (quadro.current ??= document.createElement("canvas"));
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (r?.data) {
            const codigo = codigoDoQrConvite(r.data);
            if (codigo) { navigator.vibrate?.(40); navigate(`/entrar/${codigo}`, { replace: true }); return; }
            setAviso("Esse QR code não é um convite do Ecos.");
          }
        }
      }
      timer = window.setTimeout(ler, INTERVALO_MS);
    }

    void abrirCamera().then(async (f) => {
      if (!f) return;
      if (!vivo) { f.getTracks().forEach((t) => t.stop()); return; }
      fluxo = f;
      const v = video.current;
      if (!v) return;
      v.srcObject = f;
      try { await v.play(); } catch { /* o navegador pode recusar o autoplay; a leitura segue assim que houver quadros */ }
      if (!vivo) return;
      setEstado("lendo");
      ler();
    });

    return () => {
      vivo = false;
      window.clearTimeout(timer);
      fluxo?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    };
  }, [abrirCamera, navigate, tentativa]);

  const problema = estado !== "iniciando" && estado !== "lendo" ? PROBLEMAS[estado] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-text-primary" style={{ ["--ecos-scan-lado" as string]: "min(68vw, 288px)" }}>
      <div className="flex items-center justify-between px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)]">
        <h1 className="font-display text-lg text-white">Escanear convite</h1>
        <button type="button" onClick={() => navigate(-1)} aria-label="Fechar" className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-300">
          <X size={18} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <video ref={video} muted playsInline aria-label="Imagem da câmera" className={`absolute inset-0 h-full w-full object-cover ${estado === "lendo" ? "" : "invisible"}`} />
        {estado === "lendo" && (
          <>
            {/* Escurece tudo menos o quadrado de leitura. */}
            <div aria-hidden className="absolute inset-0 bg-black/55" style={{ clipPath: "polygon(0 0,100% 0,100% 100%,0 100%,0 0,calc(50% - var(--ecos-scan-lado)/2) calc(50% - var(--ecos-scan-lado)/2),calc(50% - var(--ecos-scan-lado)/2) calc(50% + var(--ecos-scan-lado)/2),calc(50% + var(--ecos-scan-lado)/2) calc(50% + var(--ecos-scan-lado)/2),calc(50% + var(--ecos-scan-lado)/2) calc(50% - var(--ecos-scan-lado)/2),calc(50% - var(--ecos-scan-lado)/2) calc(50% - var(--ecos-scan-lado)/2))" }} />
            <div aria-hidden className="relative" style={{ width: "var(--ecos-scan-lado)", height: "var(--ecos-scan-lado)" }}>
              {CANTOS.map((c) => <span key={c} className={`absolute h-9 w-9 border-steel-300 ${c}`} />)}
              <span className="ecos-scan-linha absolute left-3 right-3 top-0 h-0.5 rounded-full bg-steel-300 shadow-[0_0_12px_2px_rgb(var(--ecos-steel-400-rgb)/0.7)]" />
            </div>
          </>
        )}
        {estado === "iniciando" && (
          <div role="status" className="flex flex-col items-center gap-3 text-center text-white/80">
            <Loader2 className="animate-spin" size={26} />
            <p className="text-sm">Abrindo a câmera…</p>
          </div>
        )}
        {problema && (
          <div role="alert" className="mx-6 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border bg-surface-1 p-6 text-center">
            <CameraOff className="text-text-muted" size={30} strokeWidth={1.5} />
            <h2 className="font-display text-lg text-text-primary">{problema.titulo}</h2>
            <p className="text-sm text-text-secondary">{problema.corpo}</p>
            {estado !== "sem-camera" && estado !== "indisponivel" && (
              <button type="button" onClick={() => setTentativa((n) => n + 1)} className="w-full rounded-2xl bg-steel-700 py-3 text-sm font-semibold text-white">Tentar de novo</button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4">
        {aviso ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle size={15} />{aviso}</p>
        ) : (
          <p className="text-center text-sm text-white/75">{estado === "lendo" ? "Aponte para o QR code do convite." : "A leitura é feita só no aparelho; nada da câmera é gravado ou enviado."}</p>
        )}
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-steel-300">
          <Keyboard size={16} strokeWidth={1.75} />Digitar o código
        </button>
      </div>
    </div>
  );
}
