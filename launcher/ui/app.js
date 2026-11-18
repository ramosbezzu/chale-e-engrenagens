'use strict';
const TOKEN = new URLSearchParams(location.search).get('t') || '';
const $ = (id) => document.getElementById(id);
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; };

let estado = null;
let escolhido = new URLSearchParams(location.search).get('pack') || localStorage.getItem('pack');
let recado = null; // { texto, erro }
let tarefaVista = null;
let atualizadoVisto = false; // aviso "o Lareira se atualizou" ja dispensado

async function acao(corpo) {
  try {
    const r = await fetch(`/api/acao?t=${TOKEN}`, { method: 'POST', body: JSON.stringify(corpo) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.erro);
    return j;
  } catch (e) {
    recado = { texto: e.message === 'Failed to fetch' ? 'O Lareira foi fechado. Abra de novo.' : e.message, erro: true };
    desenhar();
    return null;
  }
}

function confirmar(titulo, texto) {
  return new Promise((resolver) => {
    $('dialogoTitulo').textContent = titulo;
    $('dialogoTexto').textContent = texto;
    $('dialogoTexto').hidden = false;
    $('dialogoCorpo').hidden = true;
    $('dialogoNao').hidden = false;
    $('dialogoSim').textContent = 'Continuar';
    $('dialogo').hidden = false;
    $('dialogoSim').focus();
    const fechar = (valor) => { $('dialogo').hidden = true; resolver(valor); };
    $('dialogoSim').onclick = () => fechar(true);
    $('dialogoNao').onclick = () => fechar(false);
  });
}

// Changelog do proprio Lareira num dialogo so de leitura.
function mostrarNovidades(titulo, texto, entradas, instalada) {
  $('dialogoTitulo').textContent = titulo;
  $('dialogoTexto').textContent = texto || '';
  $('dialogoTexto').hidden = !texto;
  const corpo = $('dialogoCorpo');
  corpo.replaceChildren(...entradas.map((h) => entradaHistorico(h, instalada)));
  if (!entradas.length) corpo.append(el('p', 'resumo', 'Sem notas para esta versão.'));
  corpo.hidden = false;
  $('dialogoNao').hidden = true;
  $('dialogoSim').textContent = 'Fechar';
  $('dialogo').hidden = false;
  $('dialogoSim').focus();
  $('dialogoSim').onclick = () => { $('dialogo').hidden = true; };
}

const cmp = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const MB = (n) => `${Math.round(n / 1048576)} MB`;
const packAtual = () => estado && (estado.packs.find((p) => p.id === escolhido) || estado.packs[0]);
const ocupado = () => !!(estado && estado.tarefa && !estado.tarefa.fim);

async function sincronizar(pack) {
  if (pack.guardaMods) {
    const ok = await confirmar('Instalar no TLauncher',
      `O TLauncher usa uma pasta só para tudo. Os ${pack.guardaMods} mods que já estão lá serão guardados em uma pasta "mods-antes-do-lareira" (nada é apagado) e o ${pack.nome} entra no lugar.\n\nSeus mundos não são alterados.`);
    if (!ok) return;
  } else if (pack.outroPack) {
    const ok = await confirmar('Trocar de pack no TLauncher', `O TLauncher está com o ${pack.outroPack}. Os mods dele serão trocados pelos do ${pack.nome}. Os mundos continuam na pasta.`);
    if (!ok) return;
  }
  if (pack.volta) {
    const ok = await confirmar(`Voltar para a ${pack.versao}`,
      `Você está na ${pack.instalada}. Voltar troca os mods pelos da ${pack.versao}.\n\nMundos já abertos na versão mais nova podem perder blocos e itens de mods que não existem na anterior. Se o mundo for importante, copie a pasta "saves" antes.`);
    if (!ok) return;
  }
  recado = null;
  await acao({ acao: 'sincronizar', pack: pack.id });
}

async function jogar(pack) {
  const r = await acao({ acao: 'jogar', pack: pack.id });
  if (r) { recado = { texto: r.mensagem }; desenhar(); }
}

function desenharModo() {
  const caixa = $('modo');
  caixa.replaceChildren();
  for (const [id, nome] of [['oficial', 'Minecraft Launcher'], ['tlauncher', 'TLauncher']]) {
    const b = el('button', null, nome);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(estado.modo === id));
    b.disabled = !estado.launchers[id].presente || ocupado();
    b.title = estado.launchers[id].presente ? `Instalar e jogar pelo ${nome}` : `${nome} não encontrado neste computador`;
    b.onclick = () => { recado = null; acao({ acao: 'modo', modo: id }); };
    caixa.append(b);
  }
}

