type MetodoMutacao = "POST" | "PUT" | "PATCH" | "DELETE";

export interface MutacaoPendente {
  id: string;
  metodo: MetodoMutacao;
  caminho: string;
  corpo: string | null;
  criadaEm: number;
  tempId?: string;
  erro?: string;
}

export interface EstadoOffline {
  servidorDisponivel: boolean;
  sincronizando: boolean;
  pendentes: number;
  erro: string | null;
}

type CacheRegistro = { chave: string; valor: unknown; salvoEm: number };

const NOME_DB = "ecos-offline-v1";
const CACHE = "respostas";
const FILA = "fila";
const memoriaCache = new Map<string, CacheRegistro>();
const memoriaFila = new Map<string, MutacaoPendente>();
let dbPromessa: Promise<IDBDatabase | null> | null = null;
let estado: EstadoOffline = {
  servidorDisponivel: typeof navigator === "undefined" ? true : navigator.onLine,
  sincronizando: false,
  pendentes: 0,
  erro: null,
};

function abrirDb(): Promise<IDBDatabase | null> {
  if (dbPromessa) return dbPromessa;
  dbPromessa = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    const pedido = indexedDB.open(NOME_DB, 1);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: "chave" });
      if (!db.objectStoreNames.contains(FILA)) db.createObjectStore(FILA, { keyPath: "id" });
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => resolve(null);
  });
  return dbPromessa;
}

async function obter<T>(loja: string, chave: IDBValidKey): Promise<T | undefined> {
  const db = await abrirDb();
  if (!db) return (loja === CACHE ? memoriaCache : memoriaFila).get(String(chave)) as T | undefined;
  return new Promise((resolve) => {
    const pedido = db.transaction(loja, "readonly").objectStore(loja).get(chave);
    pedido.onsuccess = () => resolve(pedido.result as T | undefined);
    pedido.onerror = () => resolve(undefined);
  });
}

async function todos<T>(loja: string): Promise<T[]> {
  const db = await abrirDb();
  if (!db) return [...(loja === CACHE ? memoriaCache : memoriaFila).values()] as T[];
  return new Promise((resolve) => {
    const pedido = db.transaction(loja, "readonly").objectStore(loja).getAll();
    pedido.onsuccess = () => resolve((pedido.result ?? []) as T[]);
    pedido.onerror = () => resolve([]);
  });
}

async function gravar<T extends { chave?: string; id?: string }>(loja: string, valor: T): Promise<void> {
  const db = await abrirDb();
  if (!db) {
    const chave = String(valor.chave ?? valor.id);
    (loja === CACHE ? memoriaCache : memoriaFila).set(chave, valor as never);
    return;
  }
  await new Promise<void>((resolve) => {
    const pedido = db.transaction(loja, "readwrite").objectStore(loja).put(valor);
    pedido.onsuccess = () => resolve();
    pedido.onerror = () => resolve();
  });
}

async function remover(loja: string, chave: IDBValidKey): Promise<void> {
  const db = await abrirDb();
  if (!db) { (loja === CACHE ? memoriaCache : memoriaFila).delete(String(chave)); return; }
  await new Promise<void>((resolve) => {
    const pedido = db.transaction(loja, "readwrite").objectStore(loja).delete(chave);
    pedido.onsuccess = () => resolve();
    pedido.onerror = () => resolve();
  });
}

async function limparLoja(loja: string): Promise<void> {
  const db = await abrirDb();
  if (!db) { (loja === CACHE ? memoriaCache : memoriaFila).clear(); return; }
  await new Promise<void>((resolve) => {
    const pedido = db.transaction(loja, "readwrite").objectStore(loja).clear();
    pedido.onsuccess = () => resolve();
    pedido.onerror = () => resolve();
  });
}

function emitir(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ecos:offline-change", { detail: estado }));
}

async function atualizarQuantidade(): Promise<void> {
  estado = { ...estado, pendentes: (await listarMutacoesPendentes()).length };
  emitir();
}

export function obterEstadoOffline(): EstadoOffline { return { ...estado }; }

export function marcarServidorDisponivel(disponivel: boolean): void {
  if (estado.servidorDisponivel === disponivel && (disponivel || !estado.erro)) return;
  estado = { ...estado, servidorDisponivel: disponivel, erro: disponivel ? null : estado.erro };
  emitir();
}

