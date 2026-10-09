import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, BellRing, Inbox, MoonStar, Sunrise } from "lucide-react";
import { Toggle } from "@/components/common/Toggle";
import { Cabecalho, CampoHora, Linha, Secao, usePreferencias } from "./campos-config";

type Permissao = NotificationPermission | "indisponivel";
const lerPermissao = (): Permissao => (typeof Notification === "undefined" ? "indisponivel" : Notification.permission);

const ROTULO_PERMISSAO: Record<Permissao, string> = {
  granted: "Permitidas neste aparelho.",
  denied: "Bloqueadas. Libere nas configurações do sistema ou do navegador.",
  default: "Ainda não pedimos permissão.",
  indisponivel: "Este aparelho não oferece notificações do sistema.",
};

/** Preferências de aviso. Valem para o que é gerado neste aparelho (hoje, o resumo diário); a caixa de notificações do servidor tem tela própria. */
export function NotificacoesPreferenciasScreen() {
  const [prefs, alterar] = usePreferencias();
  const [permissao, setPermissao] = useState<Permissao>(lerPermissao);

  async function pedirPermissao() {
    try { setPermissao(await Notification.requestPermission()); } catch { setPermissao(lerPermissao()); }
  }

  return (
    <div className="px-4 pt-[calc(env(safe-area-inset-top)+12px)] pb-nav-safe">
      <Cabecalho titulo="Notificações" />

      <Link to="/notificacoes" className="mb-6 flex items-center gap-3 rounded-2xl border border-border bg-surface-1 px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-surface-2">
        <Inbox size={18} className="text-steel-300" />Ver caixa de notificações
      </Link>

      <Secao titulo="Resumo diário">
        <Linha Icone={Sunrise} titulo="Resumo do dia" descricao="Uma vez por dia, um aviso com as tarefas de hoje e as atrasadas. Aparece com o Ecos aberto; se você abrir depois da hora, ele sai na hora.">
          <Toggle checked={prefs.resumoDiario} onChange={(resumoDiario) => alterar({ resumoDiario })} label="Resumo do dia" />
        </Linha>
        <Linha Icone={Bell} titulo="Horário do resumo" descricao="A partir de que hora o resumo pode aparecer.">
          <CampoHora valor={prefs.resumoHora} onChange={(resumoHora) => alterar({ resumoHora })} label="Horário do resumo" desabilitado={!prefs.resumoDiario} />
        </Linha>
        <Linha Icone={BellRing} titulo="Avisos do sistema" descricao={ROTULO_PERMISSAO[permissao]}>
          {permissao === "default" && <button type="button" onClick={() => void pedirPermissao()} className="flex min-h-10 items-center rounded-xl border border-border bg-surface-2 px-3 text-sm font-medium text-text-primary hover:bg-surface-3">Permitir</button>}
        </Linha>
      </Secao>

      <Secao titulo="Horário silencioso">
        <Linha Icone={MoonStar} titulo="Não incomodar" descricao="Nesse intervalo, nenhum aviso gerado neste aparelho aparece. O resumo do dia espera o silêncio acabar.">
          <Toggle checked={prefs.silencioAtivo} onChange={(silencioAtivo) => alterar({ silencioAtivo })} label="Horário silencioso" />
        </Linha>
        <Linha Icone={MoonStar} titulo="Começa às" descricao="Início do silêncio.">
          <CampoHora valor={prefs.silencioInicio} onChange={(silencioInicio) => alterar({ silencioInicio })} label="Início do silêncio" desabilitado={!prefs.silencioAtivo} />
        </Linha>
        <Linha Icone={Sunrise} titulo="Termina às" descricao="Fim do silêncio. Pode ser no dia seguinte, como 22:00 até 07:00.">
          <CampoHora valor={prefs.silencioFim} onChange={(silencioFim) => alterar({ silencioFim })} label="Fim do silêncio" desabilitado={!prefs.silencioAtivo} />
        </Linha>
      </Secao>
    </div>
  );
}
