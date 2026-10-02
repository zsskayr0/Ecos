import { useState } from "react";
import { KeyRound } from "lucide-react";
import { useSenhaLembrada } from "@/lib/use-senha-lembrada";

/** Configurações do Cofre: se a senha está lembrada neste computador, e como esquecê-la. Só aparece onde existe o recurso (Windows). */
export function SenhaLembrada() {
  const { suportado, lembrada, esquecer } = useSenhaLembrada();
  const [ocupado, setOcupado] = useState(false);
  if (!suportado) return null;

  return (
    <section className="cofre-card cofre-senha-lembrada" aria-label="Senha do Cofre neste computador">
      <KeyRound size={18} aria-hidden />
      <div>
        <h3>Senha neste computador</h3>
        <p>
          {lembrada
            ? "A senha deste Cofre está guardada no Gerenciador de Credenciais do Windows. Depois de uma atualização do servidor, o Cofre abre sozinho. “Bloquear” continua exigindo a senha."
            : "A senha deste Cofre não está guardada aqui. Para o Cofre abrir sozinho depois de atualizações, marque “Lembrar a senha neste computador” na próxima vez que desbloquear."}
        </p>
      </div>
      {lembrada && (
        <button type="button" className="cofre-secondary" disabled={ocupado} onClick={async () => { setOcupado(true); try { await esquecer(); } finally { setOcupado(false); } }}>
          {ocupado ? "Esquecendo…" : "Esquecer neste computador"}
        </button>
      )}
    </section>
  );
}
