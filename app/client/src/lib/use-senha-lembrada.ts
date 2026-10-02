import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth-context";
import { chaveDoCofre, esquecerSenha, lembrarSenhaSuportado, temSenhaLembrada } from "./cofre-lembrado";
import { useAppUI } from "./ui-context";

/** Estado de "senha lembrada" do Cofre do espaço ativo, para a tela de configurações. */
export function useSenhaLembrada() {
  const { perfil } = useAuth();
  const { espacoAtivo } = useAppUI();
  const chave = perfil ? chaveDoCofre(perfil.id, espacoAtivo) : null;
  const [suportado, setSuportado] = useState(false);
  const [lembrada, setLembrada] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const ok = await lembrarSenhaSuportado();
      const tem = ok && chave ? await temSenhaLembrada(chave) : false;
      if (vivo) { setSuportado(ok); setLembrada(tem); }
    })();
    return () => { vivo = false; };
  }, [chave]);

  const esquecer = useCallback(async () => {
    if (!chave) return;
    await esquecerSenha(chave);
    setLembrada(false);
  }, [chave]);

  return { suportado, lembrada, esquecer };
}
