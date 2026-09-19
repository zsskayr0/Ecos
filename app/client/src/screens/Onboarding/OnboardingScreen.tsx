import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, ShieldHalf, Users, User } from "lucide-react";
import { NoteCard } from "@/components/cards/NoteCard";
import { notas } from "@/lib/mock-data";
import { formatMoeda } from "@/lib/format";

type Passo = "splash" | "feed" | "agenda" | "cofre" | "camera" | "setup";
const ORDEM: Passo[] = ["splash", "feed", "agenda", "cofre", "camera", "setup"];

/**
 * Onboarding (section 3.11) — splash → 3 feature slides (real component
 * mini-visualization, not stock art) → justified camera permission →
 * initial setup choice.
 */
export function OnboardingScreen() {
  const [passo, setPasso] = useState<Passo>("splash");
  const navigate = useNavigate();
  const indice = ORDEM.indexOf(passo);

  function avancar() {
    const proximo = ORDEM[indice + 1];
    if (proximo) setPasso(proximo);
  }

  return (
    <div className="flex min-h-screen flex-col justify-between bg-base px-6 py-10">
      <div className="flex-1">
        {passo === "splash" && <Splash />}
        {passo === "feed" && (
          <Slide titulo="Um Feed que é só seu" descricao="O algoritmo ranqueia por Frescor, Órfã, Interação e Esquecimento — não por engajamento.">
            <div className="pointer-events-none scale-95">
              <NoteCard nota={notas[0]} />
            </div>
          </Slide>
        )}
        {passo === "agenda" && (
          <Slide titulo="Time-blocking de verdade" descricao="Estimativas rígidas. Sem lista infinita de tarefa — se não cabe no dia, o Ecos avisa.">
            <div className="flex flex-col gap-2 rounded-card border-l-4 border-cyan bg-surface-1 p-4">
              <p className="font-mono-value text-xs text-text-muted">14:00 · 45min</p>
              <p className="text-[15px] font-medium text-text-primary">Revisar contrato do apartamento</p>
            </div>
          </Slide>
        )}
        {passo === "cofre" && (
          <Slide titulo="Um Cofre, não uma planilha" descricao="Finanças criptografadas, biometria obrigatória, isoladas do resto do app.">
            <div className="rounded-card border border-violet/25 bg-gradient-to-br from-violet/15 to-transparent p-5">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet">
                <ShieldHalf size={13} />
                Saldo do Cofre
              </p>
              <p className="font-mono-value text-3xl font-bold text-text-primary">{formatMoeda(482_930)}</p>
            </div>
          </Slide>
        )}
        {passo === "camera" && <CameraPermissao onContinuar={avancar} />}
        {passo === "setup" && <Setup onConcluir={() => navigate("/perfil/rotina?onboarding=1")} />}
      </div>

      {passo !== "camera" && passo !== "setup" && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center gap-1.5">
            {ORDEM.slice(0, 4).map((p, i) => (
              <span key={p} className={`h-1.5 rounded-pill transition-all ${i === indice ? "w-6 bg-steel-400" : "w-1.5 bg-border"}`} />
            ))}
          </div>
          <button
            onClick={avancar}
            className="w-full rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white"
          >
            {passo === "splash" ? "Começar" : "Continuar"}
          </button>
        </div>
      )}
    </div>
  );
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-5xl text-text-primary">Ecos</p>
      <p className="text-[15px] text-text-secondary">Seu cofre vivo de notas, tempo e dinheiro.</p>
    </div>
  );
}

function Slide({ titulo, descricao, children }: { titulo: string; descricao: string; children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 text-center">
      <div className="w-full max-w-xs">{children}</div>
      <div>
        <p className="mb-2 font-display text-2xl text-text-primary">{titulo}</p>
        <p className="text-[15px] leading-snug text-text-secondary">{descricao}</p>
      </div>
    </div>
  );
}

function CameraPermissao({ onContinuar }: { onContinuar: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-steel-700/20">
        <Camera size={28} strokeWidth={1.5} className="text-steel-300" />
      </div>
      <div>
        <p className="mb-2 font-display text-2xl text-text-primary">Uma foto rápida vira lembrete no Feed</p>
        <p className="text-[15px] leading-snug text-text-secondary">
          Fica local — a imagem nunca sai do seu dispositivo sem sua permissão explícita de sincronização.
        </p>
      </div>
      <button
        onClick={onContinuar}
        className="w-full max-w-xs rounded-2xl bg-steel-700 py-3.5 text-center font-body text-[15px] font-semibold text-white"
      >
        Permitir câmera
      </button>
      <button onClick={onContinuar} className="text-sm text-text-muted">
        Agora não
      </button>
    </div>
  );
}

function Setup({ onConcluir }: { onConcluir: () => void }) {
  const opcoes = [
    { Icon: User, titulo: "Só eu", desc: "Espaço pessoal, sem compartilhamento." },
    { Icon: Users, titulo: "Eu + Equipe", desc: "Crie ou entre numa Equipe agora." },
    { Icon: ShieldHalf, titulo: "Importar de outro app", desc: "Aponte pra uma pasta de arquivos .md existente." },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-6">
      <div className="text-center">
        <p className="mb-2 font-display text-2xl text-text-primary">Como você quer começar?</p>
        <p className="text-sm text-text-secondary">Dá pra mudar isso depois, sem perder nada.</p>
      </div>
      <div className="flex flex-col gap-3">
        {opcoes.map(({ Icon, titulo, desc }) => (
          <button
            key={titulo}
            onClick={onConcluir}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface-1 p-4 text-left"
          >
            <Icon size={22} strokeWidth={1.75} className="shrink-0 text-steel-300" />
            <div>
              <p className="text-[15px] font-medium text-text-primary">{titulo}</p>
              <p className="text-xs text-text-muted">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
