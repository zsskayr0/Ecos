// Fixture de desenvolvimento: todas as chamadas são interceptadas, nenhum dado real é acessado.
import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { RefreshProvider } from "../src/lib/refresh-bus";
import { VaultScreen } from "../src/screens/Vault/VaultScreen";
import "../src/styles/global.css";
const categories=[{id:"mercado",nome:"Alimentação",cor:"#94b3aa",tipo:"saida"},{id:"casa",nome:"Moradia",cor:"#8c9fb9",tipo:"saida"},{id:"lazer",nome:"Lazer",cor:"#c7a788",tipo:"saida"}];
const recent=[{id:"t1",descricao:"Compras do mês",tipo:"saida",valor_centavos:48590,categoria_id:"mercado",forma_pagamento:"pix"},{id:"t2",descricao:"Aluguel",tipo:"saida",valor_centavos:180000,categoria_id:"casa",forma_pagamento:"ted"},{id:"t3",descricao:"Salário",tipo:"entrada",valor_centavos:680000}].map((t,i)=>({...t,data:`2026-09-${10+i}`,status:"efetivada",conciliada:true,moeda:"BRL",espaco:"pessoal",criado_em:"2026-09-01",atualizado_em:"2026-09-01"}));
const panel={saldo:1845090,receitas:865000,despesas:324910,taxa_economia:62.4,mensal:false,series:Array.from({length:30},(_,i)=>({data:`2026-09-${String(i+1).padStart(2,"0")}`,receitas:i===4?680000:i===19?185000:0,receitas_confirmadas:i===4?680000:i===19?185000:0,despesas:[0,8000,2500,14000,0,7500,180000,0,4200,14000,0,6000,10000,0,1500][i%15],despesas_confirmadas:[0,8000,2500,14000,0,7500,180000,0,4200,14000,0,6000,10000,0,1500][i%15]})),categorias:[{chave:"casa",valor:180000},{chave:"mercado",valor:98910},{chave:"lazer",valor:46000}],pagamentos:[{chave:"pix",valor:185000},{chave:"cartao",valor:98910},{chave:"ted",valor:41000}],maiores_entradas:[{id:"t3",descricao:"Salário",valor:680000},{id:"t4",descricao:"Projeto freelance",valor:185000}],maiores_saidas:[{id:"t2",descricao:"Aluguel",valor:180000},{id:"t1",descricao:"Compras do mês",valor:48590},{id:"t5",descricao:"Restaurante",valor:12800}],previsoes:[{recorrencia_id:"r1",data:"2026-09-30",tipo:"saida",descricao:"Internet",valor_centavos:12990},{recorrencia_id:"r2",data:"2026-09-30",tipo:"entrada",descricao:"Projeto em andamento",valor_centavos:85000}]};
let locked=false;
window.fetch=async (input,init)=>{
 const url=String(input); const path=new URL(url,location.origin).pathname;
 let value:unknown;
 if(path.endsWith("/me")) value={cofre_ativado:true};
 else if(path.endsWith("/vault/config"))value={cofre_ativado:true,destrancado:!locked,saldos_por_conta:[]};
 else if(path.endsWith("/vault/bloquear")){locked=true;value={ok:true};}
 else if(path.endsWith("/vault/painel")){if(new URLSearchParams(location.search).has("erro"))return new Response(JSON.stringify({error:"NOT_FOUND",message:"Rota ausente"}),{status:404,headers:{"content-type":"application/json"}});value=panel;}
 else if(path.endsWith("/vault/categorias"))value=categories;
 else if(path.endsWith("/vault/transacoes"))value={items:recent,next_cursor:null};
 else if(path.includes("/vault/transacoes/"))value=recent.find(t=>path.endsWith(t.id));
 else if(path.endsWith("/vault/pendencias"))value=[{id:"p1",descricao:"Reembolso da viagem",tipo:"entrada",valor_centavos:38000}];
 else if(path.endsWith("/vault/fluxo/ocorrencias"))value=panel.previsoes;
 else if(path.endsWith("/vault/recorrencias"))value=[{id:"r1",descricao:"Internet",tipo:"saida",valor_centavos:12990,frequencia:"mensal",ativa:true}];
 else if(path.endsWith("/vault/contas"))value=[{id:"c1",nome:"Conta principal"}];
 else throw new Error(`Ação não configurada nesta fixture: ${init?.method??"GET"} ${path}`);
 return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
};
ReactDOM.createRoot(document.getElementById("root")!).render(<MemoryRouter initialEntries={["/cofre"]}><RefreshProvider><Routes><Route path="*" element={<VaultScreen voltar={()=>location.assign("/")}/>}/></Routes></RefreshProvider></MemoryRouter>);
