import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Lock, ShieldHalf, LayoutDashboard, ArrowLeftRight, CalendarDays, FileSpreadsheet, Settings2, CloudOff, RefreshCw } from "lucide-react";
import { vault, auth, financeiro, ApiError, type CategoriaApi } from "@/lib/api";
import { VaultLockScreen } from "./VaultLockScreen";
import { TransactionDetailScreen } from "./TransactionDetailScreen";
import { VaultDashboard, type Filtro } from "./VaultDashboard";
import { VaultTransactions } from "./VaultTransactions";
import { VaultWorkflow } from "./VaultWorkflow";
import { VaultCsv } from "./VaultCsv";
import { VaultSettings } from "./VaultSettings";
import { PeriodPicker } from "./nexus/PeriodPicker";
import { defaultPeriod, periodRange, type Period } from "./nexus/period";
import { useIsDesktop } from "@/lib/use-viewport";
import { useAbrirDocumento } from "@/lib/documento-popup";
import { useRefreshBus } from "@/lib/refresh-bus";
import { useAppUI } from "@/lib/ui-context";
import { useMinhasEquipes } from "@/lib/use-minhas-equipes";
import { Fab } from "@/components/layout/Fab";
import { CreateFlow } from "@/screens/Create/CreateFlow";
import type { Painel, Periodo } from "./types";
type Fase = "carregando" | "desativado" | "ativar" | "bloqueado" | "aberto";
export function VaultEntry() {
    const location = useLocation();
    const navigate = useNavigate();
    const desktop = useIsDesktop();
    useEffect(() => {
        if (desktop) return; const path = location.pathname; navigate("/feed", { replace: true }); window.dispatchEvent(new CustomEvent("ecos:abrir-cofre", { detail: path })); }, []);
    // No desktop o Cofre é uma aba como as outras: vive dentro do roteador da aba, sem tomar a janela.
    if (desktop) return <VaultScreen embedded voltar={() => navigate("/feed")}/>;
    return <p role="status">Abrindo Cofre…</p>;
}
/** Rota do lançamento: no desktop é a própria tela de detalhe (cabe numa janela flutuante); no mobile segue o fluxo em tela cheia do Cofre. */
export function VaultTransacaoEntry() {
    const desktop = useIsDesktop();
    return desktop ? <div className="cofre-app cofre-embedded"><div className="p-4"><TransactionDetailScreen/></div></div> : <VaultEntry/>;
}
/** O Cofre é por equipe: trocar de espaço no seletor do Ecos reabre o Cofre daquele espaço (estado e senha próprios). */
export function VaultScreen(props: {
    voltar: () => void;
    embedded?: boolean;
}) {
    const { espacoAtivo } = useAppUI();
    return <VaultScreenDoEspaco key={espacoAtivo} {...props}/>;
}
function VaultScreenDoEspaco({ voltar, embedded = false }: {
    voltar: () => void;
    embedded?: boolean;
}) {
    const { espacoAtivo } = useAppUI();
    const { equipes } = useMinhasEquipes();
    const nomeEquipe = espacoAtivo.startsWith("equipe:") ? equipes.find(e => e.id === espacoAtivo.slice(7))?.nome ?? "Equipe" : undefined;
    const [fase, setFase] = useState<Fase>("carregando");
    const [erro, setErro] = useState("");
    const [versao, setVersao] = useState(0);
    useEffect(() => {
        let vivo = true;
        let geracao = 0;
        const bloquear = () => { geracao++; setFase("bloqueado"); };
        async function verificar(inicial = false) {
            const atual = geracao;
            try {
                const perfil = await auth.perfil();
                if (!vivo || atual !== geracao)
                    return;
                if (!perfil.cofre_ativado) {
                    setFase("desativado");
                    return;
                }
                const cfg = await vault.config();
                if (!vivo || atual !== geracao)
                    return;
                if (!cfg.cofre_ativado)
                    setFase("ativar");
                else if (!cfg.destrancado)
                    setFase("bloqueado");
                else if (inicial)
                    setFase("aberto");
            }
            catch (e) {
                if (vivo && atual === geracao) {
                    setErro((e as Error).message);
                    setFase("bloqueado");
                }
            }
        }
        window.addEventListener("ecos:cofre-bloqueado", bloquear);
        const focus = () => void verificar();
        window.addEventListener("focus", focus);
        const timer = window.setInterval(focus, 30000);
        void verificar(true);
        return () => { vivo = false; clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("ecos:cofre-bloqueado", bloquear); };
    }, [versao]);
    async function bloquear() { setFase("bloqueado"); try {
        await vault.bloquear();
    }
    catch (e) {
        setErro(`Dados ocultados neste dispositivo. Não foi possível confirmar o bloqueio no servidor: ${(e as Error).message}`);
    } }
    return <div className={embedded ? "cofre-app cofre-embedded" : "cofre-app"}>
        <header className="cofre-header">
            <div className="cofre-brand"><span className="cofre-brand-icon"><ShieldHalf size={21}/></span><span>Cofre<small>{nomeEquipe ? `EQUIPE · ${nomeEquipe.toUpperCase()}` : "ECOS · FINANÇAS"}</small></span></div>
            <div className="cofre-header-actions">{!embedded&&<button title="Voltar ao Ecos" aria-label="Voltar ao Ecos" onClick={voltar}><ArrowLeft size={17}/><span>Voltar ao Ecos</span></button>}{fase === "aberto" && <button title="Bloquear Cofre" aria-label="Bloquear" onClick={() => void bloquear()}><Lock size={16}/><span>Bloquear</span></button>}</div>
        </header>
        {erro && <p role="alert" className="cofre-notice">{erro}</p>}
        {fase === "aberto" ? <><VaultWorkspace/>{!embedded&&<><Fab/><CreateFlow/></>}</> : fase === "carregando" ? <p className="p-8" role="status">Verificando Cofre…</p> : fase === "desativado" ? <p className="p-8">Ative o módulo Cofre nas configurações do Ecos e no servidor.</p> : <VaultLockScreen equipe={nomeEquipe} primeiraVez={fase === "ativar"} onSubmeter={async senha=>{if(fase === "ativar")await vault.ativar(senha);else await vault.desbloquear(senha);setErro("");setVersao(v=>v+1);}}/>}
    </div>;
}