export function marcarSincronizacao(sincronizando: boolean, erro: string | null = null): void {
  estado = { ...estado, sincronizando, erro };
  emitir();
}

export async function guardarRespostaOffline(chave: string, valor: unknown): Promise<void> {
  await gravar(CACHE, { chave, valor, salvoEm: Date.now() });
  const url = new URL(chave, "https://offline.ecos");
  const tipo = url.pathname === "/notas" ? "notas" : url.pathname === "/tarefas" ? "tarefas" : null;
  if (tipo && pagina(valor)) {
    const chaveColecao = `__colecao__:${tipo}`;
    const anterior = (await obter<CacheRegistro>(CACHE, chaveColecao))?.valor;
    const itensAnteriores = Array.isArray(anterior) ? anterior as Record<string, unknown>[] : [];
    const porId = new Map(itensAnteriores.map((item) => [String(item.id), item]));
    valor.items.forEach((item) => porId.set(String(item.id), item));
    await gravar(CACHE, { chave: chaveColecao, valor: [...porId.values()], salvoEm: Date.now() });
  } else if (url.pathname === "/eventos" && Array.isArray(valor)) {
    const chaveColecao = "__colecao__:eventos";
    const anterior = (await obter<CacheRegistro>(CACHE, chaveColecao))?.valor;
    const itensAnteriores = Array.isArray(anterior) ? anterior as Record<string, unknown>[] : [];
    const porId = new Map(itensAnteriores.map((item) => [String(item.id), item]));
    (valor as Record<string, unknown>[]).forEach((item) => porId.set(String(item.id), item));
    await gravar(CACHE, { chave: chaveColecao, valor: [...porId.values()], salvoEm: Date.now() });
  } else if (url.pathname === "/pastas" && valor && typeof valor === "object" && Array.isArray((valor as { subpastas?: unknown }).subpastas)) {
    const tipoPasta = url.searchParams.get("tipo") ?? "nota";
    const espaco = url.searchParams.get("espaco") ?? "pessoal";
    const chaveColecao = `__pastas__:${tipoPasta}:${espaco}`;
    const anterior = (await obter<CacheRegistro>(CACHE, chaveColecao))?.valor;
    const pastasAnteriores = Array.isArray(anterior) ? anterior as Record<string, unknown>[] : [];
    const porCaminho = new Map(pastasAnteriores.map((item) => [String(item.caminho), item]));
    ((valor as { subpastas: Record<string, unknown>[] }).subpastas).forEach((item) => porCaminho.set(String(item.caminho), item));
    await gravar(CACHE, { chave: chaveColecao, valor: [...porCaminho.values()], salvoEm: Date.now() });
  }
}

