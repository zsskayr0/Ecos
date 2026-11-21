import { notas } from "@/lib/api";
import { lerZip } from "@/lib/zip-mini";

export const EXTENSAO_IMPORTAVEL = /\.(md|markdown|docx)$/i;
const LIMITE_MD = 2 * 1024 * 1024;
const LIMITE_DOCX = 40 * 1024 * 1024;

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface DocxConvertido { markdown: string; imagens: { marcador: string; nome: string; dados: Uint8Array }[] }

const filhos = (el: Element, nome: string) => Array.from(el.children).filter((c) => c.localName === nome);
const filho = (el: Element | null | undefined, nome: string) => (el ? filhos(el, nome)[0] ?? null : null);
const val = (el: Element | null) => el?.getAttributeNS(W, "val") ?? el?.getAttribute("w:val") ?? null;
const ligado = (el: Element | null) => !!el && !["0", "false", "none"].includes(val(el) ?? "");
const escMd = (s: string) => s.replace(/([\\`*_[\]<>])/g, "\\$1");

function lerRels(xml: string | undefined): Map<string, { alvo: string; externo: boolean }> {
  const mapa = new Map<string, { alvo: string; externo: boolean }>();
  if (!xml) return mapa;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  for (const r of Array.from(doc.getElementsByTagName("Relationship"))) mapa.set(r.getAttribute("Id") ?? "", { alvo: r.getAttribute("Target") ?? "", externo: r.getAttribute("TargetMode") === "External" });
  return mapa;
}

/** numId → nível → é numerada? (a partir de word/numbering.xml) */
function lerNumeracao(xml: string | undefined): (numId: string, nivel: number) => boolean {
  if (!xml) return () => false;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const abstratos = new Map<string, Map<number, string>>();
  for (const a of Array.from(doc.getElementsByTagNameNS(W, "abstractNum"))) {
    const niveis = new Map<number, string>();
    for (const l of filhos(a, "lvl")) niveis.set(Number(l.getAttributeNS(W, "ilvl")), val(filho(l, "numFmt")) ?? "bullet");
    abstratos.set(a.getAttributeNS(W, "abstractNumId") ?? "", niveis);
  }
  const nums = new Map<string, string>();
  for (const n of Array.from(doc.getElementsByTagNameNS(W, "num"))) nums.set(n.getAttributeNS(W, "numId") ?? "", val(filho(n, "abstractNumId")) ?? "");
  return (numId, nivel) => { const f = abstratos.get(nums.get(numId) ?? "")?.get(nivel); return !!f && f !== "bullet" && f !== "none"; };
}

/** Converte um .docx em markdown. Imagens viram marcadores que quem chama troca pelo caminho do anexo. */
export async function docxParaMarkdown(buf: ArrayBuffer): Promise<DocxConvertido> {
  const zip = await lerZip(buf);
  const dec = new TextDecoder();
  const texto = (nome: string) => { const b = zip.get(nome); return b ? dec.decode(b) : undefined; };
  const docXml = texto("word/document.xml");
  if (!docXml) throw new Error("O arquivo não parece um documento do Word (.docx).");
  const rels = lerRels(texto("word/_rels/document.xml.rels"));
  const numerada = lerNumeracao(texto("word/numbering.xml"));
  // estilos com nome "heading N"/"Title" (o id muda conforme o idioma do Word)
  const titulos = new Map<string, number>();
  const estilos = texto("word/styles.xml");
  if (estilos) {
    const d = new DOMParser().parseFromString(estilos, "application/xml");
    for (const s of Array.from(d.getElementsByTagNameNS(W, "style"))) {
      const nome = (val(filho(s, "name")) ?? "").toLowerCase();
      const id = s.getAttributeNS(W, "styleId") ?? "";
      const m = /^heading (\d)$/.exec(nome);
      if (m) titulos.set(id, Number(m[1]));
      else if (nome === "title") titulos.set(id, 1);
      else if (nome === "subtitle") titulos.set(id, 2);
    }
  }
  const nivelTitulo = (estilo: string | null) => {
    if (!estilo) return 0;
    if (titulos.has(estilo)) return titulos.get(estilo)!;
    const m = /^(?:heading|titulo|título|ttulo)(\d)$/i.exec(estilo);
    return m ? Number(m[1]) : /^title$/i.test(estilo) ? 1 : 0;
  };

  const imagens: DocxConvertido["imagens"] = [];
  const imagemPorRel = new Map<string, string>();
  const marcadorImagem = (relId: string, alt: string) => {
    let marcador = imagemPorRel.get(relId);
    if (!marcador) {
      const rel = rels.get(relId);
      if (!rel || rel.externo) return "";
      const caminho = rel.alvo.startsWith("/") ? rel.alvo.slice(1) : `word/${rel.alvo}`;
      const dados = zip.get(caminho.replace(/\/[^/]+\/\.\.\//g, "/"));
      if (!dados) return "";
      marcador = `ecos-importar-imagem-${imagens.length + 1}`;
      imagens.push({ marcador, nome: caminho.split("/").pop() ?? `imagem${imagens.length + 1}.png`, dados });
      imagemPorRel.set(relId, marcador);
    }
    return `![${escMd(alt)}](${marcador})`;
  };

  const runs = (el: Element): string => {
    let s = "";
    for (const c of Array.from(el.children)) {
      if (c.localName === "r") {
        const pr = filho(c, "rPr");
        const b = ligado(filho(pr, "b")), i = ligado(filho(pr, "i")), st = ligado(filho(pr, "strike"));
        const mono = /consolas|courier|mono/i.test(filho(pr, "rFonts")?.getAttributeNS(W, "ascii") ?? "");
        let t = "";
        for (const x of Array.from(c.children)) {
          if (x.localName === "t") t += mono ? x.textContent ?? "" : escMd(x.textContent ?? "");
          else if (x.localName === "tab") t += "\t";
          else if (x.localName === "br" || x.localName === "cr") t += "\n";
          else if (x.localName === "drawing" || x.localName === "pict") {
            const blip = x.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/main", "blip")[0];
            const id = blip?.getAttributeNS(R, "embed") ?? x.getElementsByTagNameNS("urn:schemas-microsoft-com:vml", "imagedata")[0]?.getAttributeNS(R, "id");
            const alt = x.getElementsByTagNameNS("http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing", "docPr")[0]?.getAttribute("descr") ?? "";
            if (id) t += marcadorImagem(id, alt);
          }
        }
        if (!t) continue;
        if (mono && t.trim()) t = `\`${t}\``;
        const [ini, meio, fim] = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!.slice(1);
        let m = meio;
        if (m && !m.startsWith("![")) {
          if (st) m = `~~${m}~~`;
          if (i) m = `*${m}*`;
          if (b) m = `**${m}**`;
        }
        s += ini + m + fim;
      } else if (c.localName === "hyperlink") {
        const id = c.getAttributeNS(R, "id");
        const alvo = id ? rels.get(id)?.alvo : null;
        const rotulo = runs(c);
        s += alvo ? `[${rotulo}](${alvo})` : rotulo;
      } else if (["smartTag", "ins", "fldSimple", "sdt", "sdtContent"].includes(c.localName)) s += runs(c);
    }
    return s.replace(/\*\*\*\*|\*\*(\s*)\*\*/g, "$1");
  };

  const blocos: string[] = [];
  const corpo = filho(new DOMParser().parseFromString(docXml, "application/xml").documentElement, "body");
  const percorrer = (pai: Element) => {
    for (const el of Array.from(pai.children)) {
      if (el.localName === "p") {
        const pr = filho(el, "pPr");
        const conteudo = runs(el).replace(/\n/g, "  \n").trimEnd();
        const nivel = nivelTitulo(val(filho(pr, "pStyle")));
        const num = filho(pr, "numPr");
        if (nivel && conteudo.trim()) blocos.push(`${"#".repeat(Math.min(6, nivel))} ${conteudo.trim()}`);
        else if (num) {
          const ilvl = Number(val(filho(num, "ilvl")) ?? 0);
          const ordenada = numerada(val(filho(num, "numId")) ?? "", ilvl);
          blocos.push(`${"   ".repeat(ilvl)}${ordenada ? "1." : "-"} ${conteudo.trim()}`);
        } else if (/quote/i.test(val(filho(pr, "pStyle")) ?? "") && conteudo.trim()) blocos.push(`> ${conteudo.trim()}`);
        else if (/^\s*[☐☑☒] /.test(conteudo)) blocos.push(conteudo.trim().replace(/^([☐☑☒]) /, (_, c: string) => (c === "☐" ? "- [ ] " : "- [x] ")));
        else blocos.push(conteudo);
      } else if (el.localName === "tbl") {
        const linhas = filhos(el, "tr").map((tr) => filhos(tr, "tc").map((tc) => filhos(tc, "p").map((p) => runs(p).trim()).filter(Boolean).join("<br>").replace(/\|/g, "\\|")));
        if (!linhas.length) continue;
        const cols = Math.max(...linhas.map((l) => l.length));
        const linha = (l: string[]) => `| ${Array.from({ length: cols }, (_, i) => l[i] ?? "").join(" | ")} |`;
        blocos.push([linha(linhas[0]), `|${" --- |".repeat(cols)}`, ...linhas.slice(1).map(linha)].join("\n"));
      } else if (el.localName === "sdt") percorrer(filho(el, "sdtContent") ?? el);
    }
  };
  if (corpo) percorrer(corpo);

  // junta itens de lista consecutivos e separa o resto com linha em branco
  let md = "";
  const tipoLista = (b: string | undefined) => /^\s*- /.test(b ?? "") ? "-" : /^\s*1\. /.test(b ?? "") ? "1" : "";
  blocos.forEach((b, i) => {
    const t = tipoLista(b);
    md += i === 0 ? b : t && t === tipoLista(blocos[i - 1]) ? `\n${b}` : `\n\n${b}`;
  });
  return { markdown: md.replace(/\n{3,}/g, "\n\n").trim() + "\n", imagens };
}