function desenharFaixa() {
  const f = $('faixa');
  f.replaceChildren();
  f.className = 'faixa';
  const a = estado.autoAtualizacao || {};
  const lareira = estado.lareira || {};
  const botao = (texto, fn, classe = 'botao pequeno') => { const b = el('button', classe, texto); b.type = 'button'; b.onclick = fn; return b; };
  const botoes = (...lista) => { const c = el('span', 'botoes'); c.append(...lista); return c; };
  const oQueMuda = () => botao('o que muda', () => mostrarNovidades(`Lareira ${estado.novaVersao.versao}`, `Você tem a ${estado.versao}.`, lareira.novidadesNova || []), 'botao pequeno claro');
  if (a.fase === 'baixando' || a.fase === 'reiniciando') {
    const pct = a.total ? ` ${Math.min(100, Math.floor((a.feito / a.total) * 100))}%` : '';
    f.append(el('span', null, a.fase === 'reiniciando' ? `Lareira ${a.versao} instalado! Reiniciando...` : `Atualizando o Lareira para a ${a.versao}...${pct}`));
    if (estado.novaVersao) f.append(botoes(oQueMuda()));
  } else if (estado.novaVersao) {
    f.append(el('span', null, a.fase === 'erro'
      ? `Não consegui atualizar o Lareira sozinho (${a.erro}). Baixe a ${estado.novaVersao.versao} (você tem a ${estado.versao}).`
      : `Saiu o Lareira ${estado.novaVersao.versao} (você tem a ${estado.versao}).`));
    f.append(botoes(oQueMuda(), botao('Baixar', () => acao({ acao: 'pagina' }))));
  } else if (lareira.atualizado && !atualizadoVisto) {
    const at = lareira.atualizado;
    f.append(el('span', null, `O Lareira foi atualizado: agora está na ${estado.versao}.`));
    f.append(botoes(
      botao('novidades', () => mostrarNovidades(`Novidades do Lareira ${estado.versao}`, at.de ? `Antes você estava na ${at.de}.` : null, at.novidades), 'botao pequeno claro'),
      botao('ok', () => { atualizadoVisto = true; desenharFaixa(); }),
    ));
  } else if (estado.offline) {
    f.classList.add('cinza');
    f.append(el('span', null, estado.packs.length
      ? 'Sem conexão com o GitHub: mostrando a última lista salva. Dá para jogar, mas não para saber se há versão nova.'
      : 'Sem conexão com o GitHub e nenhuma lista salva ainda. Confira a internet e clique em "procurar atualizações".'));
  }
  f.hidden = !f.childNodes.length;
}

function desenharPacks() {
  const lista = $('packs');
  lista.replaceChildren();
  const atual = packAtual();
  for (const p of estado.packs) {
    const c = el('button', 'cartao');
    c.type = 'button';
    c.setAttribute('aria-current', String(atual && p.id === atual.id));
    c.append(el('b', null, p.nome));
    const linha = el('span');
    linha.append(el('i', `ponto ${p.estado}`));
    linha.append(p.estado === 'ok' ? `${p.fixada ? 'versão anterior' : 'em dia'} · ${p.versao}` : p.estado === 'atualizar' ? `${p.volta ? 'voltar para' : 'atualização'} · ${p.versao}` : `não instalado · ${p.versao}`);
    c.append(linha);
    c.onclick = () => { escolhido = p.id; localStorage.setItem('pack', p.id); recado = null; desenhar(); };
    lista.append(c);
  }
}

