import {randomUUID} from 'node:crypto';
import {database,ensureSchema} from '../lib/db.js';

/**
 * Candidatura de quem JÁ tem cadastro no banco de talentos.
 * POST /api/apply { jobId, telefone } ou { jobId, email }
 *
 * Quem ainda não tem cadastro envia o currículo (/api/candidates) ou preenche
 * os dados (/api/manual) informando o mesmo jobId, e a candidatura é criada lá.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lerJson(req){
  if(req.body&&typeof req.body==='object')return req.body;
  let bruto='';
  for await(const parte of req){bruto+=parte;if(bruto.length>10000)throw new Error('CORPO_GRANDE')}
  try{return JSON.parse(bruto||'{}')}catch{return {}}
}

/** Liga um candidato a uma vaga; repetir não duplica. */
export async function criarCandidatura(sql,jobId,candidateId){
  if(!UUID.test(String(jobId||''))||!UUID.test(String(candidateId||'')))return null;
  const [vaga]=await sql`SELECT id FROM jobs WHERE id=${jobId}::uuid AND status='publicada'`;
  if(!vaga)return null;
  const [ja]=await sql`SELECT id FROM applications WHERE job_id=${jobId}::uuid AND candidate_id=${candidateId}::uuid`;
  if(ja)return ja.id;
  const id=randomUUID();
  await sql`INSERT INTO applications(id,job_id,candidate_id,stage) VALUES(${id},${jobId}::uuid,${candidateId}::uuid,'recebido')`;
  return id;
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Método não permitido.'})}
  try{
    const {jobId,telefone,email}=await lerJson(req);
    if(!UUID.test(String(jobId||'')))return res.status(400).json({error:'Vaga inválida. Recarregue a página e tente de novo.'});

    const digitos=String(telefone||'').replace(/\D/g,'');
    const mail=String(email||'').trim().toLowerCase();
    if(digitos.length<10&&!mail)
      return res.status(400).json({error:'Informe o telefone com DDD ou o e-mail usado no seu cadastro.'});

    const sql=database();
    await ensureSchema(sql);

    // Procura pelo fim do telefone (ignora máscara e DDI) ou pelo e-mail.
    const fim=digitos.slice(-8);
    const [candidato]=await sql`
      SELECT id,name FROM candidates
      WHERE (${fim}::text <> '' AND regexp_replace(phone,'[^0-9]','','g') LIKE ${'%'+fim})
         OR (${mail}::text <> '' AND lower(email)=${mail})
      ORDER BY created_at DESC LIMIT 1`;

    if(!candidato)return res.status(404).json({
      error:'Não encontramos um cadastro com esses dados. Envie seu currículo ou preencha seus dados para se candidatar.',
      semCadastro:true
    });

    const id=await criarCandidatura(sql,jobId,candidato.id);
    if(!id)return res.status(404).json({error:'Esta vaga não está mais disponível.'});
    return res.status(201).json({ok:true,nome:candidato.name});
  }catch(e){
    console.error(e);
    if(e.message==='CORPO_GRANDE')return res.status(413).json({error:'Dados muito grandes.'});
    if(e.message==='DATABASE_NOT_CONFIGURED')return res.status(503).json({error:'O banco de dados ainda não foi conectado ao projeto Vercel.'});
    return res.status(500).json({error:'Não foi possível registrar seu interesse agora. Tente novamente em alguns minutos.'});
  }
}
