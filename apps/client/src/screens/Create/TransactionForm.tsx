import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Delete } from "lucide-react";
import { Chip } from "@/components/common/Chip";
import { formatMoeda } from "@/lib/format";
import { vault, type CategoriaApi, type ContaApi } from "@/lib/api";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

interface Props {
  draft: CapturaDraft;
  setDraft: SetDraft;
  onSalvar: () => void;
  salvando?: boolean;
}

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

/** Formulário de Transação — valor grande estilo calculadora, chips de categoria com ícone (seção 3.6). */
export function TransactionForm({ draft, setDraft, onSalvar, salvando }: Props) {
  const [categorias, setCategorias] = useState<CategoriaApi[] | null>(null);
  const [conta, setConta] = useState<ContaApi | null>(null);

  useEffect(() => {
    vault.categorias
      .listar()
      .then(setCategorias)
      .catch(() => setCategorias([]));
    // Auto-seleciona a Conta padrão (ou a primeira existente) — sem isso a
    // Transação não entra em `saldos_por_conta` (GAP-14, CreateFlow.tsx).
    // O form de Captura rápida não pede pra escolher Conta explicitamente
    // (fora do escopo da seção 3.6), então isso acontece em silêncio.
    vault.contas
      .listar()
      .then((lista) => {
        const escolhida = lista.find((c) => c.padrao) ?? lista[0] ?? null;
        setConta(escolhida);
        if (escolhida) setDraft((d) => ({ ...d, contaId: escolhida.id }));
      })
      .catch(() => setConta(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoriasVisiveis = (categorias ?? []).filter((c) => c.tipo === "ambos" || c.tipo === draft.tipoTransacao);

  function apertar(tecla: string) {
    if (tecla === "") return;
    setDraft((prev) => {
      if (tecla === "del") return { ...prev, valorCentavos: Math.floor(prev.valorCentavos / 10) };
      const proximo = prev.valorCentavos * 10 + Number(tecla);
      return proximo > 999_999_999 ? prev : { ...prev, valorCentavos: proximo };
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex rounded-pill bg-surface-2 p-1 self-center">
        <button
          onClick={() => setDraft((d) => ({ ...d, tipoTransacao: "saida" }))}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
            draft.tipoTransacao === "saida" ? "bg-error/20 text-error" : "text-text-muted"
          }`}
        >
          Saída
        </button>
        <button
          onClick={() => setDraft((d) => ({ ...d, tipoTransacao: "entrada" }))}
          className={`rounded-pill px-4 py-1.5 text-sm font-medium ${
            draft.tipoTransacao === "entrada" ? "bg-success/20 text-success" : "text-text-muted"
          }`}
        >
          Entrada
        </button>
      </div>

      <p
        className={`text-center font-mono-value text-4xl font-bold ${
          draft.tipoTransacao === "entrada" ? "text-success" : "text-text-primary"
        }`}
      >
        {formatMoeda(draft.valorCentavos)}
      </p>

      <input
        value={draft.texto}
        onChange={(e) => setDraft((d) => ({ ...d, texto: e.target.value }))}
        placeholder="Descrição (ex: almoço, aluguel...)"
        className="w-full rounded-2xl bg-surface-2 px-4 py-3 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {conta && <p className="-mt-3 text-xs text-text-muted">Sai de: {conta.nome}</p>}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Categoria</p>
        {categorias === null ? (
          <p className="text-sm text-text-muted">Carregando categorias do Cofre...</p>
        ) : categoriasVisiveis.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nenhuma categoria de {draft.tipoTransacao} cadastrada ainda — a Transação pode ser salva sem categoria.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categoriasVisiveis.map((c) => {
              const IconCmp = (Icons as unknown as Record<string, Icons.LucideIcon>)[c.icone ?? ""] ?? Icons.Circle;
              return (
                <Chip
                  key={c.id}
                  selected={draft.categoriaId === c.id}
                  accentColor={c.cor}
                  icon={<IconCmp size={15} strokeWidth={1.75} style={{ color: c.cor }} />}
                  onClick={() => setDraft((d) => ({ ...d, categoriaId: c.id }))}
                >
                  {c.nome}
                </Chip>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {TECLAS.map((t, i) =>
          t === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              onClick={() => apertar(t)}
              className="flex h-12 items-center justify-center rounded-xl bg-surface-2 font-mono-value text-lg text-text-primary hover:bg-surface-3"
            >
              {t === "del" ? <Delete size={18} /> : t}
            </button>
          ),
        )}
      </div>

      <button
        onClick={onSalvar}
        disabled={!draft.texto.trim() || draft.valorCentavos === 0 || salvando}
        className="mt-1 rounded-2xl bg-violet py-3.5 text-center font-body text-[15px] font-semibold text-black disabled:opacity-40"
      >
        {salvando ? "Salvando..." : "Salvar Transação"}
      </button>
    </div>
  );
}