export async function obterRespostaOffline<T>(chave: string): Promise<T | undefined> {
  const exata = (await obter<CacheRegistro>(CACHE, chave))?.valor as T | undefined;
  if (exata !== undefined) return exata;
  const url = new URL(chave, "https://offline.ecos");
  const tipo = url.pathname === "/notas" ? "notas" : url.pathname === "/tarefas" ? "tarefas" : null;
  if (tipo) {
    const colecao = (await obter<CacheRegistro>(CACHE, `__colecao__:${tipo}`))?.valor;
    if (!Array.isArray(colecao)) return undefined;
    let itens = colecao as Record<string, unknown>[];
    const pasta = url.searchParams.get("pasta");
    const espaco = url.searchParams.get("espaco");
    const status = url.searchParams.get("status");
    const tag = url.searchParams.get("tag");
    const dataDe = url.searchParams.get("data_de");
    const dataAte = url.searchParams.get("data_ate");
    if (pasta !== null) itens = itens.filter((item) => String(item.pasta ?? "") === pasta);
    if (espaco) itens = itens.filter((item) => item.espaco === espaco);
    if (status) itens = itens.filter((item) => item.status === status);
    if (tag) itens = itens.filter((item) => (item.tags as unknown[] | undefined)?.includes(tag));
    if (dataDe || dataAte) itens = itens.filter((item) => {
      const data = String(item.scheduled_at ?? item.due_date ?? "").slice(0, 10);
      return !!data && (!dataDe || data >= dataDe) && (!dataAte || data <= dataAte);
    });
    const limite = Number(url.searchParams.get("limit")) || itens.length;
    return { items: itens.slice(0, limite), next_cursor: null } as T;
  }
  if (url.pathname === "/eventos") {
    const colecao = (await obter<CacheRegistro>(CACHE, "__colecao__:eventos"))?.valor;
    if (!Array.isArray(colecao)) return undefined;
    let itens = colecao as Record<string, unknown>[];
    const de = url.searchParams.get("de");
    const ate = url.searchParams.get("ate");
    const espaco = url.searchParams.get("espaco");
    if (espaco) itens = itens.filter((item) => item.espaco === espaco);
    if (de) itens = itens.filter((item) => String(item.fim ?? item.inicio ?? "") >= de);
    if (ate) itens = itens.filter((item) => String(item.inicio ?? "") <= ate);
    return itens as T;
  }
  if (url.pathname.startsWith("/eventos/")) {
    const colecao = (await obter<CacheRegistro>(CACHE, "__colecao__:eventos"))?.valor;
    if (!Array.isArray(colecao)) return undefined;
    const id = url.pathname.split("/")[2];
    return colecao.find((item) => item && typeof item === "object" && String((item as { id?: unknown }).id) === id) as T | undefined;
  }
  if (url.pathname === "/pastas") {
    const tipoPasta = url.searchParams.get("tipo") ?? "nota";
    const espaco = url.searchParams.get("espaco") ?? "pessoal";
    const colecao = (await obter<CacheRegistro>(CACHE, `__pastas__:${tipoPasta}:${espaco}`))?.valor;
    if (!Array.isArray(colecao)) return undefined;
    const recursivo = url.searchParams.get("recursivo") === "true";
    const pai = url.searchParams.get("pasta_pai") ?? "";
    const prefixo = pai ? `${pai}/` : "";
    const subpastas = (colecao as Record<string, unknown>[]).filter((item) => {
      const caminho = String(item.caminho ?? "");
      if (!caminho.startsWith(prefixo) || caminho === pai) return false;
      return recursivo || !caminho.slice(prefixo.length).includes("/");
    });
    return { subpastas, itens: [] } as T;
  }
  return undefined;
}

export async function listarMutacoesPendentes(): Promise<MutacaoPendente[]> {
  return (await todos<MutacaoPendente>(FILA)).sort((a, b) => a.criadaEm - b.criadaEm);
}

export async function concluirMutacaoPendente(id: string): Promise<void> {
  await remover(FILA, id);
  await atualizarQuantidade();
}

export async function registrarErroMutacao(id: string, erro: string): Promise<void> {
  const item = await obter<MutacaoPendente>(FILA, id);
  if (item) await gravar(FILA, { ...item, erro });
  estado = { ...estado, erro };
  emitir();
}

function novoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function corpoObjeto(corpo: string | null): Record<string, unknown> {
  try { return corpo ? JSON.parse(corpo) as Record<string, unknown> : {}; } catch { return {}; }
}

function precisaIdTemporario(caminho: string): boolean {
  return caminho === "/notas" || caminho === "/tarefas" || caminho === "/eventos" || caminho === "/eventos/categorias"
    || caminho === "/rotina/blocos" || /^\/tarefas\/[^/]+\/time-entries$/.test(caminho);
}

function pagina(valor: unknown): valor is { items: Record<string, unknown>[]; next_cursor: string | null } {
  return !!valor && typeof valor === "object" && Array.isArray((valor as { items?: unknown }).items);
}

function listaAceita(chave: string, item: Record<string, unknown>, tipo: "nota" | "tarefa"): boolean {
  const url = new URL(chave, "https://offline.ecos");
  if (url.pathname !== `/${tipo === "nota" ? "notas" : "tarefas"}`) return false;
  const pasta = url.searchParams.get("pasta");
  if (pasta !== null && String(item.pasta ?? "") !== pasta) return false;
  const espaco = url.searchParams.get("espaco");
  if (espaco && item.espaco !== espaco) return false;
  const status = url.searchParams.get("status");
  if (tipo === "tarefa" && status && item.status !== status) return false;
  const tag = url.searchParams.get("tag");
  if (tipo === "nota" && tag && !(item.tags as unknown[] | undefined)?.includes(tag)) return false;
  return true;
}

