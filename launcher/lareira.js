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
const { spawn, execFileSync } = require('child_process');

const VERSAO = '1.0.0';
const REPO = 'ramosbezzu/chale-e-engrenagens';
const MANIFESTO_PADRAO = `https://raw.githubusercontent.com/${REPO}/main/manifest/`;
const HOSTS_DOWNLOAD = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com'];
const MARCA = 'lareira.json';
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';

// ---------------------------------------------------------------- pastas

const HOME = process.env.LAREIRA_HOME || os.homedir();
const APPDATA = WIN ? (process.env.LAREIRA_HOME ? path.join(HOME, 'AppData', 'Roaming') : process.env.APPDATA) : null;
const SUPORTE = MAC ? path.join(HOME, 'Library', 'Application Support') : null;
const DADOS = process.env.LAREIRA_DADOS
  || (WIN ? path.join(APPDATA, 'Lareira') : MAC ? path.join(SUPORTE, 'Lareira') : path.join(HOME, '.config', 'lareira'));

const existe = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
const lerJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const gravarJSON = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); };
const primeiro = (lista) => lista.find(existe) || null;

function log(...partes) {
  const linha = `[${new Date().toISOString()}] ${partes.join(' ')}\n`;
  try { fs.mkdirSync(DADOS, { recursive: true }); fs.appendFileSync(path.join(DADOS, 'lareira.log'), linha); } catch { /* sem log */ }
  if (process.env.LAREIRA_VERBOSO) process.stderr.write(linha);
}

// fixado: { <id do pack>: '<versao>' } quando o jogador escolhe ficar na versao anterior.
const config = Object.assign({ modo: null, tlauncherExe: null, manifesto: null, fixado: {} }, lerJSON(path.join(DADOS, 'config.json')));
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

