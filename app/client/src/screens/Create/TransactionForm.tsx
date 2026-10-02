import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import * as Icons from "lucide-react";
import { Check, ChevronDown, Coins, Plus, Trash2, X } from "lucide-react";
import { SegmentedSlide } from "@/components/common/SegmentedSlide";
import { DatePicker } from "@/components/common/DatePicker";
import { formatMoeda } from "@/lib/format";
import { vault, FORMAS_PAGAMENTO, type CategoriaApi, type ContaApi, type FormaPagamento } from "@/lib/api";
import type { CapturaDraft, SetDraft } from "./CreateFlow";

interface Props { draft:CapturaDraft; setDraft:SetDraft; onSalvar:()=>void; onFechar:()=>void; salvando?:boolean; eyebrow?:string; titulo?:string; rotuloSalvar?:string; erro?:string|null; onExcluir?:()=>void; /** Nome de quem lançou (só em Cofre de equipe com mais de uma pessoa). Somente leitura. */ criadoPor?:string; /** Container de anexos, logo abaixo de Observações (o editor passa os anexos do lançamento; a criação, os pendentes). */ anexos?:React.ReactNode; }
const LABEL_FORMA:Record<FormaPagamento,string>={pix:"Pix",pix_automatico:"Pix Automático",ted:"TED",cartao:"Cartão",dinheiro:"Dinheiro",boleto:"Boleto",outro:"Outro"};

