/**
 * Regras de aceitação do arquivo do currículo.
 * Usado no navegador (src/main.jsx) e no servidor (api/candidates.js), para que
 * a mesma regra valha no envio pela tela e em qualquer chamada direta da API.
 *
 * Aceita: PDF e Word (.docx) com texto de verdade.
 * Recusa: imagem (JPG, PNG, HEIC...), PDF que é só foto/digitalização do
 * currículo (sem camada de texto) e arquivos com texto insuficiente.
 */

export const TIPOS_ACEITOS={
  pdf:{ext:'.pdf',mime:'application/pdf'},
  docx:{ext:'.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}
};

export const ACCEPT_ATTR='.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const LIMITES={
  minLetras:350,      // caracteres alfanuméricos de texto útil
  minPalavras:60,     // palavras com 2+ letras
  minPaginaComTexto:80
};

export const MSG={
  formato:'Envie seu currículo em PDF ou Word (.docx). Imagens (JPG, PNG, HEIC) e outros formatos não são aceitos.',
  doc:'O formato .doc (Word antigo) não é aceito. Abra o arquivo no Word e use "Salvar como" escolhendo .docx ou PDF.',
  corrompido:'O arquivo não parece ser um PDF ou .docx válido. Gere o arquivo novamente e envie outra vez.',
  imagem:'Este PDF é uma imagem (foto ou digitalização do currículo), sem texto. Envie o currículo em texto: no Word, use "Salvar como → PDF", ou envie o próprio .docx.',
  curto:'Não foi possível ler texto suficiente neste arquivo. Se ele for uma foto ou digitalização, envie o currículo em texto (PDF gerado pelo Word ou o próprio .docx).'
};

// Marcas d'água de aplicativos de digitalização: não contam como texto do currículo.
const MARCAS=/(scanned (by|with) [\w ]+|digitalizado (com|por) [\w ]+|camscanner|adobe scan|office lens|genius scan|tiny ?scanner|docu?scan|escaneado com [\w ]+)/gi;

const LETRAS=/[0-9A-Za-zÀ-ÿ]/g;

/** Remove marcas de scanner, numeração de página e espaços repetidos. */
export function limparTexto(text){
  return String(text||'')
    .replace(MARCAS,' ')
    .replace(/^\s*(p[áa]gina|page)\s*\d+(\s*(de|of)\s*\d+)?\s*$/gim,' ')
    .replace(/[ \t ]+/g,' ')
    .trim();
}

export function contarLetras(text){
  return (String(text||'').match(LETRAS)||[]).length;
}

export function contarPalavras(text){
  return String(text||'').split(/[^0-9A-Za-zÀ-ÿ]+/).filter(p=>p.length>=2).length;
}

/**
 * Valida o tipo do arquivo pelo nome e pelo MIME.
 * @returns {{ok:boolean, tipo?:'pdf'|'docx', motivo?:string}}
 */
export function validarTipo(nome,mime){
  const n=String(nome||'').toLowerCase();
  if(/\.docx$/.test(n))return {ok:true,tipo:'docx'};
  if(/\.pdf$/.test(n))return {ok:true,tipo:'pdf'};
  if(/\.doc$/.test(n))return {ok:false,motivo:MSG.doc};
  if(/\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?|svg)$/.test(n))return {ok:false,motivo:MSG.formato};
  // Sem extensão reconhecida, decide pelo MIME (caso do "Compartilhar" do celular).
  if(mime===TIPOS_ACEITOS.pdf.mime)return {ok:true,tipo:'pdf'};
  if(mime===TIPOS_ACEITOS.docx.mime)return {ok:true,tipo:'docx'};
  if(String(mime||'').startsWith('image/'))return {ok:false,motivo:MSG.formato};
  return {ok:false,motivo:MSG.formato};
}

/**
 * Confere a assinatura do arquivo: %PDF para PDF e PK.. (zip) para .docx.
 * Pega a imagem renomeada como .pdf.
 * @param {Uint8Array|Buffer} bytes primeiros bytes do arquivo
 */
export function validarAssinatura(bytes,tipo){
  const b=bytes||[];
  if(tipo==='pdf')return b[0]===0x25&&b[1]===0x50&&b[2]===0x44&&b[3]===0x46;          // %PDF
  if(tipo==='docx')return b[0]===0x50&&b[1]===0x4b&&(b[2]===0x03||b[2]===0x05||b[2]===0x07); // PK zip
  return false;
}

/**
 * Decide se o texto extraído é de um currículo digital ou de uma imagem.
 * @param {string} texto texto extraído do arquivo
 * @param {{paginas?:number, paginasComTexto?:number, tipo?:string}} info
 * @returns {{ok:boolean, motivo?:string, letras:number, palavras:number}}
 */
export function avaliarTexto(texto,info={}){
  const limpo=limparTexto(texto);
  const letras=contarLetras(limpo);
  const palavras=contarPalavras(limpo);
  const paginas=info.paginas||0;
  const paginasComTexto=info.paginasComTexto??(letras>=LIMITES.minPaginaComTexto?1:0);

  // PDF com páginas mas nenhuma com texto: é digitalização/foto.
  if(paginas>0&&paginasComTexto===0)return {ok:false,motivo:MSG.imagem,letras,palavras};
  if(letras<LIMITES.minLetras||palavras<LIMITES.minPalavras){
    const motivo=(info.tipo==='pdf'&&letras<120)?MSG.imagem:MSG.curto;
    return {ok:false,motivo,letras,palavras};
  }
  return {ok:true,letras,palavras};
}
