import { useCallback, useEffect, useState } from "react";
import { DatabaseBackup, RefreshCw } from "lucide-react";
import { vault } from "@/lib/api";

type Item = { nome: string; tamanho_bytes: number };
type Politica = { frequencia: string; retencao: string; proxima_execucao_automatica: string };

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** `vault-2026-10-02.enc` vira "Cópia de 02/10/2026"; `pre-reset-…` aparece como cópia de antes do reset. */
export function rotuloDoBackup(nome: string): string {
  const m = /^vault-(\d{4})-(\d{2})-(\d{2})\.enc$/.exec(nome);
  if (m) return `Cópia de ${m[3]}/${m[2]}/${m[1]}`;
  if (nome.startsWith("pre-reset")) return "Antes de apagar o Cofre";
  return nome;
}

/**
 * Backups cifrados que o servidor guarda do Cofre: política, histórico e "fazer agora". São arquivos do servidor
 * (quem administra o Ecos os restaura); o arquivo não é baixado por aqui.
 */
export function BackupsCofre() {
  const [politica, setPolitica] = useState<Politica | null>(null);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([vault.backup.config(), vault.backup.historico()]);
      setPolitica(p);
      setItens([...h].sort((a, b) => b.nome.localeCompare(a.nome)));
      setErro("");
    } catch (e) {
      setErro((e as Error).message || "Não foi possível consultar os backups.");
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  async function agora() {
    setOcupado(true); setAviso(""); setErro("");
    try {
      const r = await vault.backup.exportar();
      setAviso(r.arquivo ? `Backup criado: ${r.arquivo}.` : "Backup criado.");
      await carregar();
    } catch (e) {
      setErro((e as Error).message || "Não foi possível criar o backup.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className="cofre-card cofre-csv-card" aria-labelledby="backups-titulo">
      <span className="cofre-csv-icone"><DatabaseBackup size={18} aria-hidden /></span>
      <h3 id="backups-titulo">Backups do Cofre</h3>
      <p>Cópias cifradas guardadas no servidor{politica ? `: ${politica.frequencia}, ${politica.retencao}` : ""}. Para restaurar, peça a quem administra o servidor.</p>
      <button type="button" className="cofre-config-btn" disabled={ocupado} onClick={() => void agora()}><RefreshCw size={14} aria-hidden />{ocupado ? "Criando…" : "Fazer backup agora"}</button>
      {erro && <p role="alert" className="cofre-csv-erro">{erro}</p>}
      {aviso && <p role="status" className="cofre-csv-status" data-tom="ok">{aviso}</p>}
      {itens && itens.length === 0 && <p className="text-sm text-text-muted">Nenhum backup ainda. O primeiro sai na rotina diária.</p>}
      {itens && itens.length > 0 && (
        <ul aria-label="Histórico de backups" className="text-sm">
          {itens.map((i) => <li key={i.nome}>{rotuloDoBackup(i.nome)} · {tamanho(i.tamanho_bytes)}</li>)}
        </ul>
      )}
    </article>
  );
}
