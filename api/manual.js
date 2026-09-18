import {randomUUID} from 'node:crypto';
import {database,ensureSchema} from '../lib/db.js';
import {buildSearchText} from '../lib/extract.js';
import {resumoDoCadastro,validarCadastroManual} from '../lib/cadastro-manual.js';
import {authorized} from '../lib/util.js';
import {criarCandidatura} from './apply.js';

/**
 * Cadastro manual: o candidato digita os dados, sem arquivo de currículo.
 * Grava na mesma tabela `candidates`, com resume_type='manual' para o portal
 * interno saber que não existe arquivo para visualizar ou baixar.
 */
async function lerJson(req){
  if(req.body&&typeof req.body==='object')return req.body;
  let bruto='';
  for await(const parte of req){
    bruto+=parte;
    if(bruto.length>20000)throw new Error('CORPO_GRANDE');
  }
  try{return JSON.parse(bruto||'{}')}catch{return {}}
}

export default async function handler(req,res){
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Método não permitido.'})}
  if(!authorized(req,res))return;
  try{
    const entrada=await lerJson(req);
    const {ok,erros,dados}=validarCadastroManual(entrada);
    if(!ok)return res.status(400).json({error:'Confira os dados informados.',erros});

    const sql=database();
    await ensureSchema(sql);

    const texto=resumoDoCadastro(dados);
    const c={
      name:dados.nome,
      phone:dados.telefone,
      email:dados.email,
      profession:dados.profissao,
      council:'',
      councilNumber:'',
      city:dados.cidade,
      state:dados.estado,
      experienceYears:0,
      skills:'',
      sectors:'',
      specialties:dados.especialidade,
      employers:'',
      education:'',
      summary:dados.especialidade?`${dados.profissao} - ${dados.especialidade}.`:`${dados.profissao}.`
    };
    const id=randomUUID();
    await sql`INSERT INTO candidates(id,name,phone,email,profession,council,council_number,city,state,experience_years,skills,sectors,specialties,employers,education,summary,resume_text,search_text,resume_url,resume_name,resume_type,resume_data)
      VALUES(${id},${c.name},${c.phone},${c.email},${c.profession},${c.council},${c.councilNumber},${c.city},${c.state},${c.experienceYears},${c.skills},${c.sectors},${c.specialties},${c.employers},${c.education},${c.summary},${texto},${buildSearchText(c,texto)},'','Cadastro manual','manual',NULL)`;

    const candidatura=entrada.vagaId?await criarCandidatura(sql,String(entrada.vagaId),id):null;
    return res.status(201).json({ok:true,candidatura:Boolean(candidatura)});
  }catch(e){
    console.error(e);
    if(e.message==='CORPO_GRANDE')return res.status(413).json({error:'Dados muito grandes.'});
    if(e.message==='DATABASE_NOT_CONFIGURED')return res.status(503).json({error:'O banco de dados ainda não foi conectado ao projeto Vercel.'});
    return res.status(500).json({error:'Não foi possível concluir seu cadastro agora. Tente novamente em alguns minutos.'});
  }
}