const menus = [
    {id:"painel",nome:"Painel",curto:"Painel",icone:LayoutDashboard,descricao:"Uma visão clara das suas finanças."},
    {id:"lancamentos",nome:"Lançamentos",curto:"Extrato",icone:ArrowLeftRight,descricao:"Movimentações, conciliação e histórico."},
    {id:"fluxo",nome:"Fluxo financeiro",curto:"Fluxo",icone:CalendarDays,descricao:"Organize o que entra e o que sai."},
    {id:"csv",nome:"Importar / exportar",curto:"CSV",icone:FileSpreadsheet,descricao:"Seus dados, com você."},
    {id:"configuracoes",nome:"Configurações",curto:"Ajustes",icone:Settings2,descricao:"Contas, categorias e recorrências."},
];
export function VaultWorkspace() {
    const navigate=useNavigate(); const location=useLocation();const {versao:externa,notificar}=useRefreshBus();const {setDiaCofre}=useAppUI();
    const secao=location.pathname.split("/")[2]||"painel";
    const menu=menus.find(m=>m.id===secao);
    const [period,setPeriod]=useState<Period>(defaultPeriod);
    const range=periodRange(period);const periodo:Periodo={data_de:range.from,data_ate:range.to};
    const [painel,setPainel]=useState<Painel|null>(null);
    const [categorias,setCategorias]=useState<CategoriaApi[]>([]);
    const [erro,setErro]=useState<{texto:string;incompativel:boolean}|null>(null);
    const [filtro,setFiltro]=useState<Filtro>({});const [versao,setVersao]=useState(0);
    const valido=!!periodo.data_de&&!!periodo.data_ate&&periodo.data_de<=periodo.data_ate;
    useEffect(()=>{let vivo=true;vault.categorias.listar().then(c=>{if(vivo)setCategorias(c);}).catch(()=>{/* A tela de cada recurso apresenta sua falha. */});return()=>{vivo=false;};},[versao,externa]);
    useEffect(()=>{
        let vivo=true;setPainel(null);setErro(null);
        if(!valido||secao!=="painel")return;
        financeiro.painel(periodo).then(p=>{if(vivo)setPainel(p);}).catch(e=>{if(vivo)setErro({texto:e.message,incompativel:e instanceof ApiError&&e.status===404});});
        return()=>{vivo=false;};
    },[periodo.data_de,periodo.data_ate,valido,secao,versao,externa]);
    useEffect(()=>{if(secao!=="fluxo")setDiaCofre(null);return()=>setDiaCofre(null);},[secao,setDiaCofre]);
    function atualizar(){setVersao(v=>v+1);notificar();}
    const abrirDocumento=useAbrirDocumento();
    // No desktop o lançamento abre numa janela flutuante, como Tarefa e Nota; no mobile navega para a tela de detalhe.
    function abrir(id:string){abrirDocumento(`/cofre/transacao/${id}`);}
    return <div className="cofre-workspace">
        <nav aria-label="Navegação do Cofre" className="cofre-nav"><p className="cofre-nav-label">SEU COFRE</p>{menus.map(({id,nome,curto,icone:Icon})=><button key={id} aria-label={nome} title={nome} aria-current={secao===id?"page":undefined} onClick={()=>{setFiltro({});navigate(`/cofre/${id}`);}}><Icon size={18}/><span className="cofre-nav-desktop">{nome}</span><span className="cofre-nav-mobile">{curto}</span></button>)}<div className="cofre-nav-footer"><ShieldHalf size={16}/><span>Seu espaço financeiro<br/><small>Privado e independente</small></span></div></nav>
        <main className="cofre-main"><div className="cofre-content">
            {menu&&<div className="cofre-page-heading"><div><p className="cofre-eyebrow">FINANÇAS PESSOAIS</p><h1>{menu.nome}</h1><p className="cofre-subtitle">{menu.descricao}</p></div><div className="cofre-page-actions">{["painel","lancamentos","csv"].includes(secao)&&<PeriodPicker value={period} onChange={p=>{setPeriod(p);setFiltro({});}}/>}</div></div>}
            {erro&&<div role="alert" className="cofre-error-card"><span className="cofre-error-icon"><CloudOff size={25}/></span><h2>{erro.incompativel?"O painel precisa de uma atualização":"Não foi possível carregar o painel"}</h2><p>{erro.incompativel?"O serviço do Cofre em execução ainda não oferece este painel. Seus lançamentos continuam disponíveis; atualize o Cofre no servidor para habilitar os gráficos.":erro.texto}</p><div><button className="cofre-solid" onClick={()=>setVersao(v=>v+1)}><RefreshCw size={15}/>Tentar novamente</button><button className="cofre-secondary" onClick={()=>navigate("/cofre/lancamentos")}>Abrir lançamentos <ArrowRight size={15}/></button></div></div>}
            {!valido&&<p role="alert">Selecione um período válido.</p>}
            {secao==="painel"&&(painel?<VaultDashboard painel={painel} categorias={categorias} periodo={periodo} abrir={abrir} onFluxo={()=>navigate("/cofre/fluxo")} drill={f=>{setFiltro(f);navigate("/cofre/lancamentos");}}/>:!erro&&<div className="cofre-loading" role="status"><RefreshCw size={20}/><span>Preparando seu painel…</span><div className="cofre-skeletons">{[1,2,3,4].map(i=><div key={i}/>)}</div></div>)}
            <div className="cofre-panel">
            {secao==="lancamentos"&&valido&&<>{Object.keys(filtro).length>0&&<button className="cofre-secondary" onClick={()=>setFiltro({})}>Limpar filtro do gráfico</button>}<VaultTransactions recarregar={externa} periodo={periodo} filtro={filtro} categorias={categorias} abrir={abrir} atualizar={atualizar}/></>}
            {secao==="fluxo"&&<VaultWorkflow recarregar={externa} atualizar={atualizar}/>}
            {secao==="csv"&&valido&&<VaultCsv periodo={periodo} atualizar={atualizar}/>}
            {secao==="configuracoes"&&<VaultSettings atualizar={atualizar}/>}
            {secao==="transacao"&&<TransactionDetailScreen/>}
            </div>
        </div></main>
    </div>;
}
