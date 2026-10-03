import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Lock, Moon, PanelLeftClose, PanelLeftOpen, Sun, ShieldHalf, Crown, LayoutDashboard, ArrowLeftRight, CalendarDays, Settings2, CloudOff, RefreshCw, Repeat2, Landmark, Tags, Users, ChevronUp, Plus, Ellipsis, Paperclip } from "lucide-react";
import { vault, auth, financeiro, ApiError, type CategoriaApi } from "@/lib/api";
import { VaultLockScreen } from "./VaultLockScreen";
import { TransactionDetailScreen } from "./TransactionDetailScreen";
import { VaultDashboard, type Filtro } from "./VaultDashboard";
import { VaultTransactions } from "./VaultTransactions";
import { VaultWorkflow } from "./VaultWorkflow";
import { VaultComprovantes } from "./VaultComprovantes";
import { VaultConfigPanel, type AbaConfigCofre } from "./VaultConfigPanel";
import { VaultRecorrencias } from "./VaultRecorrencias";
import { VaultCategories } from "./VaultCategories";
import { VaultAccounts } from "./VaultAccounts";
import { VaultSacados } from "./VaultSacados";
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
import { Avatar } from "@/components/common/Avatar";
import { nomeExibicao, useAuth } from "@/lib/auth-context";
import { useFotoPerfil } from "@/lib/profile-avatar";
import { corDaEquipe } from "@/lib/team-color";
import { useAvatarEquipe } from "@/lib/team-avatar";
import { useComprovantesEsperando } from "@/lib/fila-comprovantes";
import { bloqueioManual, chaveDoCofre, esquecerSenha, lembrarSenha, lembrarSenhaSuportado, lerSenhaLembrada, limparBloqueioManual, marcarBloqueioManual } from "@/lib/cofre-lembrado";
type Fase = "carregando" | "desativado" | "ativar" | "bloqueado" | "aberto";
function saudacao(nome:string) {
    const agora=new Date(), hora=agora.getHours(), dia=agora.getDay();
    let titulo:string, frases:string[], noite=false;
    if(hora<5){titulo="Boa madrugada";frases=["As contas não dormem, né?","Silêncio total — boa hora pra revisar o extrato com calma.","Trabalhando até tarde. Bora fechar as contas e descansar."];noite=true;}
    else if(hora<9){titulo="Bom dia";frases=["Café na mão, saldo em dia — vamos nessa.","Começando o dia de olho nas finanças. Respeito.","Hora boa pra revisar o que entrou e o que saiu."];}
    else if(hora<12){titulo="Bom dia";frases=["Hora boa pra colocar tudo em ordem.","Vamos ver como estão as contas hoje?"];}
    else if(hora<14){titulo="Boa tarde";frases=["Pausa do almoço? Aproveita pra dar uma olhada nas contas.","Meio do dia — um bom momento pra um lançamento rápido."];}
    else if(hora<18){titulo="Boa tarde";frases=["Como estão os números hoje?","Boa hora pra revisar os gastos da semana."];}
    else if(hora<22){titulo="Boa noite";frases=["Fechando o dia — vamos ver como ficaram as contas.","Um minuto pra organizar as finanças antes de descansar."];noite=true;}
    else {titulo="Boa noite";frases=["Ainda por aqui? Bora fechar o dia com as contas em ordem.","Madrugando ou terminando tarde? De qualquer forma, boa noite."];noite=true;}
    if(dia===1)frases.push("Início de semana — hora de recalcular a rota financeira.");
    if(dia===5)frases.push("Sextou! Só confere as contas antes de comemorar.");
    if(dia===0||dia===6)frases.push("Relaxa, mas não esquece de registrar os gastos do rolê.");
    const indice=(agora.getDate()+agora.getMonth()+hora)%frases.length;
    return {titulo:`${titulo}, ${nome}`,frase:frases[indice],noite};
}
export function VaultEntry() {
    const location = useLocation();
    const navigate = useNavigate();
    const desktop = useIsDesktop();
    useEffect(() => {
        if (desktop) return; const path = location.pathname; navigate("/feed", { replace: true }); window.dispatchEvent(new CustomEvent("ecos:abrir-cofre", { detail: path })); }, []);
    // A entrada desktop é hospedada pelo shell em um contexto de tela inteira.
    if (desktop) return <VaultScreen embedded voltar={() => navigate("/feed")}/>;
    return <p role="status">Abrindo Cofre…</p>;
}
/** Rota do lançamento: no desktop ocupa uma aba interna do Cofre; no mobile segue o fluxo em tela cheia. */
export function VaultTransacaoEntry() {
    const desktop = useIsDesktop();
    return desktop ? <div className="cofre-app cofre-embedded"><TransactionDetailScreen/></div> : <VaultEntry/>;
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
    const rotaAtual = useLocation().pathname;
    const { espacoAtivo } = useAppUI();
    const { equipes } = useMinhasEquipes();
    const nomeEquipe = espacoAtivo.startsWith("equipe:") ? equipes.find(e => e.id === espacoAtivo.slice(7))?.nome ?? "Equipe" : undefined;
    const [fase, setFase] = useState<Fase>("carregando");
    const [erro, setErro] = useState("");
    const [versao, setVersao] = useState(0);
    const esperando = useComprovantesEsperando();
    // Senha lembrada neste computador (Windows): depois de uma atualização do servidor o Cofre abre sozinho.
    const { perfil: perfilLogado } = useAuth();
    const chave = perfilLogado ? chaveDoCofre(perfilLogado.id, espacoAtivo) : null;
    const chaveRef = useRef(chave);
    chaveRef.current = chave;
    const [podeLembrar, setPodeLembrar] = useState(false);
    useEffect(() => { let v = true; void lembrarSenhaSuportado().then((ok) => { if (v) setPodeLembrar(ok); }); return () => { v = false; }; }, []);
    const ultimaTentativa = useRef(0);
    const tentando = useRef(false);
    /** Tenta abrir o Cofre com a senha lembrada. Nunca depois de um "Bloquear" de propósito; no máximo a cada 15 s. */
    async function tentarDestrancarLembrada(): Promise<boolean> {
        const k = chaveRef.current;
        if (!k || tentando.current || bloqueioManual(k) || Date.now() - ultimaTentativa.current < 15000)
            return false;
        tentando.current = true;
        ultimaTentativa.current = Date.now();
        try {
            const senha = await lerSenhaLembrada(k);
            if (!senha)
                return false;
            await vault.desbloquear(senha);
            return true;
        }
        catch (e) {
            // Senha do Cofre incorreta (ela mudou): a lembrada não vale mais. Erro de rede ou de sessão não apaga nada.
            if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") {
                await esquecerSenha(k);
                setErro("A senha lembrada neste computador não funciona mais. Digite a senha do Cofre.");
            }
            return false;
        }
        finally {
            tentando.current = false;
        }
    }
    useEffect(() => {
        let vivo = true;
        let geracao = 0;
        const bloquear = () => { geracao++; setFase("bloqueado"); void verificar(); };
        const bloquearManual = () => { if (chaveRef.current) marcarBloqueioManual(chaveRef.current); bloquear(); };
        const marcarManual = () => { if (chaveRef.current) marcarBloqueioManual(chaveRef.current); };
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
                else if (!cfg.destrancado) {
                    if (await tentarDestrancarLembrada()) {
                        if (vivo && atual === geracao)
                            setVersao(v => v + 1);
                        return;
                    }
                    if (!vivo || atual !== geracao)
                        return;
                    setFase("bloqueado");
                }
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
        window.addEventListener("ecos:solicitar-bloqueio", bloquearManual);
        window.addEventListener("ecos:bloqueio-manual", marcarManual);
        const focus = () => void verificar();
        window.addEventListener("focus", focus);
        const timer = window.setInterval(focus, 30000);
        void verificar(true);
        return () => { vivo = false; clearInterval(timer); window.removeEventListener("focus", focus); window.removeEventListener("ecos:cofre-bloqueado", bloquear); window.removeEventListener("ecos:solicitar-bloqueio", bloquearManual); window.removeEventListener("ecos:bloqueio-manual", marcarManual); };
    }, [versao, chave]); // `chave` só passa de nula a definida uma vez (quando o perfil chega): aí a senha lembrada pode ser usada
    async function bloquear() { setFase("bloqueado"); try {
        await vault.bloquear();
    }
    catch (e) {
        setErro(`Dados ocultados neste dispositivo. Não foi possível confirmar o bloqueio no servidor: ${(e as Error).message}`);
    } }
    return <div className={embedded ? "cofre-app cofre-embedded" : "cofre-app"}>
        {!embedded&&<header className="cofre-header">
            <div className="cofre-brand"><span className="cofre-brand-icon"><ShieldHalf size={21}/></span><span>Cofre<small>{nomeEquipe ? `EQUIPE · ${nomeEquipe.toUpperCase()}` : "ECOS · FINANÇAS"}</small></span></div>
            <div className="cofre-header-actions">{!embedded&&<button title="Voltar ao Ecos" aria-label="Voltar ao Ecos" onClick={voltar}><ArrowLeft size={17}/><span>Voltar ao Ecos</span></button>}{fase === "aberto" && <button title="Bloquear Cofre" aria-label="Bloquear" onClick={() => void bloquear()}><Lock size={16}/><span>Bloquear</span></button>}</div>
        </header>}
        {erro && <p role="alert" className="cofre-notice">{erro}</p>}
        {fase !== "aberto" && esperando > 0 && <p role="status" className="cofre-notice">{esperando === 1 ? "1 comprovante está esperando" : `${esperando} comprovantes estão esperando`}: desbloqueie o Cofre para guardar. Se você sair antes, compartilhe de novo.</p>}
        {fase === "aberto" ? <><VaultWorkspace/>{!embedded&&<>{!rotaAtual.startsWith("/cofre/transacao")&&!rotaAtual.startsWith("/cofre/comprovantes")&&<Fab/>}<CreateFlow/></>}</> : fase === "carregando" ? <p className="p-8" role="status">Verificando Cofre…</p> : fase === "desativado" ? <p className="p-8">Ative o módulo Cofre nas configurações do Ecos e no servidor.</p> : <VaultLockScreen equipe={nomeEquipe} primeiraVez={fase === "ativar"} permitirLembrar={podeLembrar} onSubmeter={async (senha,lembrar)=>{if(fase === "ativar")await vault.ativar(senha);else await vault.desbloquear(senha);if(chave){limparBloqueioManual(chave);if(lembrar)await lembrarSenha(chave,senha);}setErro("");setVersao(v=>v+1);}}/>}
    </div>;
}

