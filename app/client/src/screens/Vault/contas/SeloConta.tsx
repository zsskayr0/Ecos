import { Wallet } from "lucide-react";
import type { TipoConta } from "@/lib/api";
import { corDoTexto } from "../VaultCategories";
import { iniciais } from "./bancos";
import { logoDoBanco } from "./logos";

/**
 * Selo da conta sobre a cor dela: o logo SVG do banco (pintado em contraste com a cor), ou a sigla — a que a pessoa
 * escolheu num banco personalizado, ou as iniciais do nome. Carteira mostra a carteira.
 */
export function SeloConta({ nome, cor, tipo, codigoBanco, sigla, tamanho = "" }: { nome: string; cor: string; tipo?: TipoConta; codigoBanco?: string | null; sigla?: string | null; tamanho?: "xs" | "sm" | "lg" | "" }) {
  const logo = tipo === "carteira" ? undefined : logoDoBanco(codigoBanco);
  const texto = (sigla || iniciais(nome)).slice(0, 4);
  return (
    <span className={`cofre-cats-icon cofre-conta-selo ${tamanho}`} style={{ background: cor, color: corDoTexto(cor) }} aria-hidden>
      {tipo === "carteira" ? <Wallet size={tamanho === "xs" ? 11 : tamanho === "sm" ? 12 : 16} />
        : logo ? <span className="cofre-conta-logo" dangerouslySetInnerHTML={{ __html: logo }} />
        : <b data-curto={texto.length > 2 || undefined}>{texto}</b>}
    </span>
  );
}