async function baixarTexto(nome) {
  const base = baseManifesto();
  if (!/^https?:/.test(base)) return fs.readFileSync(path.join(base, nome), 'utf8');
  const r = await fetch(base + nome, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${nome}`);
  return r.text();
}

const relSeguro = (rel, prefixos) => typeof rel === 'string' && !/[\\:]|^\/|(^|\/)\.\.(\/|$)/.test(rel)
  && prefixos.some((p) => rel === p || (p.endsWith('/') && rel.startsWith(p) && rel.length > p.length));

// O manifesto vem da internet: tudo que vira caminho ou comando e validado antes de usar.
// Parte que muda a cada versao do pack (a atual fica na raiz do manifesto, as outras em "anteriores").
function versaoValida(v) {
  return !!v && /^\d+(\.\d+)*$/.test(v.versao) && /^\d+(\.\d+)*(-beta)?$/.test(v.neoforge) && /^\d+(\.\d+)*$/.test(v.minecraft)
    && Array.isArray(v.arquivos) && v.arquivos.every((a) => {
      let url; try { url = new URL(a.url); } catch { return false; }
      return relSeguro(a.caminho, ['mods/', 'shaderpacks/']) && /^[0-9a-f]{40}$/.test(a.sha1)
        && url.protocol === 'https:' && HOSTS_DOWNLOAD.includes(url.hostname);
    })
    && (v.configs || []).every((c) => relSeguro(c.caminho, ['config/', 'options.txt']) && typeof c.conteudo === 'string')
    && (v.ajustes || []).every((a) => relSeguro(a.arquivo, ['config/', 'options.txt']) && typeof a.de === 'string' && typeof a.para === 'string');
}

function validarPack(p) {
  const ok = p && p.formato === 1
    && /^[a-z0-9-]+$/.test(p.id) && /^[a-z0-9-]+$/.test(p.perfil) && /^\.minecraft-[a-z0-9-]+$/.test(p.pasta)
    && (!p.marcadorAntigo || /^[a-z0-9.-]+\.txt$/.test(p.marcadorAntigo))
    && versaoValida(p) && (p.anteriores || []).every(versaoValida);
  if (!ok) throw new Error(`manifesto invalido: ${p && p.id}`);
  p.historico = p.historico || [];
  p.anteriores = p.anteriores || [];
  for (const v of [p, ...p.anteriores]) { v.configs = v.configs || []; v.ajustes = v.ajustes || []; }
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

async function carregarManifesto() {
  const cache = path.join(DADOS, 'cache');
  let textos;
  try {
    const index = await baixarTexto('index.json');
    const idx = JSON.parse(index);
    if (idx.formato !== 1) throw new Error('Este launcher e antigo demais para o manifesto atual. Baixe a versao nova.');
    textos = { 'index.json': index };
    for (const p of idx.packs) {
      if (!/^[a-z0-9-]+\.json$/.test(p.arquivo)) throw new Error('manifesto invalido');
      textos[p.arquivo] = await baixarTexto(p.arquivo);
    }
    fs.mkdirSync(cache, { recursive: true });
    for (const [nome, texto] of Object.entries(textos)) fs.writeFileSync(path.join(cache, nome), texto);
    remoto.offline = false; remoto.erro = null;
  } catch (e) {
    // Sem internet (ou GitHub fora): usa a ultima copia boa.
    log('manifesto:', e.message);
    remoto.offline = true; remoto.erro = e.message;
    textos = {};
    for (const nome of existe(cache) ? fs.readdirSync(cache) : []) textos[nome] = fs.readFileSync(path.join(cache, nome), 'utf8');
    if (!textos['index.json']) { remoto.packs = []; return; }
  }
  const idx = JSON.parse(textos['index.json']);
  remoto.launcher = idx.launcher || null;
  remoto.packs = idx.packs.filter((p) => textos[p.arquivo]).map((p) => validarPack(JSON.parse(textos[p.arquivo])));
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
    tamanho: v.arquivos.reduce((s, a) => s + (a.tamanho || 0), 0),
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
    versao: VERSAO, novaVersao: nova, offline: remoto.offline, erroManifesto: remoto.erro,
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

function abrirOficial() {
  if (WIN) {
    const exe = primeiro([
      'C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe',
      'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe',
      'C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe',
    ]);
    if (exe) soltar(exe, []);
    else soltar('explorer.exe', ['shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft']); // Microsoft Store
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

async function baixarArquivo(url, destino, sha1, aoBaixar) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const parte = destino + '.parte';
  let ultimo;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let lidos = 0;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const hash = crypto.createHash('sha1');
      const saida = fs.createWriteStream(parte);
      for await (const pedaco of r.body) {
        hash.update(pedaco); lidos += pedaco.length;
        if (aoBaixar) aoBaixar(pedaco.length);
        if (!saida.write(pedaco)) await new Promise((ok) => saida.once('drain', ok));
      }
      await new Promise((ok, falha) => saida.end((e) => (e ? falha(e) : ok())));
      if (sha1 && hash.digest('hex') !== sha1) throw new Error('arquivo corrompido (sha1 diferente)');
      fs.renameSync(parte, destino);
      return;
    } catch (e) {
      ultimo = e;
      if (aoBaixar) aoBaixar(-lidos);
      try { fs.rmSync(parte, { force: true }); } catch { /* nada */ }
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
  fs.rmSync(pasta, { recursive: true, force: true });
  fs.mkdirSync(pasta, { recursive: true });
  const pacote = path.join(pasta, WIN ? 'jre.zip' : 'jre.tar.gz');
  await baixarArquivo(`https://api.adoptium.net/v3/binary/latest/21/ga/${so}/${arq}/jre/hotspot/normal/eclipse`, pacote, null, null);
  await rodar('tar', ['-xf', pacote, '-C', pasta]); // o tar do Windows 10+ tambem abre .zip
  fs.rmSync(pacote, { force: true });
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
  fs.writeFileSync(arquivo, linhas.join(eol), 'latin1');
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
  for (const a of pack.arquivos) {
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
  for (const jar of jarsEm(path.join(jogo, 'mods'))) if (!quer.has(jar)) fs.rmSync(path.join(jogo, 'mods', jar), { force: true });

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
  gravarJSON(path.join(jogo, MARCA), { pack: pack.id, nome: pack.nome, versao: pack.versao, modo, em: new Date().toISOString() });
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

// ---------------------------------------------------------------- interface (servidor local)

let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch { sea = null; }
const recurso = (nome) => (sea ? Buffer.from(sea.getAsset(nome)) : fs.readFileSync(path.join(__dirname, 'ui', nome)));
const TIPOS = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'estilo.css': 'text/css; charset=utf-8', 'fonte.ttf': 'font/ttf', 'icone.png': 'image/png' };

const TOKEN = crypto.randomBytes(18).toString('hex');
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
      await carregarManifesto();
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

async function principal() {
  fs.mkdirSync(DADOS, { recursive: true });
  log(`Lareira ${VERSAO} em ${process.platform}/${process.arch}`);
  await carregarManifesto();
  servidor.listen(Number(process.env.LAREIRA_PORTA) || 0, '127.0.0.1', () => {
    const endereco = `http://127.0.0.1:${servidor.address().port}/?t=${TOKEN}`;
    if (process.argv.includes('--sem-janela')) console.log(endereco); else abrirJanela(endereco);
  });
  // Fecha sozinho quando a janela fecha (ou se ela nunca abrir), mas nunca no meio de uma instalacao.
  let semJanela = 0;
  setInterval(() => {
    const ocupado = tarefa && !tarefa.fim;
    semJanela = clientes.size || ocupado ? 0 : semJanela + 1;
    if (semJanela >= (jaConectou ? 8 : 180)) process.exit(0);
  }, 1000);
}

if (require.main === module) principal().catch((e) => { log('fatal:', e.stack || e.message); console.error(e); process.exit(1); });
module.exports = {
  validarPack, cmpVersao, estado, carregarManifesto, remoto, launchers, pastaTLauncher, variante, config,
  _teste: {
    estadoPack,
    sincronizar: (pack, modo, avisar) => { tarefa = { pack: pack.id, fase: '', feito: 0, total: 0, erro: null, fim: false, aviso: null }; return sincronizar(pack, modo, avisar); },
  },
};
