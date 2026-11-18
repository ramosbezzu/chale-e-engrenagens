// Testes sem internet: monta uma "casa" falsa em pasta temporaria e roda a instalacao de verdade
// com arquivos que ja estao no lugar (assim nada e baixado).   node teste.js
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'lareira-teste-'));
process.env.LAREIRA_HOME = casa;
process.env.LAREIRA_TESTE = '1';
delete process.env.LAREIRA_DADOS;
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const base = WIN ? path.join(casa, 'AppData', 'Roaming') : MAC ? path.join(casa, 'Library', 'Application Support') : casa;
const mc = path.join(base, MAC ? 'minecraft' : '.minecraft');
const tlProps = path.join(base, MAC ? 'tlauncher' : '.tlauncher', 'tlauncher-2.0.properties');
const L = require('./lareira.js');

const escrever = (arquivo, texto) => { fs.mkdirSync(path.dirname(arquivo), { recursive: true }); fs.writeFileSync(arquivo, texto); };
const sha1 = (texto) => crypto.createHash('sha1').update(texto).digest('hex');
const tarefaFalsa = () => {}; // sincronizar so precisa de um "avisar"

function packFalso() {
  return L.validarPack({
    formato: 1, id: 'chale', nome: 'Chalé & Engrenagens', versao: '1.2.6', resumo: '', minecraft: '1.21.1', neoforge: '21.1.265',
    pasta: '.minecraft-chale', perfil: 'chale-e-engrenagens', icone: 'Cake', marcadorAntigo: 'chale-e-engrenagens.txt',
    arquivos: [
      { caminho: 'mods/create.jar', sha1: sha1('create'), tamanho: 6, url: 'https://cdn.modrinth.com/x/create.jar' },
      { caminho: 'shaderpacks/sombra.zip', sha1: sha1('sombra'), tamanho: 6, url: 'https://cdn.modrinth.com/x/sombra.zip' },
    ],
    configs: [{ caminho: 'config/easylan.cfg', conteudo: 'online-mode=false\n' }, { caminho: 'options.txt', conteudo: 'fov:0.5\n' }],
    ajustes: [{ arquivo: 'config/fastbench.cfg', de: '"Remove Recipe Book Button"=true', para: '"Remove Recipe Book Button"=false' }],
    historico: [],
  });
}

// Deixa os arquivos do pack e o NeoForge "ja instalados" para o teste nao precisar de rede nem de Java.
function preparar(raiz, jogo) {
  escrever(path.join(raiz, 'versions', 'neoforge-21.1.265', 'neoforge-21.1.265.json'), '{}');
  escrever(path.join(jogo, 'mods', 'create.jar'), 'create');
  escrever(path.join(jogo, 'shaderpacks', 'sombra.zip'), 'sombra');
}

async function rodar(pack, modo) {
  // sincronizar le/escreve a variavel "tarefa" do modulo; a acao HTTP e quem a cria. Aqui usamos o mesmo caminho.
  L.remoto.packs = [pack];
  await L._teste.sincronizar(pack, modo, tarefaFalsa);
}