async function alterarCaches(mutacao: (registro: CacheRegistro) => CacheRegistro | null): Promise<void> {
  const registros = await todos<CacheRegistro>(CACHE);
  await Promise.all(registros.map(async (registro) => {
    const alterado = mutacao(registro);
    if (!alterado) await remover(CACHE, registro.chave);
    else if (alterado !== registro) {
      if (alterado.chave !== registro.chave) await remover(CACHE, registro.chave);
      await gravar(CACHE, alterado);
    }
  }));
}

async function aplicarEmNotasTarefas(metodo: MetodoMutacao, caminho: string, corpo: Record<string, unknown>, tempId?: string): Promise<void> {
  const partes = caminho.split("?")[0].split("/").filter(Boolean);
  const tipo = partes[0] === "notas" ? "nota" : partes[0] === "tarefas" ? "tarefa" : null;
  if (!tipo) return;
  const colecao = tipo === "nota" ? "notas" : "tarefas";
  const id = partes[1] ?? tempId;
  const agora = new Date().toISOString();

  if (metodo === "POST" && caminho === `/${colecao}` && tempId) {
    const item: Record<string, unknown> = tipo === "nota"
      ? { id: tempId, titulo: corpo.titulo ?? "Sem título", corpo: corpo.corpo ?? "", modo: corpo.modo ?? "texto", pasta: corpo.pasta ?? null, espaco: corpo.espaco ?? "pessoal", criado_em: agora, atualizado_em: agora, ultima_revisao_em: null, tags: corpo.tags ?? [], criado_por: null, criado_por_nome: null, caminho_arquivo: "" }
      : { id: tempId, titulo: corpo.titulo ?? "Sem título", corpo: corpo.corpo ?? "", status: "pendente", scheduled_at: corpo.scheduled_at ?? null, duration_min: corpo.duration_min ?? 5, due_date: corpo.due_date ?? null, pasta: corpo.pasta ?? null, espaco: corpo.espaco ?? "pessoal", criado_em: agora, atualizado_em: agora, concluida_em: null, tags: corpo.tags ?? [], prioridade: corpo.prioridade ?? "baixa", subtarefas: corpo.subtarefas ?? [], criado_por: null, criado_por_nome: null, caminho_arquivo: "" };
    await guardarRespostaOffline(`/${colecao}/${tempId}`, item);
    const chaveColecao = `__colecao__:${colecao}`;
    const colecaoAtual = (await obter<CacheRegistro>(CACHE, chaveColecao))?.valor;
    const itensColecao = Array.isArray(colecaoAtual) ? colecaoAtual as Record<string, unknown>[] : [];
    await gravar(CACHE, { chave: chaveColecao, valor: [item, ...itensColecao.filter((x) => x.id !== tempId)], salvoEm: Date.now() });
    await alterarCaches((registro) => {
      if (!pagina(registro.valor) || !listaAceita(registro.chave, item, tipo)) return registro;
      return { ...registro, valor: { ...registro.valor, items: [item, ...registro.valor.items.filter((x) => x.id !== tempId)] } };
    });
    return;
  }

  if (!id || id === "categorias") return;
  await alterarCaches((registro) => {
    if (registro.chave === `__colecao__:${colecao}` && Array.isArray(registro.valor)) {
      if (metodo === "DELETE") return { ...registro, valor: (registro.valor as Record<string, unknown>[]).filter((x) => x.id !== id) };
      const patch = partes[2] === "status" ? { status: corpo.status } : corpo;
      return { ...registro, valor: (registro.valor as Record<string, unknown>[]).map((x) => x.id === id ? { ...x, ...patch, atualizado_em: agora } : x) };
    }
    if (registro.chave === `/${colecao}/${id}`) {
      if (metodo === "DELETE") return null;
      if (registro.valor && typeof registro.valor === "object") {
        const patch = partes[2] === "status" ? { status: corpo.status } : corpo;
        return { ...registro, valor: { ...(registro.valor as object), ...patch, atualizado_em: agora } };
      }
    }
    if (pagina(registro.valor) && (registro.chave === `/${colecao}` || registro.chave.startsWith(`/${colecao}?`))) {
      if (metodo === "DELETE") return { ...registro, valor: { ...registro.valor, items: registro.valor.items.filter((x) => x.id !== id) } };
      const patch = partes[2] === "status" ? { status: corpo.status } : corpo;
      return { ...registro, valor: { ...registro.valor, items: registro.valor.items.map((x) => x.id === id ? { ...x, ...patch, atualizado_em: agora } : x) } };
    }
    return registro;
  });
}

