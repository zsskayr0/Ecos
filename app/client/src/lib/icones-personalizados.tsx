import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { iconesPersonalizados, type IconePersonalizado } from "./api";

/**
 * Ícones de pasta enviados pela pessoa (Configurações → Ícones personalizados). A pasta guarda `img:<id>`; a imagem vem
 * do servidor como Blob autenticado (funciona no Tauri, onde `<img>` não manda o Bearer) e um id nunca muda de conteúdo,
 * então o endereço fica em cache pela sessão.
 */
export const PREFIXO_ICONE_IMAGEM = "img:";
export const idDoIconeImagem = (icone: string | null | undefined) => (icone?.startsWith(PREFIXO_ICONE_IMAGEM) ? icone.slice(PREFIXO_ICONE_IMAGEM.length) : null);

const EVENTO = "ecos:icones-personalizados";
const urls = new Map<string, string | null>();
const carregando = new Map<string, Promise<string | null>>();
let lista: IconePersonalizado[] | null = null;
let listando: Promise<void> | null = null;

const avisar = () => window.dispatchEvent(new Event(EVENTO));

async function recarregarLista(): Promise<void> {
  listando ??= iconesPersonalizados.listar().then((itens) => { lista = itens; }).catch(() => { lista ??= []; }).finally(() => { listando = null; avisar(); });
  return listando;
}

export async function enviarIconePersonalizado(arquivo: File, nome: string): Promise<IconePersonalizado> {
  const novo = await iconesPersonalizados.enviar(arquivo, nome);
  lista = [...(lista ?? []), novo];
  avisar();
  return novo;
}

export async function removerIconePersonalizado(id: string): Promise<void> {
  await iconesPersonalizados.remover(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  lista = (lista ?? []).filter((i) => i.id !== id);
  avisar();
}

/** Lista dos ícones da pessoa (`null` enquanto carrega pela primeira vez). */
export function useIconesPersonalizados(ativo = true): IconePersonalizado[] | null {
  const [itens, setItens] = useState(lista);
  useEffect(() => {
    if (!ativo) return;
    const atualizar = () => setItens(lista);
    window.addEventListener(EVENTO, atualizar);
    if (lista === null) void recarregarLista(); else atualizar();
    return () => window.removeEventListener(EVENTO, atualizar);
  }, [ativo]);
  return itens;
}

function carregarUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return Promise.resolve(urls.get(id)!);
  let p = carregando.get(id);
  if (!p) {
    p = iconesPersonalizados.obter(id)
      .then((blob) => { const url = blob ? URL.createObjectURL(blob) : null; urls.set(id, url); return url; })
      .catch(() => null)
      .finally(() => carregando.delete(id));
    carregando.set(id, p);
  }
  return p;
}

/** Imagem do ícone `id`; sem a imagem (de outra pessoa, apagada ou ainda carregando) aparece a pasta comum. */
export function IconeImagem({ id, size }: { id: string; size: number }) {
  const [url, setUrl] = useState<string | null | undefined>(() => urls.get(id));
  useEffect(() => {
    let ativo = true;
    void carregarUrl(id).then((u) => { if (ativo) setUrl(u); });
    return () => { ativo = false; };
  }, [id]);
  if (!url) return <Folder size={size} strokeWidth={1.5} />;
  return <img src={url} alt="" draggable={false} style={{ width: size, height: size }} className="shrink-0 rounded-[3px] object-contain" />;
}
