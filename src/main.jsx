import './polyfills.js';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UploadCloud,Loader2,CheckCircle2,ShieldCheck,FileText,Smartphone,Share2,X,FileCheck2,ImageOff,PencilLine,Briefcase,MapPin,Building,BadgeDollarSign,Search,ArrowLeft,Send} from 'lucide-react';
import mammoth from 'mammoth/mammoth.browser';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {ACCEPT_ATTR,LIMITES,MSG,avaliarTexto,validarAssinatura,validarTipo} from '../lib/curriculo-texto.js';
import {ESTADOS,PROFISSOES_SUGERIDAS,formatarTelefone,validarCadastroManual} from '../lib/cadastro-manual.js';
import './styles.css';

const MAX_UPLOAD=4*1024*1024;
const SHARE_CACHE='talentos-share-v1';

const isMobile=()=>/android|iphone|ipad|ipod/i.test(navigator.userAgent);
const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone=()=>window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('Service worker não registrado',e)));
}

/** Currículo recebido pelo "Compartilhar" do celular (guardado pelo service worker). */
async function takeSharedFile(){
  if(!('caches' in window))return null;
  const cache=await caches.open(SHARE_CACHE);
  const r=await cache.match('/shared-resume');
  if(!r)return null;
  await cache.delete('/shared-resume');
  const blob=await r.blob();
  let name=decodeURIComponent(r.headers.get('x-file-name')||'curriculo');
  const type=blob.type||r.headers.get('content-type')||'';
  if(!/\.(pdf|docx)$/i.test(name)){
    if(type.includes('pdf'))name+='.pdf';
    else if(type.includes('wordprocessingml'))name+='.docx';
  }
  return new File([blob],name,{type});
}

const bytes=async file=>new Uint8Array(await (typeof file.arrayBuffer==='function'?file.arrayBuffer():new Response(file).arrayBuffer()));

/**
 * Lê o texto do arquivo e devolve também quantas páginas têm texto,
 * para separar um currículo digital de uma digitalização.
 */
async function extractText(file,tipo){
  const buffer=await bytes(file);
  if(!validarAssinatura(buffer.subarray(0,8),tipo))throw Error(MSG.corrompido);
  try{
    if(tipo==='pdf'){
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=pdfWorkerUrl;
      const pdf=await pdfjs.getDocument({data:buffer,useWorkerFetch:false,isEvalSupported:false}).promise;
      const pages=[];
      for(let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i),content=await page.getTextContent();
        let text='';
        for(const item of content.items){if(item&&typeof item.str==='string')text+=item.str+(item.hasEOL?'\n':' ')}
        pages.push(text);
        page.cleanup();
      }
      const paginas=pdf.numPages;
      await pdf.destroy();
      const comTexto=pages.filter(p=>(p.match(/[0-9A-Za-zÀ-ÿ]/g)||[]).length>=LIMITES.minPaginaComTexto).length;
      return {texto:pages.join('\n').replace(/[ \t]+/g,' ').trim(),paginas,paginasComTexto:comTexto};
    }
    const texto=(await mammoth.extractRawText({arrayBuffer:buffer.buffer})).value.trim();
    return {texto,paginas:0,paginasComTexto:0};
  }catch(error){
    if(error?.message===MSG.corrompido)throw error;
    console.error('Falha ao ler currículo',error);
    throw Error(MSG.curto);
  }
}

/** Pop-up de confirmação: fecha no botão, no Esc ou clicando fora. */
function SuccessDialog({onClose,titulo,texto}){
  const ref=useRef(null);
  useEffect(()=>{
    ref.current?.focus();
    const onKey=e=>{if(e.key==='Escape')onClose()};
    document.addEventListener('keydown',onKey);
    document.body.style.overflow='hidden';
    return ()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=''};
  },[onClose]);
  return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <button type="button" className="dialog-close" onClick={onClose} aria-label="Fechar"><X/></button>
      <div className="dialog-icon"><CheckCircle2/></div>
      <h2 id="dialog-title">{titulo||'Currículo cadastrado!'}</h2>
      <p>{texto||'Recebemos seu currículo. Se o seu perfil combinar com uma de nossas vagas, entraremos em contato.'}</p>
      <button type="button" className="dialog-ok" ref={ref} onClick={onClose}>Fechar</button>
    </div>
  </div>;
}

