import {toUF,UFS} from './util.js';

/**
 * Cadastro manual (quando o candidato não tem o currículo em arquivo).
 * As mesmas regras rodam na tela (src/main.jsx) e na API (api/manual.js).
 */

export const ESTADOS=Object.entries(UFS)
  .map(([uf,nome])=>({uf,nome:nome.replace(/\b\w/g,c=>c.toUpperCase())}))
  .sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));

/** Sugestões de profissão (o campo aceita qualquer texto). */
export const PROFISSOES_SUGERIDAS=[
  'Enfermeiro','Enfermeira','Técnico de enfermagem','Auxiliar de enfermagem','Médico','Médica',
  'Fisioterapeuta','Nutricionista','Psicólogo','Farmacêutico','Biomédico','Fonoaudiólogo',
  'Assistente social','Dentista','Terapeuta ocupacional','Técnico em radiologia',
  'Técnico de laboratório','Instrumentador cirúrgico','Cuidador','Recepcionista','Administrativo'
];

export const LIMITES_MANUAL={nome:150,profissao:120,especialidade:120,cidade:100,email:150};

const trim=v=>String(v??'').replace(/\s+/g,' ').trim();
const digitos=v=>String(v??'').replace(/\D/g,'');

/** Telefone brasileiro formatado: (69) 99999-9999. */
export function formatarTelefone(valor){
  const d=digitos(valor).slice(0,11);
  if(d.length<=2)return d;
  if(d.length<=6)return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if(d.length<=10)return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}

/**
 * Valida e normaliza os dados digitados.
 * @returns {{ok:boolean, erros:Object<string,string>, dados:Object}}
 */
export function validarCadastroManual(entrada={}){
  const dados={
    nome:trim(entrada.nome).slice(0,LIMITES_MANUAL.nome),
    profissao:trim(entrada.profissao).slice(0,LIMITES_MANUAL.profissao),
    telefone:formatarTelefone(entrada.telefone),
    email:trim(entrada.email).toLowerCase().slice(0,LIMITES_MANUAL.email),
    especialidade:trim(entrada.especialidade).slice(0,LIMITES_MANUAL.especialidade),
    cidade:trim(entrada.cidade).slice(0,LIMITES_MANUAL.cidade),
    estado:toUF(entrada.estado)
  };
  const erros={};

  if(dados.nome.length<5||dados.nome.split(' ').filter(p=>p.length>1).length<2)
    erros.nome='Informe seu nome completo (nome e sobrenome).';
  if(/\d/.test(dados.nome))erros.nome='O nome não deve conter números.';

  if(dados.profissao.length<3)erros.profissao='Informe sua profissão.';

  const tel=digitos(dados.telefone);
  if(tel.length<10||tel.length>11)erros.telefone='Informe um telefone com DDD, por exemplo (69) 99999-9999.';

  if(dados.email&&!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(dados.email))
    erros.email='E-mail inválido. Confira o endereço digitado.';

  if(dados.cidade.length<2)erros.cidade='Informe a cidade onde você mora.';
  if(!dados.estado)erros.estado='Escolha o estado (UF).';

  return {ok:Object.keys(erros).length===0,erros,dados};
}

/** Texto usado como "currículo" para a busca do portal interno. */
export function resumoDoCadastro(d){
  const partes=[
    `${d.nome} - ${d.profissao}`,
    d.especialidade?`Especialidade/área de atuação: ${d.especialidade}`:'',
    `Cidade: ${d.cidade} - ${d.estado}`,
    d.telefone?`Telefone: ${d.telefone}`:'',
    d.email?`E-mail: ${d.email}`:'',
    'Cadastro preenchido pelo próprio candidato no portal, sem arquivo de currículo.'
  ];
  return partes.filter(Boolean).join('\n');
}
