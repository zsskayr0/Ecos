import logoIcone from "@/assets/brand/ecos-icone.svg";

/** Primeira etapa da introdução: a marca, uma barra de progresso contínua e o que está acontecendo por baixo. */
export function CarregandoScreen({ mensagem = "Preparando o seu Ecos…", aviso }: { mensagem?: string; aviso?: string }) {
  return (
    <div className="intro-cascata flex flex-col items-center gap-6 text-center">
      <img src={logoIcone} alt="" className="h-20 w-20 drop-shadow-[0_0_28px_rgb(var(--ecos-cyan-rgb)/0.35)]" />
      <p className="font-display text-4xl font-bold text-text-primary">Ecos</p>
      <div className="flex w-full flex-col items-center gap-3">
        <div className="intro-barra" role="progressbar" aria-label={mensagem} />
        <p role="status" className="text-sm text-text-secondary">{mensagem}</p>
        {aviso && <p className="text-xs text-text-muted">{aviso}</p>}
      </div>
    </div>
  );
}