function desenharHistorico(p) {
  const caixa = $('historico');
  caixa.replaceChildren();
  const instalada = p.instalada && p.instalada !== 'desconhecida' ? p.instalada : null;
  for (const h of p.historico) caixa.append(entradaHistorico(h, instalada));
  if (!p.historico.length) caixa.append(el('p', 'resumo', 'Sem notas para este pack ainda.'));
}

// Uma entrada de historico (de pack ou do Lareira). instalada: versao que o jogador tem, para as etiquetas.
function entradaHistorico(h, instalada) {
  const e = el('article', 'entrada');
  const cab = el('header');
  cab.append(el('b', null, h.versao), el('span', null, h.titulo || ''));
  if (instalada && cmp(h.versao, instalada) > 0) cab.append(el('span', 'novo', 'NOVO'));
  if (instalada && cmp(h.versao, instalada) === 0) cab.append(el('span', 'instalada', 'INSTALADA'));
  if (h.data) cab.append(el('time', null, h.data.split('-').reverse().join('/')));
  e.append(cab);
  if (h.tema === 'natal') e.classList.add('natal');
  const bloco = (rotulo, itens, classe) => {
    if (!itens || !itens.length) return;
    if (rotulo) e.append(el('span', 'rotulo', rotulo));
    const ul = el('ul');
    for (const i of itens) ul.append(el('li', classe, i));
    e.append(ul);
  };
  if (h.mensagem) e.append(el('p', 'mensagem', h.mensagem));
  if (h.secoes && h.secoes.length) {
    for (const s of h.secoes) {
      e.append(el('h4', null, s.titulo));
      bloco(null, s.itens, null);
      if (s.fotos.length) e.append(galeria(s.fotos));
    }
  } else bloco(null, h.novidades, null);
  bloco('Compatível', h.compativel, 'sim');
  bloco('Incompatível / atenção', h.incompativel, 'nao');
  if (h.despedida) e.append(el('p', 'mensagem despedida', h.despedida));
  return e;
}

// Fotos dos mods (do CDN do Modrinth). Clique amplia; se a foto nao carregar (sem internet), some.
function galeria(lista) {
  const g = el('div', 'fotos');
  for (const f of lista) {
    const fig = el('figure');
    const img = el('img');
    img.loading = 'lazy'; img.alt = f.legenda; img.src = f.url; img.referrerPolicy = 'no-referrer';
    img.onerror = () => fig.remove();
    fig.append(img);
    if (f.legenda) fig.append(el('figcaption', null, f.legenda));
    fig.tabIndex = 0;
    fig.onclick = fig.onkeydown = (ev) => { if (ev.type === 'click' || ev.key === 'Enter') ampliar(f); };
    g.append(fig);
  }
  return g;
}

function ampliar(f) {
  $('fotoGrande').src = f.url;
  $('fotoGrande').alt = f.legenda;
  $('fotoLegenda').textContent = f.legenda;
  $('foto').hidden = false;
  $('foto').focus();
}

function desenharProgresso(t) {
  $('progresso').hidden = !t || t.fim;
  if (!t || t.fim) return;
  const cheio = $('cheio');
  const indefinido = !t.total;
  cheio.classList.toggle('indefinido', indefinido);
  if (!indefinido) cheio.style.width = `${Math.min(100, (t.feito / t.total) * 100).toFixed(1)}%`;
  $('fase').textContent = t.total ? `${t.fase} ${MB(t.feito)} de ${MB(t.total)}` : t.fase;
}

