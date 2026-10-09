import { useMemo, useState } from "react";
import { GitMerge, Pencil, Tag, Trash2, X } from "lucide-react";
import { ApiError, tagsApi, type TagCatalogo } from "@/lib/api";
import { canonicaTag } from "@/lib/tags";
import { useCatalogoTags } from "@/lib/use-catalogo-tags";
import { useRefreshBus } from "@/lib/refresh-bus";
import { avisar } from "@/lib/toast";
import { ConfirmDeleteDialog } from "@/components/common/ConfirmDeleteDialog";

type Acao = { tipo: "renomear"; tag: string } | { tipo: "mesclar" } | null;

function resumoUso(t: { notas: number; tarefas: number }) {
  const partes = [t.notas ? `${t.notas} ${t.notas === 1 ? "nota" : "notas"}` : "", t.tarefas ? `${t.tarefas} ${t.tarefas === 1 ? "tarefa" : "tarefas"}` : ""].filter(Boolean);
  return partes.join(" · ") || "Sem uso";
}

/**
 * Catálogo único de tags do espaço escolhido: o mesmo nome serve para notas e tarefas.
 * Renomear, mesclar e remover reescrevem os arquivos de todos os itens afetados.
 */
export function TagsOrganizacao({ espaco }: { espaco: string }) {
  const { tags, carregando, erro, recarregar } = useCatalogoTags(espaco);
  const { notificar } = useRefreshBus();
  const [filtro, setFiltro] = useState("");
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [acao, setAcao] = useState<Acao>(null);
  const [nome, setNome] = useState("");
  const [removendo, setRemovendo] = useState<TagCatalogo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const termo = canonicaTag(filtro) ?? filtro.trim().toLowerCase();
    return termo ? tags.filter((t) => t.tag.includes(termo)) : tags;
  }, [tags, filtro]);
  const selecionadas = marcadas.filter((m) => tags.some((t) => t.tag === m));

  async function executar(fn: () => Promise<{ afetados: { notas: number; tarefas: number } }>, sucesso: (n: number) => string) {
    setOcupado(true); setFalha(null);
    try {
      const { afetados } = await fn();
      avisar(sucesso(afetados.notas + afetados.tarefas), "sucesso");
      setAcao(null); setNome(""); setMarcadas([]); setRemovendo(null);
      recarregar(); notificar();
    } catch (e) {
      setFalha(e instanceof ApiError ? e.message : "Não foi possível concluir. Nada foi alterado.");
    } finally { setOcupado(false); }
  }

  function abrirMesclar() {
    const maisUsada = [...tags.filter((t) => selecionadas.includes(t.tag))].sort((a, b) => b.total - a.total)[0];
    setNome(maisUsada?.tag ?? ""); setFalha(null); setAcao({ tipo: "mesclar" });
  }

  function confirmar() {
    const destino = canonicaTag(nome);
    if (!destino || !acao) { setFalha("Informe um nome válido (sem vírgula, até 48 caracteres)."); return; }
    if (acao.tipo === "renomear") {
      if (destino === acao.tag) { setAcao(null); return; }
      void executar(() => tagsApi.renomear({ espaco, de: acao.tag, para: destino }), (n) => `Tag renomeada em ${n} ${n === 1 ? "item" : "itens"}.`);
    } else {
      void executar(() => tagsApi.mesclar({ espaco, origens: selecionadas, destino }), (n) => `Tags mescladas em #${destino} (${n} ${n === 1 ? "item" : "itens"}).`);
    }
  }

  return <section className="mt-8" aria-label="Tags">
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Tags</p>
    <p className="mb-3 text-xs leading-relaxed text-text-muted">Um catálogo só para notas e tarefas deste espaço. Maiúsculas, espaços e # são ignorados ao comparar; os arquivos só mudam quando você renomeia, mescla ou remove.</p>

    <div className="rounded-2xl border border-border bg-surface-1 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar tag…" aria-label="Buscar tag" className="ecos-input min-w-0 flex-1 !rounded-lg" />
        <button type="button" disabled={selecionadas.length < 2 || ocupado} onClick={abrirMesclar} className="flex min-h-10 items-center gap-2 rounded-lg bg-steel-700 px-3 text-sm font-medium text-white disabled:opacity-40"><GitMerge size={16} />Mesclar{selecionadas.length >= 2 ? ` (${selecionadas.length})` : ""}</button>
      </div>

      {acao && <div role="group" aria-label={acao.tipo === "renomear" ? `Renomear #${acao.tag}` : "Mesclar tags"} className="mb-3 rounded-xl border border-border bg-surface-2 p-3">
        <p className="mb-2 text-sm text-text-secondary">{acao.tipo === "renomear" ? <>Novo nome para <span className="font-medium text-text-primary">#{acao.tag}</span>. Se já existir, as duas viram uma só.</> : <>{selecionadas.map((t) => `#${t}`).join(", ")} passam a ser:</>}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirmar(); else if (e.key === "Escape") setAcao(null); }} aria-label="Nome da tag" className="ecos-input min-w-0 flex-1 !rounded-lg" />
          <button type="button" disabled={ocupado || !nome.trim()} onClick={confirmar} className="min-h-10 rounded-lg bg-steel-700 px-3 text-sm font-medium text-white disabled:opacity-40">{ocupado ? "Aplicando…" : acao.tipo === "renomear" ? "Renomear" : "Mesclar"}</button>
          <button type="button" onClick={() => setAcao(null)} aria-label="Cancelar" className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-3"><X size={16} /></button>
        </div>
        {canonicaTag(nome) && canonicaTag(nome) !== nome.trim() && <p className="mt-2 text-xs text-text-muted">Será salva como <span className="font-medium text-text-secondary">#{canonicaTag(nome)}</span>.</p>}
      </div>}

      {(falha || erro) && <p role="alert" className="mb-3 rounded-xl border border-error/40 bg-error/10 p-3 text-sm text-error">{falha ?? erro}</p>}

      {carregando && tags.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">Carregando tags…</p>
        : visiveis.length === 0 ? <p className="py-6 text-center text-sm text-text-muted">{tags.length === 0 ? "Nenhuma tag neste espaço ainda. Elas nascem ao marcar uma nota ou tarefa." : "Nenhuma tag encontrada."}</p>
        : <ul className="divide-y divide-border/60">
          {visiveis.map((t) => <li key={t.tag} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked={marcadas.includes(t.tag)} onChange={(e) => setMarcadas((atual) => e.target.checked ? [...atual, t.tag] : atual.filter((x) => x !== t.tag))} aria-label={`Selecionar #${t.tag} para mesclar`} className="h-5 w-5 shrink-0 accent-[var(--color-cyan,#22d3ee)]" />
            <Tag size={15} className="shrink-0 text-violet" aria-hidden />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-text-primary">#{t.tag}</span><span className="block text-xs text-text-muted">{resumoUso(t)}</span></span>
            <button type="button" disabled={ocupado} onClick={() => { setNome(t.tag); setFalha(null); setAcao({ tipo: "renomear", tag: t.tag }); }} aria-label={`Renomear #${t.tag}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary"><Pencil size={16} /></button>
            <button type="button" disabled={ocupado} onClick={() => setRemovendo(t)} aria-label={`Remover #${t.tag}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-error"><Trash2 size={16} /></button>
          </li>)}
        </ul>}
    </div>

    <ConfirmDeleteDialog open={removendo !== null} busy={ocupado} onCancel={() => setRemovendo(null)}
      title={removendo ? `Remover #${removendo.tag} de ${removendo.total} ${removendo.total === 1 ? "item" : "itens"}? Os itens continuam existindo.` : ""}
      onConfirm={() => removendo && void executar(() => tagsApi.remover({ espaco, tag: removendo.tag }), (n) => `Tag removida de ${n} ${n === 1 ? "item" : "itens"}.`)} />
  </section>;
}