async function aplicarEmPastas(metodo: MetodoMutacao, corpo: Record<string, unknown>): Promise<void> {
  const tipo = String(corpo.tipo ?? "nota");
  const espaco = String(corpo.espaco ?? "pessoal");
  const chave = `__pastas__:${tipo}:${espaco}`;
  const atual = (await obter<CacheRegistro>(CACHE, chave))?.valor;
  let pastas = Array.isArray(atual) ? atual as Record<string, unknown>[] : [];
  if (metodo === "POST") {
    const pai = String(corpo.pasta_pai ?? "").replace(/^\/+|\/+$/g, "");
    const caminho = [pai, String(corpo.nome ?? "")].filter(Boolean).join("/");
    pastas = [...pastas.filter((p) => p.caminho !== caminho), { caminho, nome: caminho.split("/").slice(-1)[0] ?? caminho, contagem_itens: 0 }];
  } else if (metodo === "PATCH") {
    const anterior = String(corpo.caminho_atual ?? "");
    const novo = String(corpo.novo_caminho ?? "");
    pastas = pastas.map((p) => {
      const caminho = String(p.caminho ?? "");
      if (caminho !== anterior && !caminho.startsWith(`${anterior}/`)) return p;
      const atualizado = `${novo}${caminho.slice(anterior.length)}`;
      return { ...p, caminho: atualizado, nome: atualizado.split("/").slice(-1)[0] ?? atualizado };
    });
  } else if (metodo === "DELETE") {
    const removida = String(corpo.caminho ?? "");
    pastas = pastas.filter((p) => p.caminho !== removida && !String(p.caminho ?? "").startsWith(`${removida}/`));
  }
  await gravar(CACHE, { chave, valor: pastas, salvoEm: Date.now() });
  await alterarCaches((registro) => new URL(registro.chave, "https://offline.ecos").pathname === "/pastas" ? null : registro);
}

async function aplicarEmEventos(metodo: MetodoMutacao, caminho: string, corpo: Record<string, unknown>, tempId?: string): Promise<void> {
  const partes = caminho.split("?")[0].split("/").filter(Boolean);
  if (partes[0] !== "eventos" || partes[1] === "categorias") return;
  const chave = "__colecao__:eventos";
  const atual = (await obter<CacheRegistro>(CACHE, chave))?.valor;
  let eventos = Array.isArray(atual) ? atual as Record<string, unknown>[] : [];
  const agora = new Date().toISOString();
  if (metodo === "POST" && caminho === "/eventos" && tempId) {
    const evento = { id: tempId, titulo: corpo.titulo ?? "Sem título", inicio: corpo.inicio, fim: corpo.fim, dia_inteiro: corpo.dia_inteiro ?? false, fuso: corpo.fuso ?? null, local: corpo.local ?? null, descricao: corpo.descricao ?? "", categoria_id: corpo.categoria_id ?? null, categoria: null, cor: corpo.cor ?? null, visibilidade: corpo.visibilidade ?? "privado", rrule: corpo.rrule ?? null, espaco: corpo.espaco ?? "pessoal", origem_google: false, sync_pendente: true, criado_em: agora, atualizado_em: agora, tarefas: [], notas: [] };
    eventos = [evento, ...eventos.filter((item) => item.id !== tempId)];
    await guardarRespostaOffline(`/eventos/${tempId}`, evento);
  } else if (partes[1]) {
    const id = partes[1];
    if (metodo === "DELETE") eventos = eventos.filter((evento) => evento.id !== id);
    else eventos = eventos.map((evento) => evento.id === id ? { ...evento, ...corpo, atualizado_em: agora, sync_pendente: true } : evento);
  }
  await gravar(CACHE, { chave, valor: eventos, salvoEm: Date.now() });
  await alterarCaches((registro) => new URL(registro.chave, "https://offline.ecos").pathname === "/eventos" ? null : registro);
}

