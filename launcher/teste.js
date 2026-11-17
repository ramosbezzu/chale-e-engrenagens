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

  fs.rmSync(casa, { recursive: true, force: true });
  console.log('tudo certo');
})().catch((erro) => { console.error(erro); process.exit(1); });