function App(){
  const [file,setFile]=useState(null);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [done,setDone]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [modo,setModo]=useState('arquivo');                 // 'arquivo' | 'manual'
  const [form,setForm]=useState({nome:'',profissao:'',telefone:'',email:'',especialidade:'',cidade:'',estado:''});
  const [erros,setErros]=useState({});
  const [secao,setSecao]=useState('vagas');                 // 'vagas' | 'cadastro'
  const [vagas,setVagas]=useState(null);
  const [vaga,setVaga]=useState(null);                      // vaga escolhida ("Tenho interesse")
  const [identificacao,setIdentificacao]=useState({telefone:'',email:''});
  const [erroIdent,setErroIdent]=useState('');
  const [enviandoIdent,setEnviandoIdent]=useState(false);
  const inputRef=useRef(null);

  useEffect(()=>{
    fetch('/api/jobs').then(r=>r.json()).then(d=>setVagas(d.vagas||[])).catch(()=>setVagas([]));
  },[]);

  /** Candidatura de quem já tem cadastro: identifica por telefone ou e-mail. */
  const candidatarComCadastro=async e=>{
    e.preventDefault();
    setEnviandoIdent(true);setErroIdent('');
    try{
      const r=await fetch('/api/apply',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jobId:vaga.id,...identificacao})});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){setErroIdent(d.error||'Não foi possível registrar seu interesse.');return}
      setIdentificacao({telefone:'',email:''});
      setVaga(null);
      setDone({titulo:'Candidatura enviada!',texto:'Recebemos seu interesse nesta vaga. Se o seu perfil combinar, entraremos em contato.'});
    }catch{setErroIdent('Sem conexão com o servidor. Tente novamente.')}
    finally{setEnviandoIdent(false)}
  };

  /** Volta a tela ao estado inicial. */
  const reset=()=>{
    setFile(null);
    setMessage('');
    setDragging(false);
    setErros({});
    setForm({nome:'',profissao:'',telefone:'',email:'',especialidade:'',cidade:'',estado:''});
    if(inputRef.current)inputRef.current.value='';
  };

  const mudarCampo=(campo,valor)=>{
    setForm(f=>({...f,[campo]:campo==='telefone'?formatarTelefone(valor):valor}));
    setErros(e=>{const {[campo]:_,...resto}=e;return resto});
    setMessage('');
  };

  /** Envia o cadastro digitado (sem arquivo de currículo). */
  const enviarManual=async e=>{
    e.preventDefault();
    const {ok,erros:falhas,dados}=validarCadastroManual(form);
    if(!ok){setErros(falhas);setMessage('Confira os campos destacados.');return}
    setLoading(true);setMessage('');setErros({});
    try{
      let r;
      try{r=await fetch('/api/manual',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(vaga?{...dados,vagaId:vaga.id}:dados)})}
      catch{throw Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.')}
      if(!r.ok){
        let d={};try{d=await r.json()}catch{}
        if(d.erros)setErros(d.erros);
        throw Error(d.error||`Não foi possível cadastrar agora (erro ${r.status}). Tente novamente.`);
      }
      reset();
      setDone(vaga
        ?{titulo:'Candidatura enviada!',texto:`Recebemos seus dados para a vaga ${vaga.title}. Se o seu perfil combinar, entraremos em contato.`}
        :{titulo:'Cadastro concluído!',texto:'Recebemos seus dados. Se o seu perfil combinar com uma de nossas vagas, entraremos em contato.'});
      setVaga(null);
    }catch(err){setMessage(err.message)}
    finally{setLoading(false)}
  };

  const chooseFile=f=>{
    setMessage('');
    if(!f){setFile(null);return false}
    const tipo=validarTipo(f.name,f.type);
    if(!tipo.ok){setFile(null);setMessage(tipo.motivo);return false}
    if(f.size>MAX_UPLOAD){setFile(null);setMessage('O arquivo deve ter até 4 MB.');return false}
    setFile(f);
    return true;
  };

  const send=async file=>{
    setLoading(true);setMessage('');
    try{
      const tipo=validarTipo(file.name,file.type);
      if(!tipo.ok)throw Error(tipo.motivo);
      const {texto,paginas,paginasComTexto}=await extractText(file,tipo.tipo);
      const exame=avaliarTexto(texto,{paginas,paginasComTexto,tipo:tipo.tipo});
      if(!exame.ok)throw Error(exame.motivo);
      const fd=new FormData();
      fd.append('resume',file);
      fd.append('extractedText',texto.slice(0,50000));
      fd.append('paginas',String(paginas));
      fd.append('paginasComTexto',String(paginasComTexto));
      if(vaga)fd.append('vagaId',vaga.id);
      let r;
      try{r=await fetch('/api/candidates',{method:'POST',body:fd})}
      catch{throw Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.')}
      if(r.status===413)throw Error('O arquivo deve ter até 4 MB.');
      if(!r.ok){
        let d={};try{d=await r.json()}catch{}
        throw Error(d.error||`Não foi possível enviar agora (erro ${r.status}). Tente novamente.`);
      }
      reset();          // limpa a tela
      setDone(vaga
        ?{titulo:'Candidatura enviada!',texto:`Recebemos seu currículo para a vaga ${vaga.title}. Se o seu perfil combinar, entraremos em contato.`}
        :{titulo:'Currículo cadastrado!',texto:'Recebemos seu currículo. Se o seu perfil combinar com uma de nossas vagas, entraremos em contato.'});
      setVaga(null);
    }catch(err){setMessage(err.message)}
    finally{setLoading(false)}
  };

  const submit=e=>{
    e.preventDefault();
    if(!file)return setMessage('Selecione o arquivo do seu currículo.');
    send(file);
  };

  // Currículo compartilhado pelo celular (Android): envia automaticamente.
  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    const share=params.get('share');
    if(!share)return;
    history.replaceState(null,'','/');
    if(share!=='1'){setMessage('Não foi possível receber o arquivo compartilhado. Tente enviá-lo pelo botão abaixo.');return}
    takeSharedFile().then(f=>{
      if(!f)return setMessage('Nenhum arquivo foi recebido. Compartilhe o currículo novamente.');
      if(chooseFile(f))send(f);
    }).catch(()=>setMessage('Não foi possível receber o arquivo compartilhado. Tente enviá-lo pelo botão abaixo.'));
  },[]);

  const VagaResumo=({v})=><div className="vaga-info">
    <h3>{v.title}</h3>
    <div className="vaga-meta">
      <span><MapPin/>{[v.city,v.state].filter(Boolean).join('/')}</span>
      <span><Building/>{v.location}</span>
      <span><Briefcase/>{v.contract}</span>
      <span><BadgeDollarSign/>{v.salary}</span>
    </div>
  </div>;

  return <div className="page">
    <header className="topbar">
      <img src="/logo-doccsc-light.png" alt="doc csc · centro de serviços compartilhados"/>
      <span>Talentos DOC</span>
    </header>

    <nav className="secoes">
      <button type="button" className={secao==='vagas'?'ativo':''} onClick={()=>{setSecao('vagas');setMessage('')}}><Briefcase/>Vagas abertas{vagas?.length>0&&<em>{vagas.length}</em>}</button>
      <button type="button" className={secao==='cadastro'?'ativo':''} onClick={()=>{setSecao('cadastro');setMessage('')}}><UploadCloud/>Enviar meu currículo</button>
    </nav>

    {secao==='vagas'&&<main className="card">
      {vaga?<>
        <button type="button" className="voltar" onClick={()=>{setVaga(null);setErroIdent('')}}><ArrowLeft/>Voltar às vagas</button>
        <h1>Tenho interesse</h1>
        <VagaResumo v={vaga}/>
        {vaga.description&&<p className="vaga-desc">{vaga.description}</p>}

        <div className="escolhas">
          <form className="ja-tenho" onSubmit={candidatarComCadastro}>
            <b><Search/>Já enviei meu currículo antes</b>
            <p>Informe o telefone ou o e-mail do seu cadastro que nós ligamos você a esta vaga.</p>
            <div className="campos">
              <label className="campo"><span>Telefone / WhatsApp</span>
                <input value={identificacao.telefone} onChange={e=>{setIdentificacao(i=>({...i,telefone:formatarTelefone(e.target.value)}));setErroIdent('')}} placeholder="(69) 99999-9999" inputMode="tel"/>
              </label>
              <label className="campo"><span>ou E-mail</span>
                <input value={identificacao.email} onChange={e=>{setIdentificacao(i=>({...i,email:e.target.value}));setErroIdent('')}} placeholder="seunome@email.com" inputMode="email"/>
              </label>
            </div>
            {erroIdent&&<div className="alert">{erroIdent}</div>}
            <button className="submit" disabled={enviandoIdent}>{enviandoIdent?<Loader2 className="spin"/>:<Send/>}Confirmar interesse</button>
          </form>

          <div className="ainda-nao">
            <b><PencilLine/>Ainda não tenho cadastro</b>
            <p>Escolha como quer se candidatar. Seus dados entram no banco de talentos e já ficam ligados a esta vaga.</p>
            <div className="escolha-botoes">
              <button type="button" onClick={()=>{setSecao('cadastro');setModo('arquivo')}}><UploadCloud/>Enviar meu currículo</button>
              <button type="button" onClick={()=>{setSecao('cadastro');setModo('manual')}}><PencilLine/>Preencher meus dados</button>
            </div>
          </div>
        </div>
      </>:<>
        <h1>Vagas abertas</h1>
        <p className="lead">Veja as oportunidades do DOC CSC e candidate-se em um toque. Não encontrou uma vaga para você? Envie seu currículo assim mesmo — ele fica no banco de talentos.</p>
        {!vagas&&<div className="processing"><Loader2 className="spin"/><span><b>Carregando as vagas...</b><small>Só um instante.</small></span></div>}
        <div className="vagas">
          {(vagas||[]).map(v=><article key={v.id} className="vaga-card">
            <VagaResumo v={v}/>
            {v.description&&<p className="vaga-desc">{v.description}</p>}
            <button type="button" className="submit" onClick={()=>{setVaga(v);setErroIdent('')}}><Send/>Tenho interesse</button>
          </article>)}
        </div>
        {vagas&&vagas.length===0&&<div className="sem-vagas">
          <Briefcase/>
          <b>Nenhuma vaga aberta no momento</b>
          <span>Envie seu currículo mesmo assim: quando surgir uma vaga com o seu perfil, entramos em contato.</span>
          <button type="button" className="submit" onClick={()=>setSecao('cadastro')}><UploadCloud/>Enviar meu currículo</button>
        </div>}
      </>}
    </main>}

    {secao==='cadastro'&&<main className="card">
      {vaga&&<div className="vaga-alvo">
        <span><Send/>Candidatura para <b>{vaga.title}</b> · {[vaga.city,vaga.state].filter(Boolean).join('/')}</span>
        <button type="button" onClick={()=>setVaga(null)}>Enviar sem vincular a uma vaga</button>
      </div>}
      <h1>Envie seu currículo</h1>
      <p className="lead">Seu currículo entra no nosso banco de talentos e é considerado nas vagas abertas. Envie o arquivo do currículo ou, se não tiver um, preencha seus dados.</p>

      <div className="modos" role="tablist">
        <button type="button" role="tab" aria-selected={modo==='arquivo'} className={modo==='arquivo'?'ativo':''}
          onClick={()=>{setModo('arquivo');setMessage('');setErros({})}}><UploadCloud/>Enviar arquivo do currículo</button>
        <button type="button" role="tab" aria-selected={modo==='manual'} className={modo==='manual'?'ativo':''}
          onClick={()=>{setModo('manual');setMessage('');setErros({})}}><PencilLine/>Preencher meus dados</button>
      </div>

      {modo==='manual'?<form onSubmit={enviarManual} noValidate>
        <p className="tip"><PencilLine/><span>Não tem o currículo em arquivo? Preencha os campos abaixo — leva menos de um minuto. Depois, se quiser, você pode voltar e enviar o currículo completo.</span></p>

        <div className="campos">
          <label className={'campo wide'+(erros.nome?' erro':'')}>
            <span>Nome completo *</span>
            <input value={form.nome} onChange={e=>mudarCampo('nome',e.target.value)} placeholder="Ex.: Maria Fernanda Oliveira" autoComplete="name" disabled={loading}/>
            {erros.nome&&<small>{erros.nome}</small>}
          </label>

          <label className={'campo'+(erros.profissao?' erro':'')}>
            <span>Profissão *</span>
            <input value={form.profissao} onChange={e=>mudarCampo('profissao',e.target.value)} placeholder="Ex.: Enfermeira" list="profissoes" disabled={loading}/>
            <datalist id="profissoes">{PROFISSOES_SUGERIDAS.map(p=><option key={p} value={p}/>)}</datalist>
            {erros.profissao&&<small>{erros.profissao}</small>}
          </label>

          <label className="campo">
            <span>Especialidade / área de atuação</span>
            <input value={form.especialidade} onChange={e=>mudarCampo('especialidade',e.target.value)} placeholder="Ex.: Pediatria, UTI adulto" disabled={loading}/>
            <small className="ajuda">Para médicos, informe a especialidade (pediatria, ginecologia e obstetrícia, ortopedia...).</small>
          </label>

          <label className={'campo'+(erros.telefone?' erro':'')}>
            <span>Telefone / WhatsApp *</span>
            <input value={form.telefone} onChange={e=>mudarCampo('telefone',e.target.value)} placeholder="(69) 99999-9999" inputMode="tel" autoComplete="tel" disabled={loading}/>
            {erros.telefone&&<small>{erros.telefone}</small>}
          </label>

          <label className={'campo'+(erros.email?' erro':'')}>
            <span>E-mail</span>
            <input value={form.email} onChange={e=>mudarCampo('email',e.target.value)} placeholder="seunome@email.com" inputMode="email" autoComplete="email" disabled={loading}/>
            {erros.email&&<small>{erros.email}</small>}
          </label>

          <label className={'campo'+(erros.cidade?' erro':'')}>
            <span>Cidade *</span>
            <input value={form.cidade} onChange={e=>mudarCampo('cidade',e.target.value)} placeholder="Ex.: Porto Velho" autoComplete="address-level2" disabled={loading}/>
            {erros.cidade&&<small>{erros.cidade}</small>}
          </label>

          <label className={'campo'+(erros.estado?' erro':'')}>
            <span>Estado *</span>
            <select value={form.estado} onChange={e=>mudarCampo('estado',e.target.value)} disabled={loading}>
              <option value="">Selecione</option>
              {ESTADOS.map(e=><option key={e.uf} value={e.uf}>{e.nome} ({e.uf})</option>)}
            </select>
            {erros.estado&&<small>{erros.estado}</small>}
          </label>
        </div>

        {loading&&<div className="processing"><Loader2 className="spin"/><span><b>Enviando seu cadastro...</b><small>Só um instante.</small></span></div>}
        {message&&<div className="alert">{message}</div>}

        <button className="submit" disabled={loading}>
          {loading?<Loader2 className="spin"/>:<CheckCircle2/>}
          {loading?'Enviando...':'Concluir cadastro'}
        </button>

        <p className="privacy"><ShieldCheck/>Seus dados são usados apenas para processos seletivos do DOC CSC e ficam guardados em ambiente restrito à equipe de recrutamento.</p>
      </form>:<form onSubmit={submit}>
        <div className="steps">
          <span><b>1</b> Anexe o arquivo</span><i/>
          <span><b>2</b> Leitura automática</span><i/>
          <span><b>3</b> Cadastro concluído</span>
        </div>

        <div className="formatos">
          <p className="ok"><FileCheck2/><span><b>Aceitamos apenas</b> arquivo <b>PDF</b> (.pdf) ou <b>Word</b> (.docx), com o currículo em texto e até 4 MB.</span></p>
          <p className="no"><ImageOff/><span><b>Não aceitamos</b> foto, print de tela, imagem digitalizada nem PDF feito a partir de imagem (JPG, PNG, HEIC), porque o sistema não consegue ler os dados do currículo.</span></p>
          <p className="dica">No Word, use <b>Arquivo → Salvar como</b> e escolha <b>PDF</b> ou <b>.docx</b>. O formato <b>.doc</b> (Word antigo) não é aceito.</p>
        </div>

        <label className={'drop'+(dragging?' dragging':'')+(file?' filled':'')}
          onDragOver={e=>{e.preventDefault();setDragging(true)}}
          onDragLeave={()=>setDragging(false)}
          onDrop={e=>{e.preventDefault();setDragging(false);if(!loading)chooseFile(e.dataTransfer.files?.[0])}}>
          <input ref={inputRef} type="file" accept={ACCEPT_ATTR} disabled={loading} onChange={e=>chooseFile(e.target.files?.[0])}/>
          {file?<FileText/>:<UploadCloud/>}
          <b>{file?file.name:'Toque para escolher o currículo'}</b>
          <span>{file?'Arquivo selecionado · toque para trocar':'Somente PDF ou Word (.docx) · até 4 MB'}</span>
        </label>

        {isMobile()&&!isStandalone()&&<p className="tip">
          <Smartphone/>
          {isIOS()
            ?<span>Está no celular? No WhatsApp, abra o currículo e use <b>Compartilhar → Salvar em Arquivos</b>; depois escolha o arquivo aqui.</span>
            :<span>Também é possível enviar direto do WhatsApp: toque e segure o currículo, escolha <b>Compartilhar</b> <Share2/> e selecione <b>Talentos DOC</b>.</span>}
        </p>}

        {loading&&<div className="processing">
          <Loader2 className="spin"/>
          <span><b>Enviando seu currículo...</b><small>Estamos lendo o arquivo. Não feche esta tela.</small></span>
        </div>}

        {message&&<div className="alert">{message}</div>}

        <button className="submit" disabled={loading||!file}>
          {loading?<Loader2 className="spin"/>:<UploadCloud/>}
          {loading?'Enviando...':'Enviar currículo'}
        </button>

        <p className="privacy"><ShieldCheck/>Seus dados são usados apenas para processos seletivos do DOC CSC e ficam guardados em ambiente restrito à equipe de recrutamento.</p>
      </form>}
    </main>}

    <footer className="foot">DOC CSC · Centro de Serviços Compartilhados</footer>

    {done&&<SuccessDialog titulo={done.titulo} texto={done.texto} onClose={()=>setDone(false)}/>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
