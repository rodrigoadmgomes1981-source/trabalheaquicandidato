import './polyfills.js';
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UploadCloud,Loader2,CheckCircle2,ShieldCheck,FileText,Smartphone,Share2,X,FileCheck2,ImageOff} from 'lucide-react';
import mammoth from 'mammoth/mammoth.browser';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {ACCEPT_ATTR,LIMITES,MSG,avaliarTexto,validarAssinatura,validarTipo} from '../lib/curriculo-texto.js';
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
function SuccessDialog({onClose}){
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
      <h2 id="dialog-title">Currículo cadastrado!</h2>
      <p>Recebemos seu currículo. Se o seu perfil combinar com uma de nossas vagas, entraremos em contato.</p>
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
  const inputRef=useRef(null);

  /** Volta a tela ao estado inicial. */
  const reset=()=>{
    setFile(null);
    setMessage('');
    setDragging(false);
    if(inputRef.current)inputRef.current.value='';
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
      let r;
      try{r=await fetch('/api/candidates',{method:'POST',body:fd})}
      catch{throw Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.')}
      if(r.status===413)throw Error('O arquivo deve ter até 4 MB.');
      if(!r.ok){
        let d={};try{d=await r.json()}catch{}
        throw Error(d.error||`Não foi possível enviar agora (erro ${r.status}). Tente novamente.`);
      }
      reset();          // limpa a tela
      setDone(true);    // e abre o pop-up de confirmação
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

  return <div className="page">
    <header className="topbar">
      <img src="/logo-doccsc-light.png" alt="doc csc · centro de serviços compartilhados"/>
      <span>Banco de Talentos</span>
    </header>

    <main className="card">
      <h1>Envie seu currículo</h1>
      <p className="lead">Seu currículo entra no nosso banco de talentos e é considerado nas vagas abertas. É rápido: só anexar o arquivo.</p>

      <form onSubmit={submit}>
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
            :<span>Também é possível enviar direto do WhatsApp: toque e segure o currículo, escolha <b>Compartilhar</b> <Share2/> e selecione este app.</span>}
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
      </form>
    </main>

    <footer className="foot">DOC CSC · Centro de Serviços Compartilhados</footer>

    {done&&<SuccessDialog onClose={()=>setDone(false)}/>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
