#!/usr/bin/env node
// Lareira: launcher cozy de modpacks. Um arquivo so, sem dependencias (so a stdlib do Node).
// Ele NAO roda o jogo: instala/atualiza o pack dentro do Minecraft Launcher oficial ou do
// TLauncher e depois abre o launcher escolhido.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

const VERSAO = '1.3.3';
const REPO = 'ramosbezzu/chale-e-engrenagens';
const MANIFESTO_PADRAO = `https://raw.githubusercontent.com/${REPO}/main/manifest/`;
const HOSTS_DOWNLOAD = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com'];
const MARCA = 'lareira.json';
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

// ---------------------------------------------------------------- pastas

const HOME = process.env.LAREIRA_HOME || os.homedir();
const APPDATA = WIN ? (process.env.LAREIRA_HOME ? path.join(HOME, 'AppData', 'Roaming') : process.env.APPDATA) : null;
const LOCAL = WIN ? (process.env.LAREIRA_HOME ? path.join(HOME, 'AppData', 'Local') : process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')) : null;
const SUPORTE = MAC ? path.join(HOME, 'Library', 'Application Support') : null;
const DADOS = process.env.LAREIRA_DADOS
  || (WIN ? path.join(APPDATA, 'Lareira') : MAC ? path.join(SUPORTE, 'Lareira') : path.join(HOME, '.config', 'lareira'));

const existe = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const lerJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
// Grava num arquivo ao lado e troca de uma vez: se o PC desligar no meio (acontece), o arquivo antigo
// continua inteiro em vez de ficar pela metade ou so com bytes nulos.
function gravar(p, texto, codificacao = 'utf8') {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const temp = `${p}.tmp-lareira`;
  try {
    const fd = fs.openSync(temp, 'w');
    try { fs.writeSync(fd, Buffer.from(texto, codificacao)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, p);
  } catch (e) {
    // Destino travado por outro programa (ou disco sem suporte a troca): grava direto, como antes.
    try { fs.unlinkSync(temp); } catch { /* nao ficou */ }
    fs.writeFileSync(p, texto, codificacao);
  }
}
const gravarJSON = (p, v) => gravar(p, JSON.stringify(v, null, 2));
const primeiro = (lista) => lista.find(existe) || null;

// Apaga arquivo ou pasta (recursivo) e nao reclama se nao existir. Nao usa fs.rmSync: no Node 24
// do Windows ele falha calado quando o caminho tem acento (C:\Users\José), e o arquivo fica la.
function apagar(alvoApagar) {
  let info;
  try { info = fs.lstatSync(alvoApagar); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (info.isDirectory()) {
    for (const nome of fs.readdirSync(alvoApagar)) apagar(path.join(alvoApagar, nome));
    fs.rmdirSync(alvoApagar);
  } else fs.unlinkSync(alvoApagar);
}

// O log nao cresce para sempre: passou de 1 MB, fica so a metade mais recente.
function apararLog() {
  const arquivo = path.join(DADOS, 'lareira.log');
  try {
    if (fs.statSync(arquivo).size < 1048576) return;
    const texto = fs.readFileSync(arquivo, 'utf8');
    fs.writeFileSync(arquivo, texto.slice(texto.indexOf('\n', texto.length - 524288) + 1));
  } catch { /* sem log ainda */ }
}

function log(...partes) {
  const linha = `[${new Date().toISOString()}] ${partes.join(' ')}\n`;
  try { fs.mkdirSync(DADOS, { recursive: true }); fs.appendFileSync(path.join(DADOS, 'lareira.log'), linha); } catch { /* sem log */ }
  if (process.env.LAREIRA_VERBOSO) process.stderr.write(linha);
}

// fixado: { <id do pack>: '<versao>' } quando o jogador escolhe ficar na versao anterior.
// oficial: 'store' ou 'classico' para forcar qual Minecraft Launcher abrir no Windows quando ha os dois.
const config = Object.assign({ modo: null, tlauncherExe: null, manifesto: null, fixado: {}, oficial: null }, lerJSON(path.join(DADOS, 'config.json')));
if (!config.fixado || typeof config.fixado !== 'object') config.fixado = {};
const salvarConfig = () => gravarJSON(path.join(DADOS, 'config.json'), config);

// Pasta .minecraft do launcher oficial (onde ficam launcher_profiles.json, versions e libraries).
function pastaOficial() {
  if (WIN) return path.join(APPDATA, '.minecraft');
  if (MAC) return path.join(SUPORTE, 'minecraft');
  return primeiro([path.join(HOME, '.minecraft'), path.join(HOME, '.var', 'app', 'com.mojang.Minecraft', '.minecraft')])
    || path.join(HOME, '.minecraft');
}

function arquivoTLauncher() {
  const nome = 'tlauncher-2.0.properties';
  if (WIN) return path.join(APPDATA, '.tlauncher', nome);
  if (MAC) return primeiro([path.join(SUPORTE, 'tlauncher', nome), path.join(HOME, '.tlauncher', nome)]) || path.join(SUPORTE, 'tlauncher', nome);
  return path.join(HOME, '.tlauncher', nome);
}

// Pasta do jogo que o TLauncher usa (Configuracoes > Diretorio). O arquivo e um .properties em Latin-1.
function pastaTLauncher() {
  let dir = pastaOficial();
  try {
    const linha = fs.readFileSync(arquivoTLauncher(), 'latin1').split(/\r?\n/).find((l) => l.startsWith('minecraft.gamedir='));
    const valor = linha && linha.slice('minecraft.gamedir='.length).replace(/\\(.)/g, '$1').trim();
    if (valor) dir = valor;
  } catch { /* usa o padrao */ }
  return dir;
}

function launchers() {
  const raiz = pastaOficial();
  const tl = existe(arquivoTLauncher());
  let arquivos = [];
  try { arquivos = fs.readdirSync(raiz); } catch { /* pasta nao existe */ }
  // O TLauncher tambem cria launcher_profiles.json; os arquivos de conta so o oficial cria.
  const conta = arquivos.some((a) => /^launcher_(accounts|msa_credentials|settings)/.test(a));
  const oficial = arquivos.includes('launcher_profiles.json') && (conta || !tl);
  return {
    oficial: { presente: oficial, pasta: raiz },
    tlauncher: { presente: tl, pasta: tl ? pastaTLauncher() : null },
  };
}

function modoAtual(packs) {
  const l = launchers();
  if (config.modo && l[config.modo].presente) return config.modo;
  if (l.oficial.presente && l.tlauncher.presente) {
    // Os dois existem: fica com aquele onde algum pack ja esta instalado.
    for (const modo of ['oficial', 'tlauncher']) if ((packs || []).some((p) => instalado(p, modo))) return modo;
  }
  return l.oficial.presente ? 'oficial' : l.tlauncher.presente ? 'tlauncher' : null;
}

// raiz = onde ficam versions/libraries; jogo = onde ficam mods, config e saves.
function alvo(pack, modo) {
  if (modo === 'oficial') {
    const raiz = pastaOficial();
    return { raiz, jogo: path.join(path.dirname(raiz), pack.pasta) };
  }
  const jogo = pastaTLauncher();
  return { raiz: jogo, jogo };
}

// ---------------------------------------------------------------- manifesto

const baseManifesto = () => process.env.LAREIRA_MANIFESTO || config.manifesto || MANIFESTO_PADRAO;
const cmpVersao = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

// O raw.githubusercontent.com guarda cada arquivo por ate 5 minutos em cada servidor do CDN, e o "main"
// podia continuar mostrando a versao anterior depois de publicada (cache: 'no-store' nao passa por cima).
// Por isso o Lareira pergunta ao git do GitHub (sem cache) qual e o commit atual do main e baixa o
// manifesto daquele commit: cada publicacao vira um endereco novo. Se o git nao responder, usa o main.
async function baseAtual() {
  const base = baseManifesto();
  if (base !== MANIFESTO_PADRAO) return base;
  try {
    const r = await fetch(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const m = r.ok && (await r.text()).match(/([0-9a-f]{40}) refs\/heads\/main\n/);
    if (m) return `https://raw.githubusercontent.com/${REPO}/${m[1]}/manifest/`;
    log('commit do main: resposta inesperada', r.status);
  } catch (e) { log('commit do main:', e.message); }
  return base;
}

async function baixarTexto(base, nome) {
  if (!/^https?:/.test(base)) return fs.readFileSync(path.join(base, nome), 'utf8');
  const r = await fetch(base + nome, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${nome}`);
  return r.text();
}

const relSeguro = (rel, prefixos) => typeof rel === 'string' && !/[\\:]|^\/|(^|\/)\.\.(\/|$)/.test(rel)
  && prefixos.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p) && rel.length > p.length));

// O manifesto vem da internet: tudo que vira caminho ou comando e validado antes de usar.
// Parte que muda a cada versao do pack (a atual fica na raiz do manifesto, as outras em "anteriores").
const arquivoValido = (prefixos) => (a) => {
  let url; try { url = new URL(a.url); } catch { return false; }
  return relSeguro(a.caminho, prefixos) && /^[0-9a-f]{40}$/.test(a.sha1)
    && url.protocol === 'https:' && HOSTS_DOWNLOAD.includes(url.hostname);
};
// "pacotes" (pacotes de recursos) fica fora de "arquivos" porque o Lareira 1.0.0 recusa o
// manifesto inteiro se "arquivos" tiver algo fora de mods/ e shaderpacks/.
function versaoValida(v) {
  return !!v && /^\d+(\.\d+)*$/.test(v.versao) && /^\d+(\.\d+)*(-beta)?$/.test(v.neoforge) && /^\d+(\.\d+)*$/.test(v.minecraft)
    && Array.isArray(v.arquivos) && v.arquivos.every(arquivoValido(['mods/', 'shaderpacks/']))
    && (v.pacotes || []).every(arquivoValido(['resourcepacks/']))
    && (v.configs || []).every((c) => relSeguro(c.caminho, ['config/', 'options.txt']) && typeof c.conteudo === 'string')
    && (v.ajustes || []).every((a) => relSeguro(a.arquivo, ['config/', 'options.txt']) && typeof a.de === 'string' && typeof a.para === 'string');
}

// Notas de versao: so texto e fotos do CDN do Modrinth (a janela carrega as imagens direto de la).
const FOTOS = ['cdn.modrinth.com'];
const textos = (l) => (Array.isArray(l) ? l.filter((t) => typeof t === 'string') : []);
function fotos(lista) {
  return (Array.isArray(lista) ? lista : []).filter((f) => {
    let url; try { url = new URL(f.url); } catch { return false; }
    return url.protocol === 'https:' && FOTOS.includes(url.hostname);
  }).map((f) => ({ url: f.url, legenda: typeof f.legenda === 'string' ? f.legenda : '' }));
}
function limparEntrada(h) {
  const t = (x) => (typeof x === 'string' ? x : '');
  return {
    versao: t(h.versao), data: t(h.data), titulo: t(h.titulo), tema: t(h.tema), mensagem: t(h.mensagem), despedida: t(h.despedida),
    novidades: textos(h.novidades), compativel: textos(h.compativel), incompativel: textos(h.incompativel),
    secoes: (Array.isArray(h.secoes) ? h.secoes : []).map((s) => ({ titulo: t(s.titulo), itens: textos(s.itens), fotos: fotos(s.fotos) })),
  };
}

function validarPack(p) {
  const ok = p && p.formato === 1
    && /^[a-z0-9-]+$/.test(p.id) && /^[a-z0-9-]+$/.test(p.perfil) && /^\.minecraft-[a-z0-9-]+$/.test(p.pasta)
    && (!p.marcadorAntigo || /^[a-z0-9.-]+\.txt$/.test(p.marcadorAntigo))
    && versaoValida(p) && (p.anteriores || []).every(versaoValida);
  if (!ok) throw new Error(`manifesto invalido: ${p && p.id}`);
  p.historico = (Array.isArray(p.historico) ? p.historico : []).map(limparEntrada);
  p.anteriores = p.anteriores || [];
  for (const v of [p, ...p.anteriores]) { v.configs = v.configs || []; v.ajustes = v.ajustes || []; v.pacotes = v.pacotes || []; }
  return p;
}

// O pack "visto" numa versao especifica (a atual ou uma anterior), ou null se ela nao esta no manifesto.
function variante(pack, versao) {
  if (!versao || versao === pack.versao) return pack;
  const anterior = pack.anteriores.find((a) => a.versao === versao);
  return anterior ? { ...pack, ...anterior } : null;
}
// A versao que o jogador quer: a fixada (se ainda existir no manifesto) ou a mais nova.
const escolhida = (pack) => variante(pack, config.fixado[pack.id]) || pack;

const remoto = { packs: [], launcher: null, offline: false, erro: null };

// Parte "launcher" do index.json: versao mais nova do Lareira, pagina de download e o changelog dele
// (launcher/historico.json, que o build.py copia para o index.json).
const saoTextos = (v) => Array.isArray(v) && v.every((t) => typeof t === 'string');
function validarLauncher(l) {
  if (!l || !/^\d+(\.\d+)*$/.test(l.versao)) return null;
  const historico = (Array.isArray(l.historico) ? l.historico : []).filter((h) => h && /^\d+(\.\d+)*$/.test(h.versao)
    && typeof (h.titulo || '') === 'string' && typeof (h.data || '') === 'string' && saoTextos(h.novidades || []));
  return { ...l, historico };
}
// Entradas do changelog do Lareira entre duas versoes: (de, ate].
const novidadesLareira = (de, ate) => ((remoto.launcher && remoto.launcher.historico) || [])
  .filter((h) => cmpVersao(h.versao, de) > 0 && cmpVersao(h.versao, ate) <= 0);
// Versao do Lareira que rodou antes neste PC, quando ela era mais velha que esta (ou '?' se nao se sabe qual).
let lareiraAntes = null;

async function carregarManifesto() {
  const cache = path.join(DADOS, 'cache');
  let textos;
  try {
    const base = await baseAtual();
    const index = await baixarTexto(base, 'index.json');
    const idx = JSON.parse(index);
    if (idx.formato !== 1) throw new Error('Este launcher e antigo demais para o manifesto atual. Baixe a versao nova.');
    textos = { 'index.json': index };
    for (const p of idx.packs) {
      if (!/^[a-z0-9-]+\.json$/.test(p.arquivo)) throw new Error('manifesto invalido');
      textos[p.arquivo] = await baixarTexto(base, p.arquivo);
    }
    fs.mkdirSync(cache, { recursive: true });
    for (const [nome, texto] of Object.entries(textos)) gravar(path.join(cache, nome), texto);
    remoto.offline = false; remoto.erro = null;
  } catch (e) {
    // Sem internet (ou GitHub fora): usa a ultima copia boa.
    log('manifesto:', e.message);
    remoto.offline = true; remoto.erro = e.message;
    textos = {};
    for (const nome of existe(cache) ? fs.readdirSync(cache) : []) textos[nome] = fs.readFileSync(path.join(cache, nome), 'utf8');
    if (!textos['index.json']) { remoto.packs = []; return; }
  }
  try {
    const idx = JSON.parse(textos['index.json']);
    const packs = idx.packs.filter((p) => textos[p.arquivo]).map((p) => validarPack(JSON.parse(textos[p.arquivo])));
    remoto.launcher = validarLauncher(idx.launcher);
    remoto.packs = packs;
  } catch (e) {
    // Copia salva estragada (PC desligou enquanto gravava): fica com o que ja estava na memoria.
    log('manifesto salvo ilegivel:', e.message);
    remoto.offline = true; remoto.erro = remoto.erro || e.message;
  }
}

// ---------------------------------------------------------------- estado

const jarsEm = (pasta) => { try { return fs.readdirSync(pasta).filter((f) => f.endsWith('.jar')); } catch { return []; } };

// Versao do pack instalada na pasta do modo escolhido, ou null.
function instalado(pack, modo) {
  const { jogo } = alvo(pack, modo);
  const marca = lerJSON(path.join(jogo, MARCA));
  if (marca) return marca.pack === pack.id ? { versao: marca.versao } : null;
  if (pack.marcadorAntigo) {
    try {
      const m = fs.readFileSync(path.join(jogo, pack.marcadorAntigo), 'utf8').match(/(\d+\.\d+\.\d+)/);
      if (m) return { versao: m[1] };
    } catch { /* sem marcador antigo */ }
  }
  // Pasta exclusiva do pack (launcher oficial) com mods mas sem marcador: instalacao antiga.
  if (modo === 'oficial' && jarsEm(path.join(jogo, 'mods')).length) return { versao: null };
  return null;
}

function estadoPack(pack, modo) {
  const v = escolhida(pack);
  const base = {
    id: pack.id, nome: pack.nome, resumo: pack.resumo, historico: pack.historico,
    versao: v.versao, maisNova: pack.versao, fixada: v !== pack, versoes: [pack.versao, ...pack.anteriores.map((a) => a.versao)],
    minecraft: v.minecraft, neoforge: v.neoforge, mods: v.arquivos.filter((a) => a.caminho.startsWith('mods/')).length,
    tamanho: [...v.arquivos, ...v.pacotes].reduce((s, a) => s + (a.tamanho || 0), 0),
  };
  if (!modo) return { ...base, estado: 'sem-launcher' };
  const { jogo } = alvo(pack, modo);
  const inst = instalado(pack, modo);
  const tem = new Set(jarsEm(path.join(jogo, 'mods')));
  const quer = new Set(v.arquivos.filter((a) => a.caminho.startsWith('mods/')).map((a) => path.posix.basename(a.caminho)));
  const outro = modo === 'tlauncher' && !inst ? (lerJSON(path.join(jogo, MARCA)) || {}).nome || null : null;
  return {
    ...base, pasta: jogo, instalada: inst ? inst.versao || 'desconhecida' : null, outroPack: outro,
    estado: !inst ? 'ausente' : inst.versao === v.versao ? 'ok' : 'atualizar',
    // volta = a versao escolhida e mais antiga que a instalada (voltar para a anterior)
    volta: !!(inst && inst.versao && cmpVersao(v.versao, inst.versao) < 0),
    entram: [...quer].filter((f) => !tem.has(f)).length,
    saem: inst ? [...tem].filter((f) => !quer.has(f)).length : 0,
    // Primeira vez no TLauncher: os mods que ja estavam la vao para uma pasta de backup.
    guardaMods: modo === 'tlauncher' && !inst && !lerJSON(path.join(jogo, MARCA)) ? tem.size : 0,
  };
}

let tarefa = null; // { pack, fase, feito, total, erro, fim, aviso }

function estado() {
  const l = launchers();
  const modo = modoAtual(remoto.packs);
  const nova = remoto.launcher && cmpVersao(remoto.launcher.versao, VERSAO) > 0 ? remoto.launcher : null;
  return {
    versao: VERSAO, novaVersao: nova, autoAtualizacao: auto, offline: remoto.offline, erroManifesto: remoto.erro,
    lareira: {
      historico: remoto.launcher ? remoto.launcher.historico : [],
      // o que muda na versao nova que esta chegando
      novidadesNova: nova ? novidadesLareira(VERSAO, nova.versao) : [],
      // acabou de atualizar: o que mudou desde a versao que estava (so a atual quando nao se sabe qual era)
      atualizado: lareiraAntes ? {
        de: lareiraAntes === '?' ? null : lareiraAntes,
        novidades: lareiraAntes === '?' ? novidadesLareira('0', VERSAO).filter((h) => h.versao === VERSAO) : novidadesLareira(lareiraAntes, VERSAO),
      } : null,
    },
    launchers: l, modo, ramGB: Math.round(os.totalmem() / 2 ** 30), xmx: xmxGB(),
    packs: remoto.packs.map((p) => estadoPack(p, modo)), tarefa,
  };
}

function xmxGB() {
  const ram = Math.round(os.totalmem() / 2 ** 30);
  return ram >= 16 ? 6 : ram >= 12 ? 5 : ram >= 8 ? 4 : 3;
}

// ---------------------------------------------------------------- processos

function rodar(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; if (opts.aoLer) opts.aoLer(String(d)); });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('error', reject);
    filho.on('close', (codigo) => (codigo === 0 ? resolve(saida) : reject(new Error(`${path.basename(cmd)} saiu com codigo ${codigo}: ${saida.slice(-400)}`))));
  });
}

function soltar(cmd, args) {
  const filho = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
  filho.on('error', (e) => log('falha ao abrir', cmd, e.message));
  filho.unref();
}

// Launcher ou jogo aberto? Com eles abertos os .jar ficam travados e o launcher oficial
// regrava o launcher_profiles.json ao fechar, desfazendo o perfil.
function jogoAberto() {
  if (process.env.LAREIRA_TESTE) return false; // teste.js roda mesmo com o jogo aberto na maquina
  try {
    if (WIN) {
      const lista = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'latin1' }).toLowerCase();
      return ['"minecraftlauncher.exe"', '"minecraft.exe"', '"tlauncher.exe"', '"javaw.exe"'].some((n) => lista.includes(n));
    }
    const lista = execFileSync('ps', ['-Ao', 'args='], { encoding: 'utf8' });
    // Padroes estreitos (executavel do launcher, .jar do TLauncher, classe principal do jogo) para
    // nao confundir com um editor ou terminal que so tenha "minecraft" no caminho.
    return /(^|\/)minecraft-launcher( |$)|Minecraft\.app\/|TLauncher\.app\/|tlauncher[^\s/]*\.(jar|exe)( |$)|cpw\.mods\.bootstraplauncher|net\.minecraft\.client\.main/im.test(lista);
  } catch (e) { log('jogoAberto:', e.message); return false; }
}

// Abre pasta, link ou programa com o que o sistema associar. No Windows vai pelo rundll32 e nao
// pelo "cmd /c start", que interpreta & e % no caminho e pisca uma janela preta.
function abrirNoSistema(alvoAbrir) {
  if (WIN) soltar('rundll32', ['url.dll,FileProtocolHandler', alvoAbrir]);
  else soltar(MAC ? 'open' : 'xdg-open', [alvoAbrir]);
}

const noPath = (nome) => (process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, nome)).find(existe) || null;

// No Windows existem dois Minecraft Launcher: o atual (Microsoft Store / app Xbox) e o classico (.msi,
// em Arquivos de Programas). Muita gente tem os dois instalados, e a conta costuma estar so no da Store.
const PACOTE_STORE = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe';
function oficiaisWindows() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, 'C:\\Program Files (x86)', 'C:\\Program Files'].filter(Boolean);
  return {
    store: !!LOCAL && existe(path.join(LOCAL, 'Packages', PACOTE_STORE)),
    classico: primeiro(pf.map((p) => path.join(p, 'Minecraft Launcher', 'MinecraftLauncher.exe'))),
  };
}
// Qual abrir: o que o jogador fixou em config.json ("oficial"), senao o da Store, senao o classico.
function escolherOficial({ store, classico }, preferido) {
  if (preferido === 'classico' && classico) return 'classico';
  if (preferido === 'store' && store) return 'store';
  return store || !classico ? 'store' : 'classico';
}

function abrirOficial() {
  if (WIN) {
    const achados = oficiaisWindows();
    const qual = escolherOficial(achados, config.oficial);
    log(`abrindo o Minecraft Launcher (${qual}; store=${achados.store}, classico=${achados.classico || 'nao'})`);
    if (qual === 'classico') soltar(achados.classico, []);
    // O da Store e um app empacotado: abre pelo atalho do sistema, nao pelo .exe direto.
    else soltar('explorer.exe', [`shell:AppsFolder\\${PACOTE_STORE}!Minecraft`]);
    return true;
  }
  if (MAC) { soltar('open', ['-a', 'Minecraft']); return true; }
  const bin = noPath('minecraft-launcher');
  if (bin) { soltar(bin, []); return true; }
  if (existe(path.join(HOME, '.var', 'app', 'com.mojang.Minecraft')) && noPath('flatpak')) { soltar('flatpak', ['run', 'com.mojang.Minecraft']); return true; }
  return false;
}

// O TLauncher nao tem lugar fixo: procura nos lugares comuns (ou usa o caminho salvo em config.json).
function acharTLauncher() {
  if (config.tlauncherExe && existe(config.tlauncherExe)) return config.tlauncherExe;
  if (MAC && existe('/Applications/TLauncher.app')) return '/Applications/TLauncher.app';
  const pastas = WIN
    ? [path.join(APPDATA, '.minecraft'), path.join(APPDATA, '.tlauncher'), pastaTLauncher(),
      ...['Desktop', 'OneDrive\\Desktop', 'OneDrive\\Área de Trabalho', 'Downloads'].map((d) => path.join(HOME, d)), 'C:\\Users\\Public\\Desktop']
    : [...['Desktop', 'Área de Trabalho', 'Downloads', 'Applications', ''].map((d) => path.join(HOME, d)), '/Applications', '/opt/tlauncher'];
  const ordem = WIN ? ['.exe', '.lnk', '.jar'] : ['.app', '.jar', '.desktop'];
  for (const ext of ordem) {
    for (const pasta of pastas) {
      let nomes = [];
      try { nomes = fs.readdirSync(pasta); } catch { continue; }
      const achado = nomes.find((n) => /^tlauncher/i.test(n) && n.toLowerCase().endsWith(ext));
      if (achado) return path.join(pasta, achado);
    }
  }
  return null;
}

function abrirTLauncher() {
  const exe = acharTLauncher();
  if (!exe) return false;
  if (!WIN && exe.endsWith('.jar')) {
    const java = noPath('java') || javaProprio();
    if (!java) return false;
    soltar(java, ['-jar', exe]);
  } else abrirNoSistema(exe);
  return true;
}

// ---------------------------------------------------------------- downloads

async function baixarArquivo(url, destino, sha1, aoBaixar, algoritmo = 'sha1') {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parte = destino + '.parte';
  let ultimo;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let lidos = 0;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const hash = crypto.createHash(algoritmo);
      const saida = fs.createWriteStream(parte);
      for await (const pedaco of r.body) {
        hash.update(pedaco); lidos += pedaco.length;
        if (aoBaixar) aoBaixar(pedaco.length);
        if (!saida.write(pedaco)) await new Promise((ok) => saida.once('drain', ok));
      }
      await new Promise((ok, falha) => saida.end((e) => (e ? falha(e) : ok())));
      if (sha1 && hash.digest('hex') !== sha1) throw new Error(`arquivo corrompido (${algoritmo} diferente)`);
      fs.renameSync(parte, destino);
      return;
    } catch (e) {
      ultimo = e;
      if (aoBaixar) aoBaixar(-lidos);
      try { apagar(parte); } catch { /* nada */ }
      await new Promise((ok) => setTimeout(ok, 1500 * (tentativa + 1)));
    }
  }
  throw new Error(`Falha ao baixar ${path.basename(destino)}: ${ultimo.message}`);
}

const sha1Arquivo = (arquivo) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha1');
  fs.createReadStream(arquivo).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
});

async function emParalelo(itens, limite, fn) {
  const fila = itens.slice();
  await Promise.all(Array.from({ length: Math.min(limite, fila.length) }, async () => {
    while (fila.length) await fn(fila.shift());
  }));
}

// ---------------------------------------------------------------- java + neoforge

function acharJava(pasta, nivel = 0) {
  let itens = [];
  try { itens = fs.readdirSync(pasta, { withFileTypes: true }); } catch { return null; }
  const bin = path.join(pasta, 'bin', WIN ? 'java.exe' : 'java');
  if (existe(bin)) return bin;
  if (nivel > 4) return null;
  for (const item of itens) {
    if (!item.isDirectory()) continue;
    const achado = acharJava(path.join(pasta, item.name), nivel + 1);
    if (achado) return achado;
  }
  return null;
}
const javaProprio = () => acharJava(path.join(DADOS, 'java'));

// O instalador do NeoForge precisa de Java. Para nao depender do que ha no PC, o Lareira
// baixa um JRE 21 (Eclipse Temurin) para a pasta dele, uma vez so.
async function garantirJava(fase) {
  let java = javaProprio();
  if (java) return java;
  fase('Baixando Java 21 (só na primeira vez)...');
  const so = WIN ? 'windows' : MAC ? 'mac' : 'linux';
  const arq = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const pasta = path.join(DADOS, 'java');
  apagar(pasta);
  fs.mkdirSync(pasta, { recursive: true });
  const pacote = path.join(pasta, WIN ? 'jre.zip' : 'jre.tar.gz');
  await baixarArquivo(`https://api.adoptium.net/v3/binary/latest/21/ga/${so}/${arq}/jre/hotspot/normal/eclipse`, pacote, null, null);
  await rodar('tar', ['-xf', pacote, '-C', pasta]); // o tar do Windows 10+ tambem abre .zip
  apagar(pacote);
  java = javaProprio();
  if (!java) throw new Error('Não consegui preparar o Java 21.');
  return java;
}

async function garantirNeoForge(pack, raiz, fase) {
  const id = `neoforge-${pack.neoforge}`;
  if (existe(path.join(raiz, 'versions', id, `${id}.json`))) return;
  const java = await garantirJava(fase);
  fase(`Instalando NeoForge ${pack.neoforge} (pode levar alguns minutos)...`);
  const jar = path.join(DADOS, 'cache', `${id}-installer.jar`);
  await baixarArquivo(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${pack.neoforge}/${id}-installer.jar`, jar, null, null);
  // O instalador exige um launcher_profiles.json na pasta (o TLauncher nem sempre tem).
  const perfis = path.join(raiz, 'launcher_profiles.json');
  fs.mkdirSync(raiz, { recursive: true });
  if (!existe(perfis)) gravarJSON(perfis, { profiles: {} });
  const antes = lerJSON(perfis);
  await rodar(java, ['-jar', jar, '--installClient', raiz], { cwd: path.join(DADOS, 'cache') });
  // O instalador cria um perfil "NeoForge" generico; o Lareira cria o dele, entao esse sai.
  const depois = lerJSON(perfis);
  if (antes && depois && depois.profiles) {
    for (const k of Object.keys(depois.profiles)) if (!(k in (antes.profiles || {}))) delete depois.profiles[k];
    gravarJSON(perfis, depois);
  }
  if (!existe(path.join(raiz, 'versions', id, `${id}.json`))) throw new Error('O instalador do NeoForge terminou sem criar a versão.');
}

// ---------------------------------------------------------------- perfil / tlauncher

const mesmoCaminho = (a, b) => !!a && !!b && (WIN ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

// Um perfil so por pack, com a versao no nome. Mantem a RAM que o jogador ja configurou.
function perfilOficial(pack, raiz, jogo, versaoNoNome) {
  const arquivos = fs.readdirSync(raiz).filter((a) => /^launcher_profiles(_microsoft_store)?\.json$/.test(a));
  for (const nome of arquivos) {
    const arquivo = path.join(raiz, nome);
    const json = lerJSON(arquivo);
    if (!json) continue;
    if (!existe(arquivo + '.bak-lareira')) fs.copyFileSync(arquivo, arquivo + '.bak-lareira');
    json.profiles = json.profiles || {};
    const antigo = json.profiles[pack.perfil];
    for (const [k, p] of Object.entries(json.profiles)) {
      if (k !== pack.perfil && mesmoCaminho(p.gameDir, jogo)) delete json.profiles[k];
    }
    const agora = new Date().toISOString();
    json.profiles[pack.perfil] = {
      ...(antigo || {}),
      created: (antigo && antigo.created) || agora,
      gameDir: jogo,
      icon: (antigo && antigo.icon) || pack.icone || 'Furnace',
      javaArgs: (antigo && antigo.javaArgs) || `-Xmx${xmxGB()}G -Xms2G`,
      lastUsed: agora, // o launcher abre com o perfil usado por ultimo ja selecionado
      lastVersionId: `neoforge-${pack.neoforge}`,
      name: `${pack.nome} ${versaoNoNome}`,
      type: 'custom',
    };
    gravarJSON(arquivo, json);
  }
}

// Deixa a versao NeoForge selecionada no TLauncher.
function versaoTLauncher(pack) {
  const arquivo = arquivoTLauncher();
  if (!existe(arquivo)) return;
  const texto = fs.readFileSync(arquivo, 'latin1');
  if (!existe(arquivo + '.bak-lareira')) fs.copyFileSync(arquivo, arquivo + '.bak-lareira');
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const linhas = texto.split(/\r?\n/);
  const nova = `login.version.game=neoforge-${pack.neoforge}`;
  const i = linhas.findIndex((l) => l.startsWith('login.version.game='));
  if (i >= 0) linhas[i] = nova; else linhas.splice(linhas[linhas.length - 1] === '' ? linhas.length - 1 : linhas.length, 0, nova);
  gravar(arquivo, linhas.join(eol), 'latin1');
}

// ---------------------------------------------------------------- instalar / atualizar

async function sincronizar(pack, modo, avisar) {
  const { raiz, jogo } = alvo(pack, modo);
  const fase = (texto) => { tarefa.fase = texto; log(texto); avisar(); };
  if (jogoAberto()) throw new Error('Feche o jogo e o launcher (Minecraft Launcher ou TLauncher) e tente de novo.');
  log(`sincronizando ${pack.id} ${pack.versao} em ${jogo} (${modo})`);
  fs.mkdirSync(jogo, { recursive: true });

  const primeira = !instalado(pack, modo);
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  if (modo === 'tlauncher' && primeira && !existe(path.join(jogo, MARCA))) {
    // Pasta compartilhada com outros mods: guarda o que ja existia antes de trocar.
    const mods = path.join(jogo, 'mods');
    if (existe(mods) && fs.readdirSync(mods).length) {
      fs.renameSync(mods, path.join(jogo, `mods-antes-do-lareira-${carimbo}`));
      tarefa.aviso = `Os mods que estavam no TLauncher foram guardados em mods-antes-do-lareira-${carimbo}.`;
    }
    const opcoes = path.join(jogo, 'options.txt');
    if (existe(opcoes)) fs.renameSync(opcoes, path.join(jogo, `options-antes-do-lareira-${carimbo}.txt`));
  }

  await garantirNeoForge(pack, raiz, fase);

  fase('Conferindo arquivos...');
  const faltam = [];
  const marcaAntiga = lerJSON(path.join(jogo, MARCA)) || {};
  for (const a of [...pack.arquivos, ...pack.pacotes]) {
    const destino = path.join(jogo, a.caminho);
    let ok = false;
    try { ok = fs.statSync(destino).size === a.tamanho && (await sha1Arquivo(destino)) === a.sha1; } catch { /* nao existe */ }
    if (!ok) faltam.push(a);
  }
  tarefa.total = faltam.reduce((s, a) => s + a.tamanho, 0);
  tarefa.feito = 0;
  let restam = faltam.length;
  if (restam) fase(`Baixando ${restam} arquivo(s)...`);
  await emParalelo(faltam, 6, async (a) => {
    await baixarArquivo(a.url, path.join(jogo, a.caminho), a.sha1, (n) => { tarefa.feito += n; avisar(); });
    restam--;
    tarefa.fase = restam ? `Baixando, faltam ${restam} arquivo(s)...` : 'Finalizando...';
    avisar();
  });

  // Mods: espelho exato do pack, senao host e convidado ficam diferentes.
  const quer = new Set(pack.arquivos.filter((a) => a.caminho.startsWith('mods/')).map((a) => path.posix.basename(a.caminho)));
  for (const jar of jarsEm(path.join(jogo, 'mods'))) if (!quer.has(jar)) apagar(path.join(jogo, 'mods', jar));
  // Pacotes de recursos: so remove os que o proprio Lareira instalou (os do jogador ficam).
  const pacotes = pack.pacotes.map((a) => a.caminho);
  for (const velho of Array.isArray(marcaAntiga.pacotes) ? marcaAntiga.pacotes : []) {
    if (!pacotes.includes(velho) && relSeguro(velho, ['resourcepacks/'])) apagar(path.join(jogo, velho));
  }

  // Configs: so o que ainda nao existe (preserva os ajustes do jogador)...
  for (const c of pack.configs) {
    const destino = path.join(jogo, c.caminho);
    if (existe(destino)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, c.conteudo);
  }
  // ...menos os ajustes que o pack sempre impoe.
  for (const a of pack.ajustes) {
    const arquivo = path.join(jogo, a.arquivo);
    if (!existe(arquivo)) continue;
    const texto = fs.readFileSync(arquivo, 'utf8');
    if (texto.includes(a.de)) fs.writeFileSync(arquivo, texto.split(a.de).join(a.para));
  }

  if (modo === 'oficial') perfilOficial(pack, raiz, jogo, pack.versao); else versaoTLauncher(pack);
  gravarJSON(path.join(jogo, MARCA), { pack: pack.id, nome: pack.nome, versao: pack.versao, modo, pacotes, em: new Date().toISOString() });
  log(`pronto: ${pack.id} ${pack.versao}`);
}

function jogar(pack, modo) {
  const { raiz, jogo } = alvo(pack, modo);
  const inst = instalado(pack, modo);
  if (!inst) throw new Error('Instale o pack primeiro.');
  const aberto = jogoAberto();
  const v = variante(pack, inst.versao) || escolhida(pack); // o NeoForge certo e o da versao instalada
  if (!aberto) {
    // Deixa o perfil/versao do pack ja selecionado no launcher.
    try { if (modo === 'oficial') perfilOficial(v, raiz, jogo, inst.versao || v.versao); else versaoTLauncher(v); } catch (e) { log('jogar:', e.message); }
  }
  const abriu = modo === 'oficial' ? abrirOficial() : abrirTLauncher();
  const perfil = `${pack.nome} ${inst.versao || v.versao}`;
  if (modo === 'oficial') {
    return abriu ? `Abrindo o Minecraft Launcher. Escolha o perfil "${perfil}" e clique em Jogar.`
      : `Não achei o Minecraft Launcher. Abra você mesmo e escolha o perfil "${perfil}".`;
  }
  const dica = `Escolha a versão neoforge-${v.neoforge} e deixe ${xmxGB()} GB de memória nas configurações.`;
  return abriu ? `Abrindo o TLauncher. ${dica}` : `Não achei o TLauncher. Abra você mesmo. ${dica}`;
}

// ---------------------------------------------------------------- auto-atualizacao do proprio Lareira
// Ao abrir, se o manifesto anuncia um Lareira mais novo, baixa o executavel do release no GitHub,
// confere o sha256 (lista atualizacao.json que o GitHub Actions publica junto), troca o arquivo e
// reinicia na mesma porta. Onde nao da para trocar (.deb, pasta sem permissao, rodando do codigo-fonte),
// fica o aviso com o botao Baixar.
const RELEASES = process.env.LAREIRA_RELEASES || `https://github.com/${REPO}/releases/download`;
const auto = { fase: null, versao: null, feito: 0, total: 0, erro: null }; // fase: baixando | reiniciando | erro | manual

// Arquivo do release para este sistema e como ele vira o Lareira instalado.
function pacoteDoSistema(versao, plataforma = process.platform, arq = process.arch) {
  const a = arq === 'arm64' ? 'arm64' : 'x64';
  if (plataforma === 'win32') return { nome: `Lareira-${versao}-windows-${a}.exe`, tipo: 'exe' };
  if (plataforma === 'darwin') return { nome: `Lareira-${versao}-mac-${a}.zip`, tipo: 'app' };
  if (plataforma === 'linux') return { nome: `Lareira-${versao}-linux-${a}.tar.gz`, tipo: 'tar' };
  return null;
}

function infoAtualizacao(info, versao, nome) {
  const a = info && info.formato === 1 && info.versao === versao && info.arquivos && info.arquivos[nome];
  return a && /^[0-9a-f]{64}$/.test(a.sha256) && Number.isInteger(a.tamanho) && a.tamanho > 0 ? a : null;
}

// O que e trocado: o executavel (Windows, .tar.gz do Linux) ou a pasta Lareira.app (mac).
function alvoAtualizacao() {
  if (!sea || process.env.LAREIRA_TESTE || process.env.LAREIRA_SEM_AUTOATUALIZAR) return null;
  const alvo = MAC ? path.resolve(process.execPath, '..', '..', '..') : process.execPath;
  if (MAC && !alvo.endsWith('.app')) return null;
  try { fs.accessSync(path.dirname(alvo), fs.constants.W_OK); } catch { return null; } // .deb em /opt, app em pasta protegida
  return alvo;
}

async function conferirExecutavel(exe, versao) {
  let saida;
  try { saida = (await rodar(exe, ['--versao'], { timeout: 90000 })).trim(); } catch (e) { throw new Error(`o arquivo baixado não abriu (${e.message.slice(0, 120)})`); }
  if (saida !== versao) throw new Error(`o arquivo baixado não é a versão ${versao}`);
}

// Nome para onde o executavel em uso e movido. O .velho de uma troca anterior pode ainda estar travado
// (processo antigo fechando): ai usa outro nome, e limparSobras apaga todos depois.
function nomeLivre(base) {
  try { apagar(base); return base; } catch { return `${base}-${Date.now()}`; }
}

let ultimoAuto = 0;
function avisarAuto() {
  if (Date.now() - ultimoAuto < 250) return;
  ultimoAuto = Date.now();
  enviarEstado();
}

async function autoAtualizar(versao) {
  const alvo = alvoAtualizacao();
  const pacote = pacoteDoSistema(versao);
  Object.assign(auto, { versao, feito: 0, total: 0, erro: null, fase: alvo && pacote ? 'baixando' : 'manual' });
  if (auto.fase === 'manual') return;
  enviarEstado();
  const temp = path.join(DADOS, 'atualizacao');
  try {
    apagar(temp);
    fs.mkdirSync(temp, { recursive: true });
    const base = `${RELEASES}/launcher-v${versao}/`;
    const r = await fetch(base + 'atualizacao.json', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`o Lareira ${versao} ainda está sendo publicado (HTTP ${r.status})`);
    const info = infoAtualizacao(await r.json(), versao, pacote.nome);
    if (!info) throw new Error('o release não tem o arquivo deste sistema');
    auto.total = info.tamanho;
    const baixado = path.join(temp, pacote.nome);
    await baixarArquivo(base + pacote.nome, baixado, info.sha256, (n) => { auto.feito += n; avisarAuto(); }, 'sha256');

    // Antes de trocar, confere que o arquivo baixado abre e e mesmo a versao anunciada. Sem isso um
    // release quebrado deixaria o jogador sem Lareira (ou atualizando em circulo).
    let pronto = baixado;
    if (pacote.tipo === 'tar') { await rodar('tar', ['-xzf', baixado, '-C', temp]); pronto = path.join(temp, 'lareira'); }
    if (pacote.tipo === 'app') { await rodar('ditto', ['-x', '-k', baixado, temp]); pronto = path.join(temp, 'Lareira.app'); }
    await conferirExecutavel(pacote.tipo === 'app' ? path.join(pronto, 'Contents', 'MacOS', 'lareira') : pronto, versao);

    // Monta o novo ao lado do atual (mesmo disco, para a troca ser um rename).
    const novo = `${alvo}.novo`;
    apagar(novo);
    if (pacote.tipo === 'app') await rodar('ditto', [pronto, novo]);
    else { fs.copyFileSync(pronto, novo); fs.chmodSync(novo, 0o755); }
    // O Windows deixa renomear um .exe em uso (so nao deixa apagar): o atual vira .velho.
    const velho = nomeLivre(`${alvo}.velho`);
    fs.renameSync(alvo, velho);
    try { fs.renameSync(novo, alvo); } catch (e) { fs.renameSync(velho, alvo); throw e; }
    log(`Lareira atualizado para ${versao} em ${alvo}`);
    auto.fase = 'reiniciando';
    enviarEstado();
    await reiniciar(MAC ? path.join(alvo, 'Contents', 'MacOS', 'lareira') : alvo);
  } catch (e) {
    log('auto-atualizacao:', e.stack || e.message);
    Object.assign(auto, { fase: 'erro', erro: e.message });
    enviarEstado();
  } finally {
    try { apagar(temp); } catch { /* fica para a proxima */ }
  }
}

// Passa a vez para o executavel novo na mesma porta. Sem janela aberta, so sai: a versao nova abre na proxima vez.
async function reiniciar(exe) {
  while (tarefa && !tarefa.fim) await new Promise((ok) => setTimeout(ok, 1000)); // nunca no meio de uma instalacao
  // Download rapido pode acabar antes de a janela abrir: espera ela conectar a primeira vez.
  for (let i = 0; i < 40 && !jaConectou; i++) await new Promise((ok) => setTimeout(ok, 500));
  if (!clientes.size) { log('atualizado sem janela aberta; a versao nova abre na proxima vez'); process.exit(0); }
  await new Promise((ok) => setTimeout(ok, 1200)); // deixa a janela mostrar "reiniciando"
  const porta = servidor.address().port;
  for (const c of clientes) c.end();
  await new Promise((ok) => { servidor.close(ok); servidor.closeAllConnections(); });
  try {
    const filho = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, LAREIRA_CONTINUAR: `${porta}:${TOKEN}` } });
    await new Promise((ok, falha) => { filho.once('spawn', ok); filho.once('error', falha); });
    filho.unref();
    process.exit(0);
  } catch (e) {
    // Nao abriu o novo: este processo continua atendendo a janela (o arquivo novo ja esta no lugar).
    log('reiniciar:', e.message);
    Object.assign(auto, { fase: 'erro', erro: 'Atualizado, mas não consegui reabrir. Feche e abra o Lareira.' });
    servidor.listen(porta, '127.0.0.1');
  }
}

// Sobras de uma atualizacao anterior (.velho fica travado no Windows ate o processo antigo sair).
function limparSobras() {
  const alvo = alvoAtualizacao();
  if (!alvo) return;
  const pasta = path.dirname(alvo), nome = path.basename(alvo);
  let itens = [];
  try { itens = fs.readdirSync(pasta); } catch { return; }
  for (const item of itens) {
    if (!item.startsWith(`${nome}.velho`) && item !== `${nome}.novo`) continue;
    try { apagar(path.join(pasta, item)); } catch (e) { log('limpar', item, e.message); }
  }
}

// ---------------------------------------------------------------- instalacao no Windows
// O .exe baixado e o proprio programa, sem instalador. Para virar um aplicativo de verdade, na primeira
// vez ele se copia para %LOCALAPPDATA%\Programs\Lareira\Lareira.exe, cria os atalhos e passa a vez para
// essa copia. Dai em diante os atalhos abrem sempre o mesmo arquivo, que e o que a auto-atualizacao troca.
// Abrir um .exe baixado mais novo atualiza a copia instalada; um mais velho so abre a instalada.
const PASTA_APP = WIN && LOCAL ? path.join(LOCAL, 'Programs', 'Lareira') : null;
const ARQ_INSTALADO = path.join(DADOS, 'instalado.json');

// Atalhos no menu Iniciar e (so na primeira instalacao) na area de trabalho. O PowerShell acha as pastas
// certas mesmo quando a area de trabalho esta no OneDrive. Se falhar, o Lareira abre igual. Quem chama e a
// copia instalada (que fica aberta), nao o .exe baixado, que sai antes de o PowerShell terminar.
function criarAtalhos(exe, comAreaDeTrabalho) {
  const script = `
$pastas = @()
if ($env:LAREIRA_ATALHOS) { $pastas = $env:LAREIRA_ATALHOS.Split('|') }
else {
  $pastas += [Environment]::GetFolderPath('Programs')
  if ($env:LAREIRA_ATALHO_MESA -eq '1') { $pastas += [Environment]::GetFolderPath('Desktop') }
}
$w = New-Object -ComObject WScript.Shell
foreach ($p in $pastas) {
  if (-not $p) { continue }
  $lnk = Join-Path $p 'Lareira.lnk'
  $s = $w.CreateShortcut($lnk)
  if ((Test-Path -LiteralPath $lnk) -and ($s.TargetPath -ieq $env:LAREIRA_ALVO)) { continue }
  $s.TargetPath = $env:LAREIRA_ALVO
  $s.WorkingDirectory = Split-Path -Parent $env:LAREIRA_ALVO
  $s.Description = 'Lareira'
  $s.Save()
}`;
  const env = { ...process.env, LAREIRA_ALVO: exe, LAREIRA_ATALHO_MESA: comAreaDeTrabalho ? '1' : '0' };
  if (process.env.LAREIRA_HOME) {
    // casa de teste: nunca mexe nos atalhos de verdade
    const pastas = [path.join(APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), ...(comAreaDeTrabalho ? [path.join(HOME, 'Desktop')] : [])];
    for (const p of pastas) fs.mkdirSync(p, { recursive: true });
    env.LAREIRA_ATALHOS = pastas.join('|');
  }
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { env, windowsHide: true, timeout: 60000 }, (e) => log(e ? `atalhos: ${e.message.slice(0, 300)}` : 'atalhos conferidos'));
}

// Devolve o executavel instalado para quem este processo deve passar a vez, ou null para seguir aqui.
function instalarNoWindows() {
  if (!WIN || !sea || !PASTA_APP || process.env.LAREIRA_TESTE || process.env.LAREIRA_SEM_INSTALAR) return null;
  const aqui = process.execPath, destino = path.join(PASTA_APP, 'Lareira.exe');
  try {
    const reg = lerJSON(ARQ_INSTALADO);
    if (mesmoCaminho(aqui, destino)) {
      // atalhos: pedido deixado por quem acabou de copiar este arquivo para ca ('mesa' = tambem na area de trabalho)
      if (reg && reg.atalhos) criarAtalhos(destino, reg.atalhos === 'mesa');
      if (!reg || reg.versao !== VERSAO || reg.atalhos) gravarJSON(ARQ_INSTALADO, { versao: VERSAO, caminho: destino });
      return null;
    }
    // A 1.3.0 e anteriores nao gravavam instalado.json: sem registro, a copia que esta la e mais velha.
    const jaTem = existe(destino) && reg && /^\d+(\.\d+)*$/.test(reg.versao || '') && cmpVersao(reg.versao, VERSAO) >= 0;
    if (!jaTem) {
      fs.mkdirSync(PASTA_APP, { recursive: true });
      let velho = null;
      if (existe(destino)) { velho = nomeLivre(`${destino}.velho`); fs.renameSync(destino, velho); }
      try { fs.copyFileSync(aqui, destino); } catch (e) { if (velho && !existe(destino)) fs.renameSync(velho, destino); throw e; }
      gravarJSON(ARQ_INSTALADO, { versao: VERSAO, caminho: destino, atalhos: reg ? 'menu' : 'mesa' });
      log(`Lareira ${VERSAO} instalado em ${destino} (aberto de ${aqui})`);
    }
    return destino;
  } catch (e) { log('instalar:', e.message); return null; }
}

// ---------------------------------------------------------------- uma instancia so
// Abrir o Lareira com ele ja aberto nao sobe um segundo servidor: so mostra a janela do que ja esta rodando.
const ARQ_INSTANCIA = path.join(DADOS, 'instancia.json');

async function outraInstancia() {
  const i = lerJSON(ARQ_INSTANCIA);
  if (!i || !Number.isInteger(i.porta) || !/^[0-9a-f]{36}$/.test(i.token || '')) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${i.porta}/api/estado?t=${i.token}`, { signal: AbortSignal.timeout(2000) });
    const e = r.ok ? await r.json() : null;
    return e && /^\d+(\.\d+)*$/.test(e.versao) ? { porta: i.porta, token: i.token, versao: e.versao } : null;
  } catch { return null; }
}

function marcarInstancia() {
  try { gravarJSON(ARQ_INSTANCIA, { pid: process.pid, porta: servidor.address().port, token: TOKEN, versao: VERSAO }); } catch (e) { log('instancia:', e.message); }
  process.on('exit', () => {
    try { if ((lerJSON(ARQ_INSTANCIA) || {}).pid === process.pid) fs.unlinkSync(ARQ_INSTANCIA); } catch { /* fica; a proxima confere se responde */ }
  });
}

// ---------------------------------------------------------------- interface (servidor local)

let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }
const recurso = (nome) => (sea ? Buffer.from(sea.getAsset(nome)) : fs.readFileSync(path.join(__dirname, 'ui', nome)));
const TIPOS = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'estilo.css': 'text/css; charset=utf-8', 'fonte.ttf': 'font/ttf', 'icone.png': 'image/png' };

// LAREIRA_CONTINUAR=<porta>:<token>: o Lareira acabou de se atualizar e a versao nova assume a mesma
// porta e o mesmo token, para a janela que ja estava aberta so reconectar (e recarregar).
const CONTINUAR = /^(\d{2,5}):([0-9a-f]{36})$/.exec(process.env.LAREIRA_CONTINUAR || '');
delete process.env.LAREIRA_CONTINUAR; // nao passa para o launcher do jogo nem para a proxima atualizacao
let TOKEN = CONTINUAR ? CONTINUAR[2] : crypto.randomBytes(18).toString('hex');
let portaHerdada = CONTINUAR ? Number(CONTINUAR[1]) : null;
const clientes = new Set();
let jaConectou = false;
let ultimoEnvio = 0, envioPendente = null;

function enviar(evento, dados) {
  const texto = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of clientes) c.write(texto);
}
const enviarEstado = () => enviar('estado', estado());
// Progresso de download chega centenas de vezes por segundo: manda no maximo 8 por segundo.
function avisarTarefa() {
  if (envioPendente) return;
  envioPendente = setTimeout(() => { envioPendente = null; ultimoEnvio = Date.now(); enviar('tarefa', tarefa); }, Math.max(0, 120 - (Date.now() - ultimoEnvio)));
}

async function acao(corpo) {
  const pack = remoto.packs.find((p) => p.id === corpo.pack);
  const modo = modoAtual(remoto.packs);
  switch (corpo.acao) {
    case 'modo':
      if (!['oficial', 'tlauncher'].includes(corpo.modo) || !launchers()[corpo.modo].presente) throw new Error('Launcher não encontrado.');
      config.modo = corpo.modo; salvarConfig();
      return {};
    case 'versao': {
      if (!pack || !variante(pack, corpo.versao)) throw new Error('Essa versão não está mais disponível.');
      if (tarefa && !tarefa.fim) throw new Error('Espere a instalação terminar.');
      if (corpo.versao === pack.versao) delete config.fixado[pack.id]; else config.fixado[pack.id] = corpo.versao;
      salvarConfig();
      return {};
    }
    case 'recarregar':
      await procurarAtualizacoes();
      return {};
    case 'sair': // pedido de um Lareira mais novo que foi aberto por cima deste
      if (ocupado()) throw new Error('ocupado');
      setTimeout(() => process.exit(0), 150);
      return {};
    case 'pasta':
      if (!pack || !modo) throw new Error('Pack não encontrado.');
      if (!existe(alvo(pack, modo).jogo)) throw new Error('A pasta ainda não existe. Instale o pack primeiro.');
      abrirNoSistema(alvo(pack, modo).jogo);
      return {};
    case 'pagina':
      if (remoto.launcher && /^https:\/\/github\.com\//.test(remoto.launcher.pagina)) abrirNoSistema(remoto.launcher.pagina);
      return {};
    case 'jogar':
      if (!pack || !modo) throw new Error('Pack não encontrado.');
      return { mensagem: jogar(pack, modo) };
    case 'sincronizar':
      if (!pack || !modo) throw new Error('Nenhum launcher encontrado neste computador.');
      if (tarefa && !tarefa.fim) throw new Error('Já existe uma instalação em andamento.');
      tarefa = { pack: pack.id, fase: 'Preparando...', feito: 0, total: 0, erro: null, fim: false, aviso: null };
      enviarEstado();
      sincronizar(escolhida(pack), modo, avisarTarefa)
        .catch((e) => { log('erro:', e.stack || e.message); tarefa.erro = e.message; })
        .finally(() => { tarefa.fim = true; setTimeout(enviarEstado, 150); });
      return {};
    default:
      throw new Error('ação desconhecida');
  }
}

const ocupado = () => !!(tarefa && !tarefa.fim) || ['baixando', 'reiniciando'].includes(auto.fase);

// Busca o manifesto de novo e, se saiu Lareira novo, comeca a auto-atualizacao em segundo plano
// (o progresso chega pela conexao de eventos).
async function procurarAtualizacoes() {
  await carregarManifesto();
  if (remoto.launcher && !remoto.offline && cmpVersao(remoto.launcher.versao, VERSAO) > 0 && !['baixando', 'reiniciando'].includes(auto.fase)) {
    autoAtualizar(remoto.launcher.versao);
  }
}

function responder(res, codigo, corpo, tipo = 'application/json; charset=utf-8') {
  res.writeHead(codigo, { 'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // So atende a propria maquina: Host local e, nas rotas /api, o token que so a janela conhece.
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return responder(res, 403, { erro: 'host' });
  const nome = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (req.method === 'GET' && TIPOS[nome]) return responder(res, 200, recurso(nome), TIPOS[nome]);
  if (!url.pathname.startsWith('/api/')) return responder(res, 404, { erro: 'nao existe' });
  if (url.searchParams.get('t') !== TOKEN) return responder(res, 403, { erro: 'token' });

  if (req.method === 'GET' && url.pathname === '/api/eventos') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    clientes.add(res); jaConectou = true;
    res.write(`event: estado\ndata: ${JSON.stringify(estado())}\n\n`);
    req.on('close', () => clientes.delete(res));
    return undefined;
  }
  if (req.method === 'GET' && url.pathname === '/api/estado') return responder(res, 200, estado());
  if (req.method === 'POST' && url.pathname === '/api/acao') {
    let corpo = '';
    for await (const pedaco of req) { corpo += pedaco; if (corpo.length > 1e5) return responder(res, 413, { erro: 'grande demais' }); }
    try {
      const resultado = await acao(JSON.parse(corpo || '{}'));
      responder(res, 200, { ok: true, ...resultado });
      enviarEstado();
    } catch (e) { responder(res, 400, { ok: false, erro: e.message }); }
    return undefined;
  }
  return responder(res, 404, { erro: 'nao existe' });
});

// A interface e uma pagina local. Se houver Edge/Chrome, abre em "modo app" (janela propria,
// sem abas); senao, no navegador padrao.
function abrirJanela(endereco) {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const navegador = WIN
    ? primeiro(pf.flatMap((p) => [path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')]))
    : MAC
      ? primeiro(['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`))
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'].map(noPath).find(Boolean);
  if (navegador) {
    soltar(navegador, [`--app=${endereco}`, `--user-data-dir=${path.join(DADOS, 'janela')}`, '--window-size=1060,760', '--no-first-run', '--no-default-browser-check']);
  } else abrirNoSistema(endereco);
}

// Escuta na porta pedida; depois de uma atualizacao a porta pode demorar um instante para ser liberada.
function escutar(porta, tentativas) {
  return new Promise((ok, falha) => {
    servidor.once('error', falha);
    servidor.listen(porta, '127.0.0.1', () => { servidor.off('error', falha); ok(); });
  }).catch(async (e) => {
    if (e.code !== 'EADDRINUSE' || tentativas <= 0) throw e;
    await new Promise((ok) => setTimeout(ok, 300));
    return escutar(porta, tentativas - 1);
  });
}

// Guarda a versao que esta rodando e descobre se o Lareira acabou de mudar de versao, para mostrar o
// changelog dele. A 1.2.0 e anteriores nao gravavam a versao: se ja rodou um Lareira aqui (tem cache)
// ou se veio de uma autoatualizacao, a anterior e mais velha, so nao se sabe qual.
function lembrarVersao() {
  const antes = config.lareira;
  if (antes && /^\d+(\.\d+)*$/.test(antes)) lareiraAntes = cmpVersao(antes, VERSAO) < 0 ? antes : null;
  else lareiraAntes = CONTINUAR || existe(path.join(DADOS, 'cache')) ? '?' : null;
  if (antes !== VERSAO) { config.lareira = VERSAO; try { salvarConfig(); } catch (e) { log('config:', e.message); } }
}

async function principal() {
  fs.mkdirSync(DADOS, { recursive: true });
  apararLog();
  // Um erro perdido num canto nao pode fechar o Lareira calado no meio de uma instalacao.
  process.on('uncaughtException', (e) => log('erro inesperado:', e.stack || e.message));
  process.on('unhandledRejection', (e) => log('promessa sem tratamento:', (e && (e.stack || e.message)) || String(e)));
  const semJanelaPedida = process.argv.includes('--sem-janela');

  // Windows: roda sempre da copia instalada (e a que os atalhos abrem e a que se atualiza sozinha).
  const instalado = instalarNoWindows();
  if (!CONTINUAR) {
    if (instalado) {
      try {
        const filho = spawn(instalado, process.argv.filter((a) => a.startsWith('--')), { detached: true, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: false });
        await new Promise((ok, falha) => { filho.once('spawn', ok); filho.once('error', falha); });
        filho.unref();
        process.exit(0);
      } catch (e) { log('nao abriu a copia instalada, sigo daqui:', e.message); }
    }
    const outra = await outraInstancia();
    if (outra) {
      const endereco = `http://127.0.0.1:${outra.porta}/?t=${outra.token}`;
      let assumir = false;
      if (cmpVersao(outra.versao, VERSAO) < 0) {
        // O que esta aberto e mais velho: pede para ele sair e assume a porta e a janela dele.
        try {
          const r = await fetch(`http://127.0.0.1:${outra.porta}/api/acao?t=${outra.token}`, { method: 'POST', body: JSON.stringify({ acao: 'sair' }), signal: AbortSignal.timeout(3000) });
          assumir = r.ok;
        } catch { /* nao respondeu: trata como aberto */ }
      }
      if (!assumir) {
        log(`Lareira ${outra.versao} ja esta aberto: mostrando a janela dele`);
        if (semJanelaPedida) console.log(endereco); else abrirJanela(endereco);
        await new Promise((ok) => setTimeout(ok, 300));
        process.exit(0);
      }
      log(`assumindo o lugar do Lareira ${outra.versao} que estava aberto`);
      TOKEN = outra.token; portaHerdada = outra.porta;
    }
  }

  lembrarVersao();
  log(`Lareira ${VERSAO} em ${process.platform}/${process.arch}${CONTINUAR ? ' (recem-atualizado)' : ''}`);
  await carregarManifesto();
  let continuou = false;
  if (portaHerdada) {
    try { await escutar(portaHerdada, 20); continuou = true; } catch (e) { log('porta anterior:', e.message); }
  }
  if (!continuou) await escutar(Number(process.env.LAREIRA_PORTA) || 0, 0);
  marcarInstancia();
  const endereco = `http://127.0.0.1:${servidor.address().port}/?t=${TOKEN}`;
  if (semJanelaPedida) console.log(endereco);
  else if (!continuou) abrirJanela(endereco);
  else setTimeout(() => { if (!jaConectou) abrirJanela(endereco); }, 12000); // a janela antiga nao voltou: abre outra
  setTimeout(limparSobras, 5000);
  if (remoto.launcher && !remoto.offline && cmpVersao(remoto.launcher.versao, VERSAO) > 0) autoAtualizar(remoto.launcher.versao);
  // Lareira esquecido aberto: confere de tempos em tempos se saiu versao nova (do pack ou dele mesmo).
  setInterval(() => {
    if (ocupado()) return;
    procurarAtualizacoes().then(enviarEstado).catch((e) => log('procurar:', e.message));
  }, Number(process.env.LAREIRA_INTERVALO) || 10 * 60 * 1000);
  // Fecha sozinho quando a janela fecha (ou se ela nunca abrir), mas nunca no meio de uma instalacao.
  let semJanela = 0;
  setInterval(() => {
    semJanela = clientes.size || ocupado() ? 0 : semJanela + 1;
    if (semJanela >= (jaConectou ? 8 : 180)) process.exit(0);
  }, 1000);
}

if (require.main === module && process.argv.includes('--versao')) { console.log(VERSAO); process.exit(0); }
if (require.main === module) principal().catch((e) => { log('fatal:', e.stack || e.message); console.error(e); process.exit(1); });
module.exports = {
  validarPack, cmpVersao, estado, carregarManifesto, remoto, launchers, pastaTLauncher, variante, config, pacoteDoSistema, infoAtualizacao,
  _teste: {
    VERSAO, DADOS, apagar, validarLauncher, novidadesLareira, lembrarVersao, gravar, escolherOficial, nomeLivre,
    estadoPack,
    sincronizar: (pack, modo, avisar) => { tarefa = { pack: pack.id, fase: '', feito: 0, total: 0, erro: null, fim: false, aviso: null }; return sincronizar(pack, modo, avisar); },
  },
};