export function TransactionForm({draft,setDraft,onSalvar,onFechar,salvando,eyebrow="NOVO REGISTRO",titulo="Novo lançamento",rotuloSalvar="Salvar lançamento",erro,onExcluir,criadoPor,anexos}:Props) {
  const [confirmandoExcluir,setConfirmandoExcluir]=useState(false);
  const [categorias,setCategorias]=useState<CategoriaApi[]>([]),[contas,setContas]=useState<ContaApi[]>([]);
  useEffect(()=>{vault.categorias.listar().then(setCategorias).catch(()=>setCategorias([]));vault.contas.listar().then(lista=>{setContas(lista);const padrao=lista.find(c=>c.padrao)??lista[0];if(padrao&&!draft.contaId&&!onExcluir)setDraft(d=>({...d,contaId:padrao.id}));}).catch(()=>setContas([]));},[]); // eslint-disable-line react-hooks/exhaustive-deps
  const categoriasVisiveis=categorias.filter(c=>c.tipo==="ambos"||c.tipo===draft.tipoTransacao);
  function digitarValor(valor:string){const digitos=valor.replace(/\D/g,"").replace(/^0+/,"").slice(0,9);setDraft(d=>({...d,valorCentavos:Number(digitos||0)}));}
  function mudarData(data:string){setDraft(d=>({...d,dataTransacao:data}));}
  const [lancando,setLancando]=useState(false),pode=!!draft.texto.trim()&&draft.valorCentavos>0;
  function lancar(){if(lancando||salvando||!pode)return;if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){onSalvar();return;}setLancando(true);window.setTimeout(()=>{onSalvar();setLancando(false);},780);}
  const valor=draft.valorCentavos>0?`${draft.tipoTransacao==="entrada"?"+":"−"}${formatMoeda(draft.valorCentavos)}`:"";
  async function adicionarCategoria(nome:string){const criada=await vault.categorias.criar({nome,tipo:draft.tipoTransacao,cor:draft.tipoTransacao==="entrada"?"#86d7ad":"#f29a9f",icone:draft.tipoTransacao==="entrada"?"TrendingUp":"ShoppingBag"});const lista=await vault.categorias.listar();setCategorias(lista);setDraft(d=>({...d,categoriaId:criada.id}));}
  return <form className="cofre-launch-form" onSubmit={e=>{e.preventDefault();lancar();}}>
    <header className="cofre-launch-header" data-window-drag-handle><div><p>{eyebrow}</p><h2>{titulo}</h2></div><div className="cofre-launch-header-actions">{onExcluir&&<button type="button" aria-label="Apagar" title="Apagar" onClick={()=>setConfirmandoExcluir(true)}><Trash2 size={15}/></button>}<button type="button" aria-label="Fechar" title="Fechar" onClick={onFechar}><X size={16}/></button></div></header>
    <div className="cofre-launch-body">
      {criadoPor&&<p className="cofre-launch-author" aria-label="Criado por">Criado por <b>{criadoPor}</b></p>}
      {erro&&<p className="cofre-launch-alert" role="alert">{erro}</p>}
      {confirmandoExcluir&&onExcluir&&<div className="cofre-launch-alert" role="alert"><p>Apagar este lançamento? Essa ação não pode ser desfeita.</p><div><button type="button" onClick={()=>setConfirmandoExcluir(false)}>Cancelar</button><button type="button" disabled={salvando} onClick={onExcluir}>{salvando?"Apagando…":"Apagar"}</button></div></div>}
      <SegmentedSlide className="cofre-launch-slide" ariaLabel="Tipo do lançamento" tamanho="lg" value={draft.tipoTransacao} onChange={v=>setDraft(d=>({...d,tipoTransacao:v,categoriaId:null}))} opcoes={[{value:"saida",label:"Despesa",cor:"ecos-error"},{value:"entrada",label:"Receita",cor:"ecos-success"}]}/>
      <SegmentedSlide className="cofre-launch-slide" ariaLabel="Situação do lançamento" tamanho="lg" value={draft.statusTransacao} onChange={v=>setDraft(d=>({...d,statusTransacao:v}))} opcoes={[{value:"efetivada",label:"Efetivada",cor:"cofre-blue"},{value:"pendente",label:"Prevista",cor:"cofre-pink"}]}/>
      {valor&&<strong className="cofre-launch-preview" data-tipo={draft.tipoTransacao}>{valor}</strong>}
      <div className="cofre-launch-fields">
        <div className="cofre-launch-grid"><Campo label="Valor"><input autoFocus inputMode="numeric" value={formatMoeda(draft.valorCentavos)} onChange={e=>digitarValor(e.target.value)} placeholder="R$ 0,00"/></Campo><Campo label="Data" className="cofre-launch-date"><DatePicker value={draft.dataTransacao} onChange={mudarData}/></Campo></div>
        <Campo label="Descrição"><input value={draft.texto} onChange={e=>setDraft(d=>({...d,texto:e.target.value}))} placeholder="Ex.: Mercado Extra"/></Campo>
        <Campo label="Pagador / Recebedor"><input value={draft.beneficiarioNome} onChange={e=>setDraft(d=>({...d,beneficiarioNome:e.target.value}))} placeholder="Ex.: Mercado Extra Ltda"/></Campo>
        <Campo label="Categoria"><MenuSelecao value={draft.categoriaId??""} placeholder="Sem categoria" options={categoriasVisiveis.map(c=>({value:c.id,label:c.nome,cor:c.cor,icone:c.icone}))} onChange={value=>setDraft(d=>({...d,categoriaId:value||null}))} onAdd={adicionarCategoria}/></Campo>
        <div className="cofre-launch-grid"><Campo label="Conta"><MenuSelecao value={draft.contaId??""} placeholder="Sem conta" options={contas.map(c=>({value:c.id,label:c.nome,cor:c.cor}))} onChange={value=>setDraft(d=>({...d,contaId:value||null}))}/></Campo><Campo label="Forma de pagamento"><MenuSelecao value={draft.formaPagamento??""} placeholder="Não informada" options={FORMAS_PAGAMENTO.map(f=>({value:f,label:LABEL_FORMA[f]}))} onChange={value=>setDraft(d=>({...d,formaPagamento:(value||null) as FormaPagamento|null}))}/></Campo></div>
        <Campo label="Observações"><textarea rows={3} value={draft.observacoesTransacao} onChange={e=>setDraft(d=>({...d,observacoesTransacao:e.target.value}))} placeholder="Opcional"/></Campo>
        {anexos}
      </div>
    </div>
    <footer className="cofre-launch-footer"><button data-tipo={draft.tipoTransacao} data-lancando={lancando} disabled={salvando||!pode||lancando}><span className="cofre-launch-label">{salvando?"Salvando…":rotuloSalvar}</span>{lancando&&<i className="cofre-launch-coin" aria-hidden="true"><b><Coins size={18} strokeWidth={2.2}/></b></i>}</button></footer>
  </form>;
}
function Campo({label,children,className}:{label:string;children:ReactNode;className?:string}){return <div className={`cofre-launch-field ${className??""}`}><span>{label}</span>{children}</div>;}
function MenuSelecao({value,placeholder,options,onChange,onAdd}:{value:string;placeholder:string;options:{value:string;label:string;cor?:string|null;icone?:string|null}[];onChange:(value:string)=>void;onAdd?:(nome:string)=>Promise<void>}){
  const [aberto,setAberto]=useState(false),[adicionando,setAdicionando]=useState(false),[nome,setNome]=useState(""),[salvando,setSalvando]=useState(false),ref=useRef<HTMLDivElement>(null),listaRef=useRef<HTMLDivElement>(null),[pos,setPos]=useState<{acima:boolean;max:number}>({acima:false,max:190});const atual=options.find(o=>o.value===value);const IconeAtual=icone(atual?.icone);
  useLayoutEffect(()=>{if(!aberto||!ref.current||!listaRef.current)return;const corpo=ref.current.closest(".cofre-launch-body")??document.body,c=corpo.getBoundingClientRect(),b=ref.current.getBoundingClientRect(),abaixo=c.bottom-b.bottom-12,acima=b.top-c.top-12,preciso=Math.min(listaRef.current.scrollHeight,190)+6,sobe=preciso>abaixo&&acima>abaixo;setPos({acima:sobe,max:Math.max(96,Math.min(190,sobe?acima:abaixo))});},[aberto,adicionando]);
  useEffect(()=>{if(!aberto)return;const fechar=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setAberto(false);};document.addEventListener("pointerdown",fechar);return()=>document.removeEventListener("pointerdown",fechar);},[aberto]);
  async function confirmarCategoria(){if(!onAdd||!nome.trim())return;setSalvando(true);try{await onAdd(nome.trim());setAberto(false);setNome("");setAdicionando(false);}finally{setSalvando(false);}}
  return <div className="cofre-launch-select" ref={ref}><button type="button" aria-haspopup="listbox" aria-expanded={aberto} onClick={()=>setAberto(v=>!v)}>{IconeAtual?<IconeAtual size={14} style={{color:atual?.cor??undefined}}/>:atual?.cor&&<i style={{background:atual.cor}}/>}<span>{atual?.label??placeholder}</span><ChevronDown size={14}/></button>{aberto&&<div className="cofre-launch-options" data-acima={pos.acima} style={{maxHeight:pos.max}} ref={listaRef} role="listbox"><button type="button" role="option" aria-selected={!value} onClick={()=>{onChange("");setAberto(false);}}><span>{placeholder}</span>{!value&&<Check size={13}/>}</button>{options.map(o=>{const Icone=icone(o.icone);return <button type="button" role="option" aria-selected={o.value===value} key={o.value} onClick={()=>{onChange(o.value);setAberto(false);}}>{Icone?<Icone size={14} style={{color:o.cor??undefined}}/>:o.cor&&<i style={{background:o.cor}}/>}<span>{o.label}</span>{o.value===value&&<Check size={13}/>}</button>;})}{onAdd&&<div className="cofre-launch-add-category">{adicionando?<div className="cofre-launch-add-form"><input autoFocus value={nome} onChange={e=>setNome(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void confirmarCategoria();}}} placeholder="Nome da categoria"/><button type="button" onClick={()=>void confirmarCategoria()} disabled={salvando||!nome.trim()}>{salvando?"…":<Check size={14}/>}</button></div>:<button type="button" onClick={()=>setAdicionando(true)}><Plus size={14}/><span>Adicionar categoria</span></button>}</div>}</div>}</div>;
}
function icone(nome?:string|null){return nome?(Icons as unknown as Record<string,Icons.LucideIcon>)[nome]??Icons.Circle:null;}
