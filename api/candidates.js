import {randomUUID} from 'node:crypto';
import {put} from '@vercel/blob';
import {database,ensureSchema} from '../lib/db.js';
import {buildSearchText,clean,parseResume} from '../lib/extract.js';
import {avaliarTexto,validarAssinatura,validarTipo} from '../lib/curriculo-texto.js';
import {authorized,MAX_UPLOAD} from '../lib/util.js';

async function readForm(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_UPLOAD+512*1024)throw new Error('FILE_TOO_LARGE');
    chunks.push(chunk);
  }
  return new Response(Buffer.concat(chunks),{headers:{'content-type':req.headers['content-type']||''}}).formData();
}

/**
 * Site do candidato: aceita SOMENTE o envio do currículo (POST).
 * Não existe endpoint de pesquisa, download ou exclusão aqui — este projeto
 * só escreve no banco. A consulta fica no sistema interno.
 */
export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Método não permitido.'})}
  if(!authorized(req,res))return;
  try{
    const sql=database();
    await ensureSchema(sql);
    const form=await readForm(req);
    const file=form.get('resume');
    const text=String(form.get('extractedText')||'').slice(0,50000);
    if(!file||typeof file.arrayBuffer!=='function')return res.status(400).json({error:'Currículo obrigatório.'});
    if(file.size>MAX_UPLOAD)return res.status(413).json({error:'O arquivo deve ter até 4 MB.'});

    // Mesmas regras da tela: só PDF ou .docx, e nunca imagem/digitalização.
    const tipo=validarTipo(file.name,file.type);
    if(!tipo.ok)return res.status(400).json({error:tipo.motivo});
    const bytes=Buffer.from(await file.arrayBuffer());
    if(!validarAssinatura(bytes.subarray(0,8),tipo.tipo))return res.status(400).json({error:'O arquivo enviado não é um PDF ou .docx válido.'});
    const exame=avaliarTexto(text,{
      tipo:tipo.tipo,
      paginas:parseInt(form.get('paginas')||'0',10)||0,
      paginasComTexto:parseInt(form.get('paginasComTexto')||'0',10)||0
    });
    if(!exame.ok)return res.status(400).json({error:exame.motivo});

    const candidate=clean(await parseResume(text));
    const id=randomUUID();
    const safeName=(file.name||'curriculo').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w.-]+/g,'_').slice(-120);
    const type=file.type||(/\.pdf$/i.test(file.name)?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    let resumeUrl=`/api/resume?id=${id}`,resumeData=bytes.toString('base64');
    if(process.env.BLOB_READ_WRITE_TOKEN){
      try{
        const blob=await put(`curriculos/${id}-${safeName}`,bytes,{access:'public',addRandomSuffix:true,contentType:type,token:process.env.BLOB_READ_WRITE_TOKEN});
        resumeUrl=blob.url;resumeData=null;
      }catch(error){console.warn('Blob indisponível; usando Postgres.',error?.message)}
    }
    const c=candidate;
    const searchText=buildSearchText(c,text);
    await sql`INSERT INTO candidates(id,name,phone,email,profession,council,council_number,city,state,experience_years,skills,sectors,specialties,employers,education,summary,resume_text,search_text,resume_url,resume_name,resume_type,resume_data)
      VALUES(${id},${c.name},${c.phone},${c.email},${c.profession},${c.council},${c.councilNumber},${c.city},${c.state},${c.experienceYears},${c.skills},${c.sectors},${c.specialties},${c.employers},${c.education},${c.summary},${text},${searchText},${resumeUrl},${file.name||safeName},${type},decode(${resumeData}::text,'base64'))`;
    // O candidato não recebe de volta os dados lidos: só a confirmação.
    return res.status(201).json({ok:true});
  }catch(e){
    console.error(e);
    if(e.message==='FILE_TOO_LARGE')return res.status(413).json({error:'O arquivo deve ter até 4 MB.'});
    if(e.message==='DATABASE_NOT_CONFIGURED')return res.status(503).json({error:'O banco de dados ainda não foi conectado ao projeto Vercel.'});
    return res.status(500).json({error:'Não foi possível enviar seu currículo agora. Tente novamente em alguns minutos.'});
  }
}