function respostaOtimista(metodo: MetodoMutacao, caminho: string, corpo: Record<string, unknown>, tempId?: string): unknown {
  if (caminho === "/pastas" && metodo === "POST") {
    const pai = String(corpo.pasta_pai ?? "").replace(/^\/+|\/+$/g, "");
    return { ok: true, caminho: [pai, corpo.nome].filter(Boolean).join("/") };
  }
  if (metodo === "DELETE") return { ok: true };
  if (caminho === "/eventos" && tempId) {
    const agora = new Date().toISOString();
    return { id: tempId, ...corpo, dia_inteiro: corpo.dia_inteiro ?? false, fuso: corpo.fuso ?? null, local: corpo.local ?? null, categoria_id: corpo.categoria_id ?? null, categoria: null, cor: corpo.cor ?? null, visibilidade: corpo.visibilidade ?? "privado", rrule: corpo.rrule ?? null, espaco: corpo.espaco ?? "pessoal", origem_google: false, sync_pendente: true, criado_em: agora, atualizado_em: agora, tarefas: [], notas: [] };
  }
  if (tempId) return { id: tempId, ...corpo, criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(), sync_pendente: true };
  const partes = caminho.split("?")[0].split("/").filter(Boolean);
  return { ok: true, id: partes[partes.length - 1], ...corpo, sync_pendente: true };
}

export async function enfileirarMutacao(metodo: MetodoMutacao, caminho: string, corpoBruto: string | null): Promise<unknown> {
  const corpo = corpoObjeto(corpoBruto);
  const existentes = await listarMutacoesPendentes();
  const anterior = metodo === "PATCH" ? [...existentes].reverse().find((item) => item.metodo === "PATCH" && item.caminho === caminho) : undefined;
  if (anterior) {
    const mesclado = { ...corpoObjeto(anterior.corpo), ...corpo };
    await gravar(FILA, { ...anterior, corpo: JSON.stringify(mesclado), erro: undefined });
    await aplicarEmNotasTarefas(metodo, caminho, corpo);
    if (caminho.split("?")[0] === "/pastas") await aplicarEmPastas(metodo, corpo);
    if (caminho.split("?")[0].startsWith("/eventos")) await aplicarEmEventos(metodo, caminho, corpo);
    marcarServidorDisponivel(false);
    await atualizarQuantidade();
    return respostaOtimista(metodo, caminho, corpo);
  }

  const tempId = metodo === "POST" && precisaIdTemporario(caminho) ? `offline-${novoId()}` : undefined;
  const item: MutacaoPendente = { id: novoId(), metodo, caminho, corpo: corpoBruto, criadaEm: Date.now(), tempId };
  await gravar(FILA, item);
  await aplicarEmNotasTarefas(metodo, caminho, corpo, tempId);
  if (caminho.split("?")[0] === "/pastas") await aplicarEmPastas(metodo, corpo);
  if (caminho.split("?")[0].startsWith("/eventos")) await aplicarEmEventos(metodo, caminho, corpo, tempId);
  marcarServidorDisponivel(false);
  await atualizarQuantidade();
  return respostaOtimista(metodo, caminho, corpo, tempId);
}

export async function substituirIdTemporario(tempId: string, realId: string): Promise<void> {
  await alterarCaches((registro) => {
    const chave = registro.chave.replace(tempId, realId);
    let valor = registro.valor;
    if (valor && typeof valor === "object") {
      if (pagina(valor)) valor = { ...valor, items: valor.items.map((x) => x.id === tempId ? { ...x, id: realId } : x) };
      else if (Array.isArray(valor)) valor = valor.map((x) => x && typeof x === "object" && (x as { id?: unknown }).id === tempId ? { ...x, id: realId } : x);
      else if ((valor as { id?: unknown }).id === tempId) valor = { ...(valor as object), id: realId };
    }
    return chave === registro.chave && valor === registro.valor ? registro : { chave, valor, salvoEm: registro.salvoEm };
  });
  const fila = await listarMutacoesPendentes();
  await Promise.all(fila.map((item) => {
    if (!item.caminho.includes(tempId) && !item.corpo?.includes(tempId)) return Promise.resolve();
    return gravar(FILA, { ...item, caminho: item.caminho.split(tempId).join(realId), corpo: item.corpo?.split(tempId).join(realId) ?? null });
  }));
}

export async function limparDadosOffline(): Promise<void> {
  await Promise.all([limparLoja(CACHE), limparLoja(FILA)]);
  estado = { servidorDisponivel: typeof navigator === "undefined" ? true : navigator.onLine, sincronizando: false, pendentes: 0, erro: null };
  emitir();
}

void atualizarQuantidade();
