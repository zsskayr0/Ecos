import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Endereços que só existem no próprio aparelho: um QR code apontando para eles não abriria em outro celular. */
function enderecoLocal(base: string): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch { return false; }
}

/**
 * QR code de convite de equipe: aponta para `<servidor>/entrar/<código>`. Quem já tem conta e escaneia entra na equipe
 * (o app pede o login antes, se preciso). O convite vale uma vez e por 7 dias.
 */
export function QrConvite({ codigo, base }: { codigo: string; base: string }) {
  const link = `${base.replace(/\/$/, "")}/entrar/${codigo}`;
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((s) => { if (vivo) setSvg(s); })
      .catch(() => { if (vivo) setSvg(null); });
    return () => { vivo = false; };
  }, [link]);

  return (
    <div className="flex flex-col items-center gap-3">
      {svg ? (
        // Fundo branco fixo: o QR code precisa de contraste próprio, em qualquer tema.
        <div role="img" aria-label={`QR code do convite: ${link}`} className="h-44 w-44 overflow-hidden rounded-xl bg-white p-1 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="h-44 w-44 animate-pulse rounded-xl bg-surface-2" />
      )}
      <p className="max-w-xs text-center text-xs text-text-secondary">Peça para a pessoa escanear com o celular. Ela precisa já ter conta neste servidor. O convite vale uma vez e por 7 dias.</p>
      {enderecoLocal(base) && (
        <p className="max-w-xs text-center text-xs text-warning">Você abriu o Ecos por um endereço que só funciona neste aparelho ({new URL(base).host}). Abra pelo endereço de rede ou pela VPN do servidor para o QR code funcionar em outros celulares, ou envie o código abaixo.</p>
      )}
    </div>
  );
}