const menus = [
    {id:"painel",nome:"Painel",curto:"Painel",icone:LayoutDashboard,descricao:"Uma visão clara das suas finanças."},
    {id:"lancamentos",nome:"Transações",curto:"Extrato",icone:ArrowLeftRight,descricao:"Movimentações, conciliação e histórico."},
    {id:"comprovantes",nome:"Comprovantes",curto:"Comprov.",icone:Paperclip,descricao:"Comprovantes e notas fiscais guardados, ligados aos seus lançamentos."},
    {id:"recorrencias",nome:"Recorrências",curto:"Recorr.",icone:Repeat2,descricao:"Compromissos recorrentes e parcelamentos."},
    {id:"fluxo",nome:"Fluxo de Trabalho",curto:"Fluxo",icone:CalendarDays,descricao:"Organize o que entra e o que sai."},
    {id:"contas",nome:"Contas",curto:"Contas",icone:Landmark,descricao:"Contas e saldos financeiros."},
    {id:"categorias",nome:"Categorias",curto:"Categorias",icone:Tags,descricao:"Organize receitas e despesas."},
    {id:"sacados",nome:"Sacados",curto:"Sacados",icone:Users,descricao:"Quem pagou ou recebeu, e a conciliação de nomes parecidos."},
];
/** No mobile, estas seções saem da barra inferior e vão para o menu "Mais". */
const MAIS_MOBILE = ["comprovantes", "fluxo", "categorias", "sacados"];
/** Endereços antigos do Cofre que agora são abas do painel de configurações. */
const ABA_DA_ROTA_ANTIGA: Record<string, AbaConfigCofre> = { csv: "csv", ajuda: "ajuda", configuracoes: "geral" };
/** Cor escolhida para o espaço Pessoal (Equipes › Pessoal); sem escolha, o azul padrão. */
function corPessoal(): string {
    try { return localStorage.getItem("ecos:cor-equipe-pessoal") ?? "#3E6FA8"; } catch { return "#3E6FA8"; }
}
const CHAVE_MENU_RECOLHIDO = "ecos:cofre:menu-recolhido";
function lerMenuRecolhido(): boolean {
    try { return localStorage.getItem(CHAVE_MENU_RECOLHIDO) === "1"; } catch { return false; }
}
export function VaultWorkspace() {
    const navigate=useNavigate(); const location=useLocation();const {versao:externa,notificar}=useRefreshBus();const {setDiaCofre,abrirCaptura,espacoAtivo,setEspacoAtivo}=useAppUI();
    const {perfil}=useAuth(); const {equipes}=useMinhasEquipes(); const [menuUsuario,setMenuUsuario]=useState(false); const [maisAberto,setMaisAberto]=useState(false);
    /** Aba aberta do painel flutuante de configurações (null: fechado). */
    const [config,setConfig]=useState<AbaConfigCofre|null>(null);
    // Menu lateral recolhido (só ícones): lembrado neste aparelho. No celular o menu é a barra de baixo e isto não se aplica.
    const [recolhido,setRecolhido]=useState(lerMenuRecolhido);
    function alternarMenu(){setRecolhido(v=>{const novo=!v;try{localStorage.setItem(CHAVE_MENU_RECOLHIDO,novo?"1":"0");}catch{/* armazenamento indisponível: vale só nesta sessão */}return novo;});setMenuUsuario(false);}
    const equipeAtual=equipes.find(e=>`equipe:${e.id}`===espacoAtivo);
    const corDoEspaco=equipeAtual?corDaEquipe(equipeAtual.id):corPessoal();
    const nomeUsuario=perfil?nomeExibicao(perfil):"Perfil"; const {url:urlFoto}=useFotoPerfil(perfil?.id,perfil?.avatar_atualizado_em);
    const greeting=useMemo(()=>saudacao(nomeUsuario.split(" ")[0]),[nomeUsuario]);
    const secao=location.pathname.split("/")[2]||"painel";
    // Chegou comprovante (soltar no desktop, compartilhar no celular): leva a pessoa para onde ele vai ser guardado.
    const comprovantesEsperando=useComprovantesEsperando();
    useEffect(()=>{if(comprovantesEsperando>0&&secao!=="comprovantes")navigate("/cofre/comprovantes");},[comprovantesEsperando,secao,navigate]);
    const menu=menus.find(m=>m.id===secao);
    const [period,setPeriod]=useState<Period>(defaultPeriod);
    const range=periodRange(period);const periodo:Periodo={data_de:range.from,data_ate:range.to};
    const [painel,setPainel]=useState<Painel|null>(null);
    const [categorias,setCategorias]=useState<CategoriaApi[]>([]);
    const [erro,setErro]=useState<{texto:string;incompativel:boolean}|null>(null);
    const [filtro,setFiltro]=useState<Filtro>({});const [versao,setVersao]=useState(0);
    const valido=!!periodo.data_de&&!!periodo.data_ate&&periodo.data_de<=periodo.data_ate;
    useEffect(()=>{let vivo=true;vault.categorias.listar().then(c=>{if(vivo)setCategorias(c);}).catch(()=>{/* A tela de cada recurso apresenta sua falha. */});return()=>{vivo=false;};},[versao,externa]);
    // Mudar período/seção esvazia o painel (aparece o esqueleto); recarregar depois de mexer num lançamento troca os
    // números no lugar. Esvaziar a cada recarga encolhia a página e a rolagem voltava para o topo.
    const painelDe=useRef("");
    useEffect(()=>{
        let vivo=true;
        const quem=`${periodo.data_de}|${periodo.data_ate}|${secao}`;
        if(painelDe.current!==quem){painelDe.current=quem;setPainel(null);}
        setErro(null);
        if(!valido||secao!=="painel")return;
        financeiro.painel(periodo).then(p=>{if(vivo)setPainel(p);}).catch(e=>{if(vivo)setErro({texto:e.message,incompativel:e instanceof ApiError&&e.status===404});});
        return()=>{vivo=false;};
    },[periodo.data_de,periodo.data_ate,valido,secao,versao,externa]);
    useEffect(()=>{if(secao!=="fluxo")setDiaCofre(null);return()=>setDiaCofre(null);},[secao,setDiaCofre]);
    useEffect(()=>{document.querySelector<HTMLElement>(".cofre-nav [aria-current=page]")?.scrollIntoView({inline:"center",block:"nearest"});},[secao]);
    function atualizar(){setVersao(v=>v+1);notificar();}
    const abrirDocumento=useAbrirDocumento();
    // O shell desktop transforma o lançamento em uma aba interna do Cofre; no mobile, navega para o detalhe.
    function abrir(id:string){abrirDocumento(`/cofre/transacao/${id}`);}
    const navegar=(id:string)=>{setFiltro({});navigate(`/cofre/${id}`);};
    const abrirConfig=(aba:AbaConfigCofre)=>{setMenuUsuario(false);setMaisAberto(false);setConfig(aba);};
    // Endereços antigos (/cofre/csv, /cofre/configuracoes, /cofre/ajuda) abrem o painel por cima do painel financeiro.
    useEffect(()=>{const aba=ABA_DA_ROTA_ANTIGA[secao];if(aba){setConfig(aba);navigate("/cofre/painel",{replace:true});}},[secao,navigate]);
    return <div className="cofre-workspace" data-recolhido={recolhido||undefined}>
        <aside aria-label="Navegação do Cofre" className="cofre-nav" data-recolhido={recolhido||undefined}>
          <div className="cofre-sidebar-brand"><ShieldHalf size={18}/><span>COFRE</span><button type="button" className="cofre-nav-recolher" aria-label={recolhido?"Expandir menu lateral":"Recolher menu lateral"} aria-expanded={!recolhido} title={recolhido?"Expandir menu":"Recolher menu"} onClick={alternarMenu}>{recolhido?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}</button></div>
          <nav>{menus.map(({id,nome,curto,icone:Icon})=><button key={id} aria-label={nome} title={nome} data-mais={MAIS_MOBILE.includes(id)||undefined} aria-current={secao===id?"page":undefined} onClick={()=>navegar(id)}><Icon size={16}/><span className="cofre-nav-desktop">{nome}</span><span className="cofre-nav-mobile">{curto}</span></button>)}<button type="button" className="cofre-more-btn" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={maisAberto} aria-current={MAIS_MOBILE.includes(secao)?"page":undefined} onClick={()=>setMaisAberto(v=>!v)}><Ellipsis size={16}/><span>Mais</span></button></nav>
          
          <div className="cofre-user-wrap"><button className="cofre-user" title={recolhido?`${nomeUsuario} · ${equipeAtual?.nome??"Pessoal"}`:undefined} aria-label={`Conta e equipe: ${nomeUsuario}`} onClick={()=>setMenuUsuario(v=>!v)}><Avatar nome={nomeUsuario} tamanho={32} url={urlFoto}/><span><b>{nomeUsuario}</b><small>{equipeAtual?.nome??"Pessoal"}</small></span><ChevronUp size={15}/>{perfil?.papel==="admin"&&<i className="cofre-user-admin" style={{background:corDoEspaco}} title="Administrador" aria-label="Administrador"><Crown size={10} strokeWidth={2.4}/></i>}</button>{menuUsuario&&<div className="cofre-user-menu"><p>Trocar equipe</p><button className="cofre-team-option" onClick={()=>{setEspacoAtivo("pessoal");setMenuUsuario(false);}}><Avatar nome={nomeUsuario} tamanho={26} url={urlFoto}/><span>Pessoal</span></button>{equipes.map(e=><EquipeMenuItem key={e.id} equipe={e} onClick={()=>{setEspacoAtivo(`equipe:${e.id}`);setMenuUsuario(false);}}/>)}<hr/><button className="cofre-action-lock" onClick={()=>void vault.bloquear()}><Lock size={15}/>Bloquear Cofre</button><button className="cofre-action-config" onClick={()=>abrirConfig("geral")}><Settings2 size={15}/>Configurações</button><button className="cofre-action-back" onClick={()=>window.dispatchEvent(new Event("ecos:voltar-do-cofre"))}><ArrowLeft size={15}/>Voltar ao Ecos</button></div>}</div>
        </aside>
        {maisAberto&&<><div className="cofre-more-backdrop" onClick={()=>setMaisAberto(false)}/><div className="cofre-more-sheet" role="menu" aria-label="Mais opções do Cofre">{menus.filter(m=>MAIS_MOBILE.includes(m.id)).map(({id,nome,icone:Icon})=><button key={id} role="menuitem" aria-current={secao===id?"page":undefined} onClick={()=>{setMaisAberto(false);navegar(id);}}><Icon size={18}/><span>{nome}</span></button>)}<button role="menuitem" onClick={()=>abrirConfig("geral")}><Settings2 size={18}/><span>Configurações</span></button></div></>}
        <main className="cofre-main"><div className="cofre-content">
            {menu&&secao!=="lancamentos"&&secao!=="categorias"&&secao!=="sacados"&&secao!=="contas"&&secao!=="recorrencias"&&<div className="cofre-page-heading"><div><p className="cofre-eyebrow">{secao==="painel"?"PAINEL FINANCEIRO":"COFRE"}</p><h1>{secao==="painel"?<>{greeting.titulo}{greeting.noite?<Moon size={19}/>:<Sun size={20}/>}</>:menu.nome}</h1><p className="cofre-subtitle">{secao==="painel"?greeting.frase:menu.descricao}</p></div><div className="cofre-page-actions">{["painel","csv","comprovantes"].includes(secao)&&<PeriodPicker value={period} onChange={p=>{setPeriod(p);setFiltro({});}}/>}{secao==="painel"&&<button className="cofre-new-button" onClick={()=>abrirCaptura("transacao")}><Plus size={14}/>Novo lançamento</button>}</div></div>}
            {erro&&<div role="alert" className="cofre-error-card"><span className="cofre-error-icon"><CloudOff size={25}/></span><h2>{erro.incompativel?"O painel precisa de uma atualização":"Não foi possível carregar o painel"}</h2><p>{erro.incompativel?"O serviço do Cofre em execução ainda não oferece este painel. Seus lançamentos continuam disponíveis; atualize o Cofre no servidor para habilitar os gráficos.":erro.texto}</p><div><button className="cofre-solid" onClick={()=>setVersao(v=>v+1)}><RefreshCw size={15}/>Tentar novamente</button><button className="cofre-secondary" onClick={()=>navigate("/cofre/lancamentos")}>Abrir lançamentos <ArrowRight size={15}/></button></div></div>}
            {!valido&&<p role="alert">Selecione um período válido.</p>}
            {secao==="painel"&&(painel?<VaultDashboard painel={painel} categorias={categorias} periodo={periodo} abrir={abrir} onFluxo={()=>navigate("/cofre/fluxo")} drill={f=>{setFiltro(f);navigate("/cofre/lancamentos");}}/>:!erro&&<div className="cofre-loading" role="status"><RefreshCw size={20}/><span>Preparando seu painel…</span><div className="cofre-skeletons">{[1,2,3,4].map(i=><div key={i}/>)}</div></div>)}
            <div className="cofre-panel">
            {secao==="lancamentos"&&valido&&<>{Object.keys(filtro).length>0&&<button className="cofre-secondary" onClick={()=>setFiltro({})}>Limpar filtro do gráfico</button>}<VaultTransactions recarregar={externa} periodo={periodo} period={period} onPeriodChange={p=>{setPeriod(p);setFiltro({});}} filtro={filtro} categorias={categorias} abrir={abrir} atualizar={atualizar}/></>}
            {secao==="comprovantes"&&valido&&<VaultComprovantes recarregar={externa} periodo={periodo} categorias={categorias} abrir={abrir} atualizar={atualizar} irParaData={iso=>{const[y,m]=iso.split("-").map(Number);if(y&&m){setPeriod({kind:"month",year:y,month:m});setFiltro({});}}}/>}
            {secao==="fluxo"&&<VaultWorkflow recarregar={externa} atualizar={atualizar}/>}
            {secao==="recorrencias"&&valido&&<VaultRecorrencias period={period} onPeriodChange={setPeriod} categorias={categorias} atualizar={atualizar} recarregar={externa}/>}
            {secao==="contas"&&valido&&<VaultAccounts period={period} onPeriodChange={setPeriod} categorias={categorias} atualizar={atualizar}/>}
            {secao==="categorias"&&valido&&<VaultCategories period={period} onPeriodChange={setPeriod} categorias={categorias} atualizar={atualizar}/>}
            {secao==="sacados"&&valido&&<VaultSacados period={period} onPeriodChange={setPeriod} atualizar={atualizar}/>}
            {secao==="transacao"&&<TransactionDetailScreen/>}
            </div>
        </div></main>
        {config&&<VaultConfigPanel aba={config} aoTrocarAba={setConfig} aoFechar={()=>setConfig(null)} recolhido={recolhido} aoAlternarMenu={alternarMenu} atualizar={atualizar}/>}
    </div>;
}

function EquipeMenuItem({equipe,onClick}:{equipe:{id:string;nome:string};onClick:()=>void}) {
    const foto=useAvatarEquipe(equipe.id);
    return <button className="cofre-team-option" onClick={onClick}><Avatar nome={equipe.nome} tamanho={26} url={foto} corFundo={corDaEquipe(equipe.id)}/><span>{equipe.nome}</span></button>;
}