(async () => {
  // ---- validacao do manifesto
  const ruim = (mudanca) => { const p = JSON.parse(JSON.stringify(packFalso())); mudanca(p); assert.throws(() => L.validarPack(p), /invalido/); };
  ruim((p) => { p.arquivos[0].caminho = 'mods/../../fora.jar'; });
  ruim((p) => { p.arquivos[0].caminho = '/etc/passwd'; });
  ruim((p) => { p.arquivos[0].caminho = 'saves/mundo.jar'; });
  ruim((p) => { p.arquivos[0].url = 'http://cdn.modrinth.com/x.jar'; });
  ruim((p) => { p.arquivos[0].url = 'https://exemplo.com/x.jar'; });
  ruim((p) => { p.pasta = '../fora'; });
  ruim((p) => { p.neoforge = '21.1 --x'; });
  ruim((p) => { p.configs[0].caminho = 'config/../../x'; });
  ruim((p) => { p.ajustes[0].arquivo = 'mods/x.jar'; });
  ruim((p) => { p.arquivos.push({ caminho: 'resourcepacks/x.zip', sha1: sha1('x'), tamanho: 1, url: 'https://cdn.modrinth.com/x.zip' }); }); // so em "pacotes"
  ruim((p) => { p.pacotes = [{ caminho: 'mods/x.jar', sha1: sha1('x'), tamanho: 1, url: 'https://cdn.modrinth.com/x.jar' }]; });
  ruim((p) => { p.pacotes = [{ caminho: 'resourcepacks/../x.zip', sha1: sha1('x'), tamanho: 1, url: 'https://cdn.modrinth.com/x.zip' }]; });

  // ---- notas de versao: so fotos https do CDN do Modrinth, texto vira texto
  const notas = L.validarPack({ ...JSON.parse(JSON.stringify(packFalso())), historico: [{
    versao: '1.3.0', titulo: 'Natal', tema: 'natal', mensagem: 'Oi', novidades: ['a', 3],
    secoes: [{ titulo: 'Casa', itens: ['TV', {}], fotos: [
      { url: 'https://cdn.modrinth.com/data/x/a.webp', legenda: 'boa' }, { url: 'https://exemplo.com/b.png' },
      { url: 'javascript:alert(1)' }, { url: 'http://cdn.modrinth.com/c.png' }] }],
  }] }).historico[0];
  assert.deepStrictEqual(notas.novidades, ['a']);
  assert.deepStrictEqual(notas.secoes, [{ titulo: 'Casa', itens: ['TV'], fotos: [{ url: 'https://cdn.modrinth.com/data/x/a.webp', legenda: 'boa' }] }]);
  // ---- auto-atualizacao: arquivo certo de cada sistema e lista de sha256 conferida
  assert.deepStrictEqual(L.pacoteDoSistema('1.2.0', 'win32', 'x64'), { nome: 'Lareira-1.2.0-windows-x64.exe', tipo: 'exe' });
  assert.deepStrictEqual(L.pacoteDoSistema('1.2.0', 'darwin', 'arm64'), { nome: 'Lareira-1.2.0-mac-arm64.zip', tipo: 'app' });
  assert.deepStrictEqual(L.pacoteDoSistema('1.2.0', 'linux', 'x64'), { nome: 'Lareira-1.2.0-linux-x64.tar.gz', tipo: 'tar' });
  const lista = { formato: 1, versao: '1.2.0', arquivos: { 'Lareira-1.2.0-windows-x64.exe': { sha256: 'a'.repeat(64), tamanho: 10 } } };
  assert.ok(L.infoAtualizacao(lista, '1.2.0', 'Lareira-1.2.0-windows-x64.exe'));
  assert.strictEqual(L.infoAtualizacao(lista, '1.3.0', 'Lareira-1.2.0-windows-x64.exe'), null, 'versao da lista tem que bater');
  assert.ok(!L.infoAtualizacao(lista, '1.2.0', 'Lareira-1.2.0-mac-arm64.zip'));
  assert.ok(!L.infoAtualizacao({ ...lista, arquivos: { x: { sha256: 'zz', tamanho: 1 } } }, '1.2.0', 'x'));

  assert.ok(L.cmpVersao('1.10.0', '1.9.9') > 0 && L.cmpVersao('1.2', '1.2.0') === 0 && L.cmpVersao('1.2.5', '1.2.6') < 0);

  // ---- launcher oficial: atualizacao de uma instalacao antiga (marcador .txt, perfil com outro nome)
  const pack = packFalso();
  const jogo = path.join(base, '.minecraft-chale');
  escrever(path.join(mc, 'launcher_accounts.json'), '{}');
  escrever(path.join(mc, 'launcher_profiles.json'), JSON.stringify({
    profiles: {
      vanilla: { name: '', type: 'latest-release', lastVersionId: 'latest-release' },
      'chale-e-engrenagens': { name: 'Chalé & Engrenagens 1.2.5', gameDir: jogo, javaArgs: '-Xmx8G', created: '2026-01-01T00:00:00.000Z', lastVersionId: 'neoforge-21.1.265', type: 'custom' },
      duplicado: { name: 'Chale antigo', gameDir: jogo, type: 'custom' },
    },
    settings: { x: 1 },
  }));
  preparar(mc, jogo);
  escrever(path.join(jogo, 'chale-e-engrenagens.txt'), 'Chale & Engrenagens 1.2.5');
  escrever(path.join(jogo, 'mods', 'removido.jar'), 'velho');
  escrever(path.join(jogo, 'mods', 'anotacoes.txt'), 'do jogador');
  escrever(path.join(jogo, 'config', 'easylan.cfg'), 'online-mode=false\nmeu-ajuste=1\n');
  escrever(path.join(jogo, 'config', 'fastbench.cfg'), '"Remove Recipe Book Button"=true\n');
  escrever(path.join(jogo, 'saves', 'mundo', 'level.dat'), 'mundo');

  assert.deepStrictEqual(L.launchers().oficial, { presente: true, pasta: mc });
  assert.strictEqual(L.launchers().tlauncher.presente, false);
  let e = L._teste.estadoPack(pack, 'oficial');
  assert.strictEqual(e.estado, 'atualizar');
  assert.strictEqual(e.instalada, '1.2.5');
  assert.strictEqual(e.saem, 1);

  await rodar(pack, 'oficial');
  assert.ok(!fs.existsSync(path.join(jogo, 'mods', 'removido.jar')), 'jar fora do pack deve sair');
  assert.ok(fs.existsSync(path.join(jogo, 'mods', 'anotacoes.txt')), 'so .jar e removido');
  assert.strictEqual(fs.readFileSync(path.join(jogo, 'config', 'easylan.cfg'), 'utf8'), 'online-mode=false\nmeu-ajuste=1\n', 'config existente e preservada');
  assert.strictEqual(fs.readFileSync(path.join(jogo, 'config', 'fastbench.cfg'), 'utf8'), '"Remove Recipe Book Button"=false\n', 'ajuste imposto');
  assert.strictEqual(fs.readFileSync(path.join(jogo, 'options.txt'), 'utf8'), 'fov:0.5\n', 'config que faltava e criada');
  assert.strictEqual(fs.readFileSync(path.join(jogo, 'saves', 'mundo', 'level.dat'), 'utf8'), 'mundo');
  const perfis = JSON.parse(fs.readFileSync(path.join(mc, 'launcher_profiles.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(perfis.profiles).sort(), ['chale-e-engrenagens', 'vanilla']);
  const perfil = perfis.profiles['chale-e-engrenagens'];
  assert.strictEqual(perfil.name, 'Chalé & Engrenagens 1.2.6');
  assert.strictEqual(perfil.javaArgs, '-Xmx8G', 'RAM do jogador mantida');
  assert.strictEqual(perfil.created, '2026-01-01T00:00:00.000Z');
  assert.deepStrictEqual(perfis.settings, { x: 1 });
  assert.ok(fs.existsSync(path.join(mc, 'launcher_profiles.json.bak-lareira')));
  e = L._teste.estadoPack(pack, 'oficial');
  assert.strictEqual(e.estado, 'ok');
  assert.strictEqual(e.instalada, '1.2.6');

  // ---- pacotes de recursos: entram, e so os que o Lareira instalou saem quando o pack os tira
  const comPacote = L.validarPack({ ...JSON.parse(JSON.stringify(pack)),
    pacotes: [{ caminho: 'resourcepacks/fresh.zip', sha1: sha1('fresh'), tamanho: 5, url: 'https://cdn.modrinth.com/x/fresh.zip' }] });
  escrever(path.join(jogo, 'resourcepacks', 'fresh.zip'), 'fresh');
  escrever(path.join(jogo, 'resourcepacks', 'do-jogador.zip'), 'meu');
  await rodar(comPacote, 'oficial');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(jogo, 'lareira.json'), 'utf8')).pacotes, ['resourcepacks/fresh.zip']);
  assert.strictEqual(L._teste.estadoPack(comPacote, 'oficial').tamanho, 17);
  await rodar(pack, 'oficial');
  assert.deepStrictEqual(fs.readdirSync(path.join(jogo, 'resourcepacks')), ['do-jogador.zip'], 'pacote do pack sai, o do jogador fica');

  // ---- versao anterior: o jogador pode ficar (ou voltar) na versao anterior que o manifesto traz
  const comAnterior = L.validarPack({ ...JSON.parse(JSON.stringify(pack)), anteriores: [{
    versao: '1.2.5', minecraft: '1.21.1', neoforge: '21.1.265',
    arquivos: [{ caminho: 'mods/antigo.jar', sha1: sha1('antigo'), tamanho: 6, url: 'https://cdn.modrinth.com/x/antigo.jar' }],
  }] });
  assert.throws(() => L.validarPack({ ...JSON.parse(JSON.stringify(pack)), anteriores: [{ versao: '1.2.5', minecraft: '1.21.1', neoforge: '21.1.265', arquivos: [{ caminho: '../x.jar', sha1: sha1('a'), tamanho: 1, url: 'https://cdn.modrinth.com/x' }] }] }), /invalido/);
  assert.strictEqual(L.variante(comAnterior, '1.0.0'), null);
  e = L._teste.estadoPack(comAnterior, 'oficial');
  assert.deepStrictEqual([e.versao, e.estado, e.fixada, e.versoes], ['1.2.6', 'ok', false, ['1.2.6', '1.2.5']]);
  L.config.fixado.chale = '1.2.5';
  e = L._teste.estadoPack(comAnterior, 'oficial');
  assert.deepStrictEqual([e.versao, e.maisNova, e.estado, e.fixada, e.volta], ['1.2.5', '1.2.6', 'atualizar', true, true]);
  escrever(path.join(jogo, 'mods', 'antigo.jar'), 'antigo');
  await rodar(L.variante(comAnterior, '1.2.5'), 'oficial');
  assert.deepStrictEqual(fs.readdirSync(path.join(jogo, 'mods')).sort(), ['anotacoes.txt', 'antigo.jar']);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(mc, 'launcher_profiles.json'), 'utf8')).profiles['chale-e-engrenagens'].name, 'Chalé & Engrenagens 1.2.5');
  e = L._teste.estadoPack(comAnterior, 'oficial');
  assert.deepStrictEqual([e.estado, e.instalada, e.fixada], ['ok', '1.2.5', true]);
  L.config.fixado.chale = '1.0.0'; // versao que saiu do manifesto: volta a valer a mais nova
  e = L._teste.estadoPack(comAnterior, 'oficial');
  assert.deepStrictEqual([e.versao, e.estado, e.fixada, e.volta], ['1.2.6', 'atualizar', false, false]);
  delete L.config.fixado.chale;

  // ---- TLauncher: primeira instalacao numa pasta que ja tem outros mods
  const tlJogo = path.join(casa, 'jogos tl', 'mc');
  const escapado = tlJogo.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  escrever(tlProps, `client=x\r\nminecraft.gamedir=${escapado}\r\nlogin.version.game=fabric-26.3\r\nnome=Jos\xe9\r\n`.replace(/\xe9/, 'é'));
  fs.writeFileSync(tlProps, Buffer.from(fs.readFileSync(tlProps, 'utf8'), 'latin1'));
  assert.strictEqual(L.pastaTLauncher(), tlJogo);
  assert.strictEqual(L.launchers().tlauncher.presente, true);
  escrever(path.join(tlJogo, 'mods', 'fabric-api.jar'), 'fabric');
  escrever(path.join(tlJogo, 'options.txt'), 'fov:1.0\n');
  e = L._teste.estadoPack(pack, 'tlauncher');
  assert.strictEqual(e.estado, 'ausente');
  assert.strictEqual(e.guardaMods, 1);
  // os arquivos do pack so podem "ja existir" depois do backup; entao entram pelo proprio backup
  escrever(path.join(tlJogo, 'versions', 'neoforge-21.1.265', 'neoforge-21.1.265.json'), '{}');
  escrever(path.join(tlJogo, 'shaderpacks', 'sombra.zip'), 'sombra');
  const semMod = { ...pack, arquivos: pack.arquivos.filter((a) => a.caminho.startsWith('shaderpacks/')) };
  await rodar(semMod, 'tlauncher');
  const guardado = fs.readdirSync(tlJogo).find((n) => n.startsWith('mods-antes-do-lareira-'));
  assert.ok(guardado && fs.existsSync(path.join(tlJogo, guardado, 'fabric-api.jar')), 'mods antigos guardados');
  assert.ok(fs.readdirSync(tlJogo).some((n) => n.startsWith('options-antes-do-lareira-')), 'options antigo guardado');
  assert.strictEqual(fs.readFileSync(path.join(tlJogo, 'options.txt'), 'utf8'), 'fov:0.5\n');
  const props = fs.readFileSync(tlProps, 'latin1');
  assert.ok(props.includes('login.version.game=neoforge-21.1.265\r\n') && !props.includes('fabric-26.3'));
  assert.ok(props.includes('nome=Jos\xe9\r\n'), 'Latin-1 e fim de linha preservados');
  assert.strictEqual(L._teste.estadoPack(semMod, 'tlauncher').estado, 'ok');
  // segunda rodada: nada de backup novo
  await rodar(semMod, 'tlauncher');
  assert.strictEqual(fs.readdirSync(tlJogo).filter((n) => n.startsWith('mods-antes-do-lareira-')).length, 1);

  // ---- apagar com acento no caminho (fs.rmSync do Node 24 no Windows falha calado com isso)
  const acento = path.join(casa, 'José Conceição', 'mods ç');
  escrever(path.join(acento, 'sub pasta', 'a.jar'), 'a');
  escrever(path.join(acento, 'b.jar'), 'b');
  L._teste.apagar(path.join(acento, 'b.jar'));
  assert.ok(!fs.existsSync(path.join(acento, 'b.jar')), 'arquivo com acento no caminho apagado');
  L._teste.apagar(path.dirname(acento));
  assert.ok(!fs.existsSync(path.dirname(acento)), 'pasta com acento apagada');
  L._teste.apagar(path.join(casa, 'nao existe'));

  // ---- gravacao segura: troca de uma vez, sem deixar arquivo temporario, e respeita Latin-1
  const seguro = path.join(casa, 'José', 'perfis.json');
  L._teste.gravar(seguro, '{"a":1}');
  L._teste.gravar(seguro, '{"a":2}');
  assert.strictEqual(fs.readFileSync(seguro, 'utf8'), '{"a":2}');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(seguro)), ['perfis.json'], 'sem sobra de arquivo temporario');
  L._teste.gravar(seguro, 'nome=Jos\xe9', 'latin1');
  assert.deepStrictEqual([...fs.readFileSync(seguro)].slice(-1), [0xe9]);
  assert.ok(!fs.readdirSync(mc).some((n) => n.includes('tmp-lareira')), 'perfis do launcher sem sobra');

  // ---- Windows com dois Minecraft Launcher: o da Store ganha, a nao ser que o jogador fixe o classico
  const E = L._teste.escolherOficial, classico = 'C:\\x\\MinecraftLauncher.exe';
  assert.strictEqual(E({ store: true, classico }, null), 'store');
  assert.strictEqual(E({ store: false, classico }, null), 'classico');
  assert.strictEqual(E({ store: true, classico }, 'classico'), 'classico');
  assert.strictEqual(E({ store: true, classico: null }, 'classico'), 'store');
  assert.strictEqual(E({ store: false, classico }, 'store'), 'classico');
  assert.strictEqual(E({ store: false, classico: null }, null), 'store', 'nenhum achado: tenta o atalho da Store');

  // ---- nome para o executavel antigo: reaproveita o .velho quando da para apagar
  const velho = path.join(casa, 'Lareira.exe.velho');
  escrever(velho, 'x');
  assert.strictEqual(L._teste.nomeLivre(velho), velho);
  assert.ok(!fs.existsSync(velho));

  // ---- changelog do Lareira: toda versao do launcher tem entrada no topo de historico.json
  const historicoLareira = JSON.parse(fs.readFileSync(path.join(__dirname, 'historico.json'), 'utf8'));
  const pacoteLareira = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.strictEqual(L._teste.VERSAO, pacoteLareira.version, 'VERSAO do lareira.js igual a do package.json');
  assert.strictEqual(historicoLareira[0].versao, pacoteLareira.version, 'escreva a entrada desta versao no topo de launcher/historico.json');
  for (const h of historicoLareira) {
    assert.ok(/^\d+\.\d+\.\d+$/.test(h.versao) && /^\d{4}-\d{2}-\d{2}$/.test(h.data) && h.titulo && h.novidades.length, `entrada ${h.versao} completa`);
    assert.ok(!JSON.stringify(h).includes('\u2014'), 'sem travessao no historico');
  }
  for (let i = 1; i < historicoLareira.length; i++) assert.ok(L.cmpVersao(historicoLareira[i - 1].versao, historicoLareira[i].versao) > 0, 'historico da mais nova para a mais antiga');
  assert.strictEqual(L._teste.validarLauncher({ versao: '1.0.0; x' }), null);
  const lan = L._teste.validarLauncher({ versao: '9.0.0', pagina: 'https://github.com/x', historico: [
    { versao: '9.0.0', titulo: 'nove', novidades: ['a'] }, { versao: 'x' }, { versao: '8.0.0', novidades: [1] }, ...historicoLareira,
  ] });
  assert.deepStrictEqual(lan.historico.map((h) => h.versao), ['9.0.0', ...historicoLareira.map((h) => h.versao)], 'entradas invalidas saem');
  L.remoto.launcher = lan;
  assert.deepStrictEqual(L.estado().lareira.novidadesNova.map((h) => h.versao), ['9.0.0'], 'o que muda na versao que esta chegando');
  // acabou de se atualizar: mostra o que mudou desde a versao gravada
  L.config.lareira = historicoLareira[1].versao;
  L._teste.lembrarVersao();
  let at = L.estado().lareira.atualizado;
  assert.deepStrictEqual([at.de, at.novidades.map((h) => h.versao)], [historicoLareira[1].versao, [pacoteLareira.version]]);
  assert.strictEqual(L.config.lareira, pacoteLareira.version, 'versao atual gravada');
  L._teste.lembrarVersao();
  assert.strictEqual(L.estado().lareira.atualizado, null, 'mesma versao: sem aviso');
  // vindo da 1.2.0 (que nao gravava a versao) com cache: aviso so com a versao atual
  delete L.config.lareira;
  fs.mkdirSync(path.join(L._teste.DADOS, 'cache'), { recursive: true });
  L._teste.lembrarVersao();
  at = L.estado().lareira.atualizado;
  assert.deepStrictEqual([at.de, at.novidades.map((h) => h.versao)], [null, [pacoteLareira.version]]);

  fs.rmSync(casa, { recursive: true, force: true });
  console.log('tudo certo');
})().catch((erro) => { console.error(erro); process.exit(1); });
