// Fixture de desenvolvimento da tela de Contas: todas as chamadas são interceptadas, nenhum dado real é acessado.
import ReactDOM from "react-dom/client";
import { useState } from "react";

import { VaultAccounts } from "../src/screens/Vault/VaultAccounts";
import { defaultPeriod, type Period } from "../src/screens/Vault/nexus/period";
import "../src/styles/global.css";
const categories=[{id:"mercado",nome:"Alimentação",cor:"#86d7ad",tipo:"saida"},{id:"casa",nome:"Moradia",cor:"#93c5fd",tipo:"saida"},{id:"lazer",nome:"Lazer",cor:"#fdba74",tipo:"saida"},{id:"saude",nome:"Saúde",cor:"#f9a8d4",tipo:"saida"}];
const contas=[
 {id:"c1",nome:"Nubank",banco:"Nubank",codigo_banco:"260",agencia:"0001",numero_conta:"1234567-8",cor:"#8a05be",padrao:true,espaco:"pessoal",tipo:"corrente",saldo_inicial_centavos:250000},
 {id:"c2",nome:"Itaú — poupança",banco:"Itaú",codigo_banco:"341",agencia:"4321",numero_conta:"55555-0",cor:"#ec7000",padrao:false,espaco:"pessoal",tipo:"poupanca",saldo_inicial_centavos:1500000},
 {id:"c3",nome:"Carteira",banco:null,codigo_banco:null,agencia:null,numero_conta:null,cor:"#94a3b8",padrao:false,espaco:"pessoal",tipo:"carteira",saldo_inicial_centavos:20000},
 {id:"c4",nome:"Banco do Brasil",banco:"Banco do Brasil",codigo_banco:"001",agencia:"1234-5",numero_conta:"98765-4",cor:"#f9d71c",padrao:false,espaco:"pessoal",tipo:"corrente",saldo_inicial_centavos:-45000},
];
const dias=[1,3,5,7,8,10,12,14,15,17,19,21,23,25,27,28];
const txs:Record<string,unknown>[]=[];
let n=0;
for(const [ci,c] of contas.entries()){
  for(const d of dias){ if((d+ci)%3===0&&ci>1)continue; const saida=(d+ci)%4!==0; const cat=categories[(d+ci)%4]!.id;
    txs.push({id:`t${n++}`,tipo:saida?"saida":"entrada",valor_centavos:saida?(1500+((d*977+ci*313)%38000)):(ci===0&&d===5?680000:20000+((d*131)%50000)),moeda:"BRL",data:`2026-09-${String(d).padStart(2,"0")}`,descricao:saida?["Mercado","Aluguel","Cinema","Farmácia","Restaurante"][(d+ci)%5]:"Recebimento",categoria_id:saida?cat:null,conta_id:c.id,beneficiario_id:null,forma_pagamento:["pix","cartao","ted","boleto"][(d+ci)%4],status:d>25&&ci===0?"pendente":"efetivada",observacoes:null,origem:"manual",espaco:"pessoal",criado_em:"",atualizado_em:""});}
}
const saldoDe=(id:string)=>{const c=contas.find(x=>x.id===id)!;return c.saldo_inicial_centavos+txs.filter(t=>t.conta_id===id&&t.status==="efetivada").reduce((s,t)=>s+(t.tipo==="entrada"?1:-1)*(t.valor_centavos as number),0);};

window.fetch=async (input,init)=>{
 const path=new URL(String(input),location.origin).pathname;
 let value:unknown;
 if(path.endsWith("/me")) value={cofre_ativado:true};
 else if(path.endsWith("/vault/config"))value={cofre_ativado:true,destrancado:true,saldos_por_conta:contas.map(c=>({conta_id:c.id,nome:c.nome,saldo_centavos:saldoDe(c.id)}))};
 else if(path.endsWith("/vault/categorias"))value=categories;
 else if(path.endsWith("/vault/contas")&&(init?.method??"GET")==="GET")value=contas;
 else if(path.endsWith("/vault/contas"))value={id:"novo"};
 else if(/\/vault\/contas\/[^/]+\/uso$/.test(path))value={transacoes:12,recorrencias:1,amostra:txs.slice(0,5).map(t=>({id:t.id,data:t.data,descricao:t.descricao,tipo:t.tipo,valor_centavos:t.valor_centavos}))};
 else if(path.endsWith("/vault/transacoes"))value={items:txs,next_cursor:null};
 else if(path.endsWith("/vault/recorrencias"))value=[{id:"r1",descricao:"Internet",tipo:"saida",valor_centavos:12990,frequencia:"mensal",ativa:true,conta_id:"c1"}];
 else throw new Error(`Ação não configurada nesta fixture: ${init?.method??"GET"} ${path}`);
 return new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}});
};
function Pagina(){
 const [period,setPeriod]=useState<Period>(()=>({kind:"month",year:2026,month:9}));void defaultPeriod;
 return <div className="cofre-app cofre-embedded"><div className="cofre-workspace"><aside className="cofre-nav"/><main className="cofre-main"><div className="cofre-content"><div className="cofre-panel"><VaultAccounts period={period} onPeriodChange={setPeriod} categorias={categories as never} atualizar={()=>{}}/></div></div></main></div></div>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Pagina/>);