const TIPO_IMAGEM: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp", svg: "image/svg+xml", emf: "image/emf", wmf: "image/wmf" };

/** Importa um .md ou .docx como nota nova. Devolve o id. */
export async function importarArquivoComoNota(arquivo: File, pasta?: string): Promise<string> {
  if (/\.docx$/i.test(arquivo.name)) {
    if (arquivo.size > LIMITE_DOCX) throw new Error("maior que 40 MB");
    const { markdown, imagens } = await docxParaMarkdown(await arquivo.arrayBuffer());
    const nome = arquivo.name.replace(/\.docx$/i, ".md");
    const nota = await notas.importar({ nome, conteudo: markdown, pasta });
    if (!imagens.length) return nota.id;
    let corpo = markdown;
    for (const im of imagens) {
      const ext = im.nome.split(".").pop()?.toLowerCase() ?? "png";
      try {
        const r = await notas.anexos.enviar(nota.id, new File([im.dados as Uint8Array<ArrayBuffer>], im.nome, { type: TIPO_IMAGEM[ext] ?? "application/octet-stream" }));
        corpo = corpo.split(`(${im.marcador})`).join(`(${r.url_relativa})`);
      } catch {
        corpo = corpo.split(`(${im.marcador})`).join("(imagem-nao-importada)");
      }
    }
    // o envio de anexo acrescenta um link no fim; o corpo final já tem cada imagem no seu lugar
    await notas.atualizar(nota.id, { corpo });
    return nota.id;
  }
  if (arquivo.size > LIMITE_MD) throw new Error("maior que 2 MB");
  return (await notas.importar({ nome: arquivo.name, conteudo: await arquivo.text(), pasta })).id;
}
