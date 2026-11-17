import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { lerPreferenciasCalendario, salvarPreferenciasCalendario, salvarPreferenciasCalendarioNoServidor, sincronizarPreferenciasCalendario, type PreferenciasCalendario } from "@/lib/preferencias-calendario";

export interface AvisoSalvamento { tipo: "ok" | "erro"; texto: string }

/**
 * Preferências de calendário guardadas na conta (país, fuso, prazos na Agenda), com gravação imediata: cada mudança sobe
 * ao servidor na hora. Se o servidor não responder, a escolha fica neste aparelho e a tela diz o que faltou.
 */
export function useCalendarioDaConta(): [PreferenciasCalendario, (patch: Partial<PreferenciasCalendario>) => void, AvisoSalvamento | null] {
  const { perfil } = useAuth();
  const [prefs, setPrefs] = useState(lerPreferenciasCalendario);
  const [aviso, setAviso] = useState<AvisoSalvamento | null>(null);

  // Abre com o que o servidor tem (outro aparelho pode ter mudado): a cópia local é só cache.
  useEffect(() => {
    if (!perfil?.id) return;
    let vivo = true;
    void sincronizarPreferenciasCalendario(perfil.id).then((p) => { if (vivo) setPrefs(p); });
    return () => { vivo = false; };
  }, [perfil?.id]);

  function alterar(patch: Partial<PreferenciasCalendario>) {
    setPrefs((atual) => ({ ...atual, ...patch }));
    setAviso(null);
    void (async () => {
      try {
        if (!perfil?.id) throw new Error("sem sessão");
        await salvarPreferenciasCalendarioNoServidor(perfil.id, patch);
        setAviso({ tipo: "ok", texto: "Salvo na sua conta." });
      } catch (e) {
        // Mantém a escolha neste aparelho e diz o que faltou, em vez de perder o que a pessoa acabou de fazer.
        salvarPreferenciasCalendario(patch);
        setAviso({ tipo: "erro", texto: e instanceof ApiError && e.campos?.length ? e.campos.map((c) => c.motivo).join(" ") : "Não foi possível salvar na conta agora. A mudança ficou só neste dispositivo; mude de novo mais tarde para tentar outra vez." });
      }
    })();
  }

  return [prefs, alterar, aviso];
}
