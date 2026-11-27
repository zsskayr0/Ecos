import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { EVENTO_ABRIR_ROTA } from "@/lib/abrir-rota";

/** Celular: atende `abrirRota` (ver lib/abrir-rota). Fica dentro do roteador. */
export function OuvinteDeRota() {
  const navigate = useNavigate();
  useEffect(() => {
    const abrir = (e: Event) => { const caminho = (e as CustomEvent<string>).detail; if (caminho) navigate(caminho); };
    window.addEventListener(EVENTO_ABRIR_ROTA, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_ROTA, abrir);
  }, [navigate]);
  return null;
}
