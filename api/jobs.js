import {database,ensureSchema} from '../lib/db.js';

/**
 * Vagas publicadas, espelhadas do portal interno (somente leitura).
 * GET /api/jobs -> { vagas:[...] } apenas com status 'publicada'.
 */
export default async function handler(req,res){
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Método não permitido.'})}
  try{
    const sql=database();
    await ensureSchema(sql);
    const vagas=await sql`
      SELECT id,title,city,state,location,description,salary,contract,created_at
      FROM jobs WHERE status='publicada' ORDER BY created_at DESC LIMIT 200`;
    res.setHeader('cache-control','no-store');
    return res.status(200).json({vagas});
  }catch(e){
    console.error(e);
    if(e.message==='DATABASE_NOT_CONFIGURED')return res.status(503).json({error:'O banco de dados ainda não foi conectado ao projeto Vercel.'});
    return res.status(500).json({error:'Não foi possível carregar as vagas agora.'});
  }
}