function desenhar() {
  if (!estado) return;
  desenharModo();
  desenharFaixa();
  desenharPacks();
  $('versao').textContent = `Lareira ${estado.versao}`;
  $('versao').onclick = () => mostrarNovidades('Novidades do Lareira', null, (estado.lareira && estado.lareira.historico) || [], estado.versao);

  const p = packAtual();
  $('detalhe').hidden = !p;
  $('vazio').hidden = !!p;
  if (!p) {
    $('vazio').textContent = estado.offline ? 'Não consegui buscar a lista de modpacks.' : 'Nenhum modpack publicado ainda.';
    return;
  }
  const t = estado.tarefa && estado.tarefa.pack === p.id ? estado.tarefa : null;
  const trabalhando = ocupado();

  $('nome').textContent = p.nome;
  const etiquetas = $('etiquetas');
  etiquetas.replaceChildren(el('span', 'etiqueta', `v${p.versao}`), el('span', 'etiqueta', `Minecraft ${p.minecraft}`),
    el('span', 'etiqueta', `NeoForge ${p.neoforge}`), el('span', 'etiqueta', `${p.mods} mods · ${MB(p.tamanho)}`));
  $('resumo').textContent = p.resumo;

  // Seletor de versao: so aparece quando o manifesto traz a anterior.
  const versoes = $('versoes');
  versoes.hidden = p.versoes.length < 2;
  versoes.replaceChildren(el('span', null, 'Versão:'));
  p.versoes.forEach((v, i) => {
    const b = el('button', null, `${v} · ${i === 0 ? 'mais nova' : 'anterior'}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(v === p.versao));
    b.disabled = trabalhando;
    b.onclick = () => { recado = null; acao({ acao: 'versao', pack: p.id, versao: v }); };
    versoes.append(b);
  });

  const botao = $('principal');
  botao.className = 'botao';
  botao.disabled = trabalhando;
  const launcher = estado.modo === 'tlauncher' ? 'TLauncher' : 'Minecraft Launcher';
  let s1 = '', s2 = '';
  if (p.estado === 'sem-launcher') {
    botao.textContent = 'Instalar';
    botao.disabled = true;
    s1 = 'Nenhum launcher encontrado';
    s2 = 'Instale o Minecraft Launcher ou o TLauncher, abra uma vez, feche e volte aqui.';
  } else if (p.estado === 'ausente') {
    botao.textContent = 'Instalar';
    botao.onclick = () => sincronizar(p);
    s1 = `Ainda não instalado no ${launcher}`;
    s2 = `Vai baixar a versão ${p.versao}: ${p.mods} mods (${MB(p.tamanho)}).`;
  } else if (p.estado === 'atualizar') {
    botao.textContent = p.volta ? 'Voltar' : 'Atualizar';
    botao.onclick = () => sincronizar(p);
    s1 = p.instalada === 'desconhecida' ? `Instalação antiga encontrada, disponível a ${p.versao}`
      : p.volta ? `Você tem a ${p.instalada} e escolheu a anterior, ${p.versao}`
        : p.fixada ? `Você tem a ${p.instalada} e escolheu a ${p.versao}` : `Você tem a ${p.instalada}, saiu a ${p.versao}`;
    s2 = `${p.entram} mod(s) entram ou mudam, ${p.saem} saem. Mundos e opções são mantidos.`;
  } else {
    botao.textContent = 'Jogar';
    botao.classList.add('verde');
    botao.onclick = () => jogar(p);
    s1 = p.fixada ? `Na versão anterior: ${p.instalada}` : `Em dia: versão ${p.instalada}`;
    s2 = p.fixada ? `A mais nova é a ${p.maisNova}. Troque em "Versão" quando todo mundo for atualizar junto.` : `Abre o ${launcher} com o pack já selecionado.`;
  }
  if (trabalhando) botao.textContent = t ? 'Aguarde...' : botao.textContent;
  $('situacao').textContent = s1;
  $('situacao2').textContent = s2;

  desenharProgresso(t);
  // Resultado da tarefa vira recado (uma vez so por tarefa).
  if (estado.tarefa && estado.tarefa.fim && tarefaVista !== estado.tarefa) {
    tarefaVista = estado.tarefa;
    const tt = estado.tarefa;
    const nome = (estado.packs.find((x) => x.id === tt.pack) || {}).nome || 'Pack';
    recado = tt.erro ? { texto: tt.erro, erro: true }
      : { texto: [`${nome} pronto! Clique em Jogar.`, tt.aviso, estado.modo === 'tlauncher' ? `No TLauncher, deixe ${estado.xmx} GB de memória nas configurações (este PC tem ${estado.ramGB} GB).` : null].filter(Boolean).join(' ') };
  }
  const r = $('recado');
  r.hidden = !recado || trabalhando;
  if (recado) { r.textContent = recado.texto; r.className = recado.erro ? 'recado erro' : 'recado'; }

  desenharHistorico(p);
  $('abrirPasta').title = p.pasta || '';
  $('abrirPasta').disabled = !p.instalada;
  $('reparar').disabled = !p.instalada || trabalhando;
  $('recarregar').disabled = trabalhando;
  $('abrirPasta').onclick = () => acao({ acao: 'pasta', pack: p.id });
  $('reparar').onclick = () => sincronizar(p);
  $('recarregar').onclick = async () => { recado = null; if (await acao({ acao: 'recarregar' })) { recado = { texto: 'Lista de modpacks atualizada.' }; desenhar(); } };
}

function conectar() {
  // ?foto=1: le o estado uma vez so, sem conexao aberta (para tirar screenshot em navegador headless).
  if (new URLSearchParams(location.search).has('foto')) {
    fetch(`/api/estado?t=${TOKEN}`).then((r) => r.json()).then((e) => { estado = e; desenhar(); });
    return;
  }
  const fonte = new EventSource(`/api/eventos?t=${TOKEN}`);
  let versaoDaPagina = null;
  fonte.addEventListener('estado', (e) => {
    const novo = JSON.parse(e.data);
    // O Lareira se atualizou e reabriu na mesma porta: recarrega para pegar a interface nova.
    if (versaoDaPagina && novo.versao !== versaoDaPagina) { location.reload(); return; }
    versaoDaPagina = novo.versao;
    estado = novo; desenhar();
  });
  fonte.addEventListener('tarefa', (e) => {
    if (!estado) return;
    estado.tarefa = JSON.parse(e.data);
    const p = packAtual();
    desenharProgresso(p && estado.tarefa.pack === p.id ? estado.tarefa : null);
  });
  fonte.onerror = () => {
    if (fonte.readyState === EventSource.CLOSED) { $('vazio').textContent = 'O Lareira foi fechado. Abra de novo.'; }
  };
}

// ------------------------------------------------------------ Natal (15/11 a 06/01, decoracao automatica)
const hoje = new Date();
const NATAL = new URLSearchParams(location.search).has('natal')
  || (hoje.getMonth() === 10 && hoje.getDate() >= 15) || hoje.getMonth() === 11 || (hoje.getMonth() === 0 && hoje.getDate() <= 6);

function enfeitar() {
  if (!NATAL) return;
  document.body.classList.add('natal');
  $('subtitulo').textContent = 'feliz natal! modpacks quentinhos, sempre em dia';
  // Varal de pisca-pisca embaixo da cena: cada lampada pisca no seu ritmo.
  const varal = $('pisca');
  const cores = ['vermelha', 'amarela', 'verde', 'azul'];
  for (let i = 0; i < 64; i++) {
    const l = el('i', cores[i % cores.length]);
    l.style.animationDelay = `${-((i * 7) % 11) * 0.23}s`;
    varal.append(l);
  }
  varal.hidden = false;
}

// ------------------------------------------------------------ cena em pixel art (tudo desenhado no codigo)
function cena() {
  const tela = $('cena');
  const g = tela.getContext('2d');
  const E = 4; // tamanho de cada "pixel" na tela
  let L = 0, A = 0, estrelas = [], fumaca = [], neve = [];
  const parado = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const px = (x, y, w, h, cor) => { g.fillStyle = cor; g.fillRect(Math.round(x), Math.round(y), w, h); };
  let semente = 7;
  const acaso = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };

  function medir() {
    L = Math.ceil(tela.clientWidth / E); A = Math.ceil(tela.clientHeight / E);
    tela.width = L; tela.height = A;
    semente = 7;
    estrelas = Array.from({ length: Math.floor(L / 5) }, () => ({ x: Math.floor(acaso() * L), y: Math.floor(acaso() * (A - 22)), f: acaso() * 6 }));
    neve = Array.from({ length: Math.floor(L / (NATAL ? 6 : 9)) }, () => ({ x: acaso() * L, y: acaso() * A, v: 3 + acaso() * 4 }));
    enfeites = Array.from({ length: 14 }, () => ({ a: acaso(), b: acaso(), f: acaso() * 6, c: Math.floor(acaso() * 4) }));
  }
  let enfeites = [];
  const LUZES = ['#ff5a4f', '#ffd75e', '#6fd36a', '#5fb4ff'];
  // Lampada que alterna entre acesa e apagada (cada uma com sua fase).
  const luz = (x, y, i, t) => {
    const acesa = parado || Math.sin(t / 380 + i * 1.7) > -0.3;
    px(x, y, 1, 1, acesa ? LUZES[i % 4] : '#4a3a44');
  };

  // Arvore de Natal com bolas, estrela e presentes.
  function arvoreNatal(x, base, alt, t) {
    for (let i = 0; i < alt; i++) {
      const larg = Math.floor(i * 0.42) + (i % 4 === 3 ? 0 : 1);
      px(x - larg, base - alt + i, larg * 2 + 1, 1, i % 4 === 0 ? '#2f5c38' : '#3f6b45');
    }
    px(x - 1, base, 3, 2, '#5a3a28');
    enfeites.forEach((e, k) => {
      const i = 3 + Math.floor(e.a * (alt - 4));
      const larg = Math.floor(i * 0.42);
      luz(x - larg + Math.floor(e.b * (larg * 2 + 1)), base - alt + i, e.c + k, t + e.f * 900);
    });
    const brilho = parado ? 1 : Math.sin(t / 260);
    const estrela = brilho > 0.4 ? '#fff2a8' : '#ffc857';
    px(x, base - alt - 3, 1, 3, estrela); px(x - 1, base - alt - 2, 3, 1, estrela);
    if (brilho > 0.85) { px(x - 2, base - alt - 2, 1, 1, '#fff7e6'); px(x + 2, base - alt - 2, 1, 1, '#fff7e6'); }
    // presentes
    px(x - 6, base - 1, 4, 3, '#c8463a'); px(x - 5, base - 1, 1, 3, '#ffd75e');
    px(x + 3, base, 4, 2, '#4f7fc9'); px(x + 4, base, 1, 2, '#f6e8cb');
    px(x + 7, base - 1, 3, 3, '#5d8f4e'); px(x + 8, base - 1, 1, 3, '#c8463a');
  }

  // Treno com renas cruzando o ceu de tempos em tempos.
  function treno(t) {
    const ciclo = 42000, dur = 16000, fase = t % ciclo;
    if (parado || fase > dur) return;
    const x = -24 + (fase / dur) * (L + 48), y = 9 + Math.round(Math.sin(fase / 900) * 2);
    for (const [dx, nariz] of [[16, true], [10, false]]) {
      px(x + dx, y, 4, 2, '#8a5a3c'); px(x + dx + 3, y - 1, 2, 1, '#8a5a3c');
      px(x + dx, y + 2, 1, 1, '#8a5a3c'); px(x + dx + 3, y + 2, 1, 1, '#8a5a3c');
      px(x + dx + 4, y - 2, 1, 1, '#d9a7a0');
      if (nariz) px(x + dx + 5, y - 1, 1, 1, Math.sin(t / 150) > 0 ? '#ff5a4f' : '#a8443a');
    }
    px(x + 5, y + 1, 5, 1, '#d9a7a0'); // arreio
    px(x, y, 6, 3, '#c8463a'); px(x - 1, y + 3, 7, 1, '#ffd75e'); // treno
    px(x + 2, y - 2, 2, 2, '#c8463a'); px(x + 2, y - 3, 2, 1, '#f6e8cb'); // papai noel
    px(x - 2, y - 1, 2, 2, '#6b4630'); // saco de presentes
  }


  function pinheiro(x, base, alt, cor, corNeve) {
    for (let i = 0; i < alt; i++) {
      const larg = 1 + Math.floor((i % 5) * 0.9 + i * 0.35);
      px(x - larg, base - alt + i, larg * 2 + 1, 1, cor);
      if (i % 5 === 0) px(x - larg, base - alt + i, larg + 1, 1, corNeve);
    }
    px(x, base, 1, 2, '#2a1c1a');
  }

  function engrenagem(cx, cy, raio, angulo, cor, sombra) {
    for (let y = -raio - 2; y <= raio + 2; y++) {
      for (let x = -raio - 2; x <= raio + 2; x++) {
        const d = Math.hypot(x, y);
        const dente = Math.cos((Math.atan2(y, x) + angulo) * 8) > 0.15;
        if ((d <= raio || (d <= raio + 2 && dente)) && d > raio * 0.32) px(cx + x, cy + y, 1, 1, d < raio * 0.62 && d > raio * 0.45 ? sombra : cor);
      }
    }
  }

  function quadro(t) {
    const chao = A - 7;
    ['#1b1626', '#221b33', '#2b2140', '#3a2a4d', '#57365a', '#7d4560', '#a85a5c'].forEach((cor, i, v) => px(0, Math.floor((chao * i) / v.length), L, Math.ceil(chao / v.length) + 1, cor));
    for (const e of estrelas) if (Math.sin(t / 900 + e.f) > -0.6) px(e.x, e.y, 1, 1, e.y < chao * 0.5 ? '#f6e8cb' : '#d9a7a0');
    if (NATAL) treno(t);
    // lua
    const lx = Math.floor(L * (NATAL ? 0.36 : 0.52)); // no Natal sai do caminho da arvore enfeitada
    px(lx, 7, 7, 9, '#f6e8cb'); px(lx - 1, 8, 9, 7, '#f6e8cb'); px(lx + 4, 7, 4, 4, '#3a2a4d'); px(lx + 5, 8, 4, 4, '#2b2140');
    // morros ao fundo
    for (let x = 0; x < L; x++) {
      const h = 9 + Math.round(Math.sin(x / 23) * 4 + Math.sin(x / 9 + 2) * 2);
      px(x, chao - h, 1, h, '#33284a');
    }
    for (let x = 6; x < L; x += 13) pinheiro(x + ((x * 7) % 5), chao, 12 + ((x * 3) % 7), '#27344a', '#3d4a66');

    // chale, do lado direito
    const cx = Math.max(150, L - 92), topo = chao - 17;
    for (let i = 0; i < 9; i++) px(cx - 3 + i, topo - i + 8, 44 - i * 2, 1, i % 2 ? '#e9eef2' : '#cfd9e2'); // telhado com neve
    px(cx + 30, topo - 6, 5, 10, '#6b4630'); px(cx + 29, topo - 7, 7, 2, '#e9eef2'); // chamine
    px(cx, topo + 9, 38, 9, '#6b4630');
    for (let y = 0; y < 9; y += 3) px(cx, topo + 9 + y, 38, 1, '#4d3225'); // toras
    px(cx + 16, topo + 11, 6, 7, '#3a2824'); px(cx + 20, topo + 14, 1, 1, '#ffc857'); // porta
    const brilho = parado ? 0 : Math.sin(t / 170) + Math.sin(t / 61);
    const janela = brilho > 0.9 ? '#ffe08a' : brilho < -1.2 ? '#f0a03c' : '#ffc857';
    for (const jx of [cx + 5, cx + 27]) { px(jx - 1, topo + 10, 8, 7, '#3a2824'); px(jx, topo + 11, 6, 5, janela); px(jx + 3, topo + 11, 1, 5, '#3a2824'); px(jx, topo + 13, 6, 1, '#3a2824'); }
    px(cx + 4, chao, 8, 1, 'rgba(255,200,87,.35)'); px(cx + 26, chao, 8, 1, 'rgba(255,200,87,.35)');
    if (NATAL) {
      // pisca-pisca na beira do telhado e guirlanda na porta
      for (let i = 0; i <= 8; i += 2) { luz(cx - 3 + i, topo - i + 8, i, t); luz(cx + 40 - i, topo - i + 8, i + 1, t); }
      for (let x = cx - 1, i = 0; x < cx + 39; x += 3, i++) luz(x, topo + 9, i, t);
      px(cx + 17, topo + 12, 4, 1, '#3f6b45'); px(cx + 17, topo + 15, 4, 1, '#3f6b45');
      px(cx + 16, topo + 13, 1, 2, '#3f6b45'); px(cx + 21, topo + 13, 1, 2, '#3f6b45');
      px(cx + 18, topo + 15, 2, 1, '#c8463a');
    }

    // engrenagem girando ao lado do chale (a roda do moinho)
    engrenagem(cx - 12, chao - 9, 7, parado ? 0.3 : t / 1400, '#a8744a', '#6b4630');
    px(cx - 13, chao - 10, 3, 3, '#ffc857');

    // fumaca da chamine
    if (!parado && (fumaca.length === 0 || t - fumaca[fumaca.length - 1].n > 420)) fumaca.push({ n: t, d: acaso() * 6 });
    fumaca = fumaca.filter((f) => t - f.n < 5200);
    for (const f of fumaca) {
      const idade = (t - f.n) / 5200;
      const fx = cx + 32 + Math.sin(idade * 5 + f.d) * 3 + idade * 9, fy = topo - 8 - idade * 30;
      const tam = 2 + Math.floor(idade * 3);
      px(fx, fy, tam, tam, `rgba(233,238,242,${(0.55 * (1 - idade)).toFixed(2)})`);
    }

    // pinheiros da frente e o chao de neve
    const livre = NATAL ? cx - 50 : cx - 26; // no Natal a arvore enfeitada fica a esquerda da engrenagem
    for (let x = 14; x < L; x += 37) if (x > 110 && (x < livre || x > cx + 46)) pinheiro(x + ((x * 5) % 9), chao + 1, 17 + ((x * 11) % 8), '#3f6b45', '#e9eef2');
    px(0, chao, L, A - chao, '#e9eef2');
    if (NATAL) arvoreNatal(cx - 36, chao, 20, t);
    for (let x = 0; x < L; x += 3) px(x + ((x * 13) % 3), chao + 2 + ((x * 7) % 4), 2, 1, '#cfd9e2');
    for (const n of neve) px((n.x + Math.sin(t / 1300 + n.v) * 3 + L) % L, (n.y + (parado ? 0 : (t / 1000) * n.v)) % A, 1, 1, 'rgba(246,232,203,.8)');
  }

  medir();
  addEventListener('resize', () => { medir(); if (parado) quadro(0); });
  if (parado) { quadro(0); return; }
  quadro(performance.now()); // primeiro quadro na hora, sem esperar o laco
  let anterior = 0;
  const laco = (t) => { if (t - anterior > 80) { anterior = t; quadro(t); } requestAnimationFrame(laco); };
  requestAnimationFrame(laco);
}

$('foto').onclick = () => { $('foto').hidden = true; };
$('foto').onkeydown = (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter') $('foto').hidden = true; };
enfeitar();
cena();
conectar();
