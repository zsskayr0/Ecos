import { afterEach, expect, it, vi } from "vitest";
import { AreaDeTransferenciaIndisponivel, arquivosColados, lerAreaDeTransferencia, nomearColado } from "./colar-comprovante";

const agora = new Date(2026, 9, 2, 14, 5, 9);
const imagem = (nome = "image.png", tipo = "image/png") => new File(["x"], nome, { type: tipo });

function colar(opcoes: { arquivos?: File[]; types?: string[]; alvo?: HTMLElement }) {
  const arquivos = opcoes.arquivos ?? [];
  const ev = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, "clipboardData", { value: { files: arquivos, types: opcoes.types ?? (arquivos.length ? ["Files"] : ["text/plain"]) } });
  (opcoes.alvo ?? document.body).dispatchEvent(ev);
  return ev;
}
function capturar(opcoes: Parameters<typeof colar>[0]) {
  let achados: File[] = [];
  const ouvinte = (e: Event) => { achados = arquivosColados(e as ClipboardEvent, agora); };
  window.addEventListener("paste", ouvinte);
  colar(opcoes);
  window.removeEventListener("paste", ouvinte);
  return achados;
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("imagem colada ganha nome com data e hora; arquivo com nome próprio mantém o nome", () => {
  expect(nomearColado(imagem(), agora).name).toBe("colado-2026-10-02-140509.png");
  expect(nomearColado(imagem("image.jpeg", "image/jpeg"), agora).name).toBe("colado-2026-10-02-140509.jpg");
  expect(nomearColado(imagem(), agora, 1, 2).name).toBe("colado-2026-10-02-140509-2.png");
  const pix = imagem("pix.png");
  expect(nomearColado(pix, agora)).toBe(pix);
});

it("Ctrl+V com imagem copiada (ex.: do WhatsApp Web) vira comprovante", () => {
  const achados = capturar({ arquivos: [imagem()] });
  expect(achados.map((f) => f.name)).toEqual(["colado-2026-10-02-140509.png"]);
});

it("colar texto, ou arquivo que o Cofre não guarda, não é conosco", () => {
  expect(capturar({ types: ["text/plain"] })).toEqual([]);
  expect(capturar({ arquivos: [imagem("a.zip", "application/zip")] })).toEqual([]);
});

it("dentro de um campo de digitação, imagem junto com texto é colar texto; imagem sozinha é comprovante", () => {
  const campo = document.createElement("input");
  campo.type = "text";
  document.body.appendChild(campo);
  expect(capturar({ arquivos: [imagem()], types: ["Files", "text/plain"], alvo: campo })).toEqual([]);
  expect(capturar({ arquivos: [imagem()], types: ["Files"], alvo: campo }).length).toBe(1);
  const area = document.createElement("textarea");
  document.body.appendChild(area);
  expect(capturar({ arquivos: [imagem()], types: ["Files", "text/plain"], alvo: area })).toEqual([]);
});

it("botão Colar: lê a imagem da área de transferência", async () => {
  vi.stubGlobal("navigator", { clipboard: { read: async () => [{ types: ["text/plain", "image/png"], getType: async () => new Blob(["png"], { type: "image/png" }) }] } });
  const lidos = await lerAreaDeTransferencia(agora);
  expect(lidos.map((f) => [f.name, f.type])).toEqual([["colado-2026-10-02-140509.png", "image/png"]]);
});

it("botão Colar: permissão negada, navegador sem suporte e área sem imagem dão mensagens claras", async () => {
  vi.stubGlobal("navigator", { clipboard: { read: async () => { throw new DOMException("negado", "NotAllowedError"); } } });
  await expect(lerAreaDeTransferencia()).rejects.toThrow(/Ctrl\+V/);
  vi.stubGlobal("navigator", {});
  await expect(lerAreaDeTransferencia()).rejects.toBeInstanceOf(AreaDeTransferenciaIndisponivel);
  vi.stubGlobal("navigator", { clipboard: { read: async () => [{ types: ["text/plain"], getType: async () => new Blob(["t"]) }] } });
  await expect(lerAreaDeTransferencia()).rejects.toThrow(/Não há imagem/);
});
