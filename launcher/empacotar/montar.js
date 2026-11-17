// Monta o executavel do Lareira para o sistema em que este script roda (Node SEA: o proprio
// binario do Node com o lareira.js e a interface embutidos). Precisa de Node 24+ e de internet
// na primeira vez (o npx baixa o postject).   node empacotar/montar.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const saida = path.join(raiz, 'build');
const pacote = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const arq = process.arch === 'arm64' ? 'arm64' : 'x64';
// No Windows o npx e um .cmd e so roda via shell; ai os argumentos precisam de aspas (caminhos com espaco).
const rodar = (cmd, args) => (WIN && cmd === 'npx'
  ? execFileSync(`npx ${args.map((a) => `"${a}"`).join(' ')}`, { stdio: 'inherit', cwd: raiz, shell: true })
  : execFileSync(cmd, args, { stdio: 'inherit', cwd: raiz }));

const fonte = fs.readFileSync(path.join(raiz, 'lareira.js'), 'utf8');
if (!fonte.includes(`const VERSAO = '${pacote.version}';`)) throw new Error('VERSAO em lareira.js diferente da version do package.json');

fs.rmSync(saida, { recursive: true, force: true });
fs.mkdirSync(saida, { recursive: true });

// 1. blob com o codigo e os arquivos da interface
const assets = {};
for (const nome of ['index.html', 'app.js', 'estilo.css', 'fonte.ttf', 'icone.png']) assets[nome] = path.join(raiz, 'ui', nome);
const cfg = path.join(saida, 'sea.json');
fs.writeFileSync(cfg, JSON.stringify({ main: path.join(raiz, 'lareira.js'), output: path.join(saida, 'lareira.blob'), disableExperimentalSEAWarning: true, assets }));
rodar(process.execPath, ['--experimental-sea-config', cfg]);

// 2. copia do Node que vira o launcher
const exe = path.join(saida, WIN ? 'Lareira.exe' : 'lareira');
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);
if (MAC) rodar('codesign', ['--remove-signature', exe]);
if (WIN) {
  // Icone (antes de injetar o blob, que tambem mexe nos recursos do .exe). Opcional: se falhar, segue sem.
  try {
    rodar('npx', ['--yes', 'resedit-cli', '--in', exe, '--out', exe, '--ignore-signed', '--icon', `1,${path.join(__dirname, 'lareira.ico')}`,
      '--product-name', 'Lareira', '--file-description', 'Lareira', '--product-version', `${pacote.version}.0`, '--file-version', `${pacote.version}.0`]);
  } catch (e) { console.warn('sem icone:', e.message); }
}

// 3. injeta o blob
rodar('npx', ['--yes', 'postject', exe, 'NODE_SEA_BLOB', path.join(saida, 'lareira.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', ...(MAC ? ['--macho-segment-name', 'NODE_SEA'] : [])]);

if (WIN) {
  // O node.exe e um programa de console; troca o subsistema do PE para GUI (2) para nao abrir janela preta.
  const b = fs.readFileSync(exe);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('nao parece um .exe');
  b.writeUInt16LE(2, pe + 24 + 68);
  fs.writeFileSync(exe, b);
}
if (MAC) rodar('codesign', ['--sign', '-', exe]);
fs.rmSync(cfg); fs.rmSync(path.join(saida, 'lareira.blob'));

// 4. pacote de cada sistema
const v = pacote.version;
if (WIN) {
  fs.renameSync(exe, path.join(saida, `Lareira-${v}-windows-${arq}.exe`));
} else if (MAC) {
  const app = path.join(saida, 'Lareira.app', 'Contents');
  fs.mkdirSync(path.join(app, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Resources'), { recursive: true });
  fs.renameSync(exe, path.join(app, 'MacOS', 'lareira'));
  fs.copyFileSync(path.join(__dirname, 'lareira.icns'), path.join(app, 'Resources', 'lareira.icns'));
  fs.writeFileSync(path.join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Lareira</string>
  <key>CFBundleDisplayName</key><string>Lareira</string>
  <key>CFBundleIdentifier</key><string>io.github.ramosbezzu.lareira</string>
  <key>CFBundleExecutable</key><string>lareira</string>
  <key>CFBundleIconFile</key><string>lareira</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${v}</string>
  <key>CFBundleVersion</key><string>${v}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`);
  rodar('codesign', ['--force', '--deep', '--sign', '-', path.join(saida, 'Lareira.app')]);
  rodar('ditto', ['-c', '-k', '--keepParent', path.join(saida, 'Lareira.app'), path.join(saida, `Lareira-${v}-mac-${arq}.zip`)]);
  fs.rmSync(path.join(saida, 'Lareira.app'), { recursive: true });
} else {
  // .deb (Debian/Ubuntu) e um .tar.gz para as outras distros
  const debArq = arq === 'arm64' ? 'arm64' : 'amd64';
  const deb = path.join(saida, 'deb');
  const por = (rel, conteudo, modo) => { const p = path.join(deb, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, conteudo, { mode: modo || 0o644 }); };
  fs.mkdirSync(path.join(deb, 'opt', 'lareira'), { recursive: true });
  fs.copyFileSync(exe, path.join(deb, 'opt', 'lareira', 'lareira'));
  fs.chmodSync(path.join(deb, 'opt', 'lareira', 'lareira'), 0o755);
  fs.mkdirSync(path.join(deb, 'usr', 'bin'), { recursive: true });
  fs.symlinkSync('/opt/lareira/lareira', path.join(deb, 'usr', 'bin', 'lareira'));
  por('usr/share/icons/hicolor/256x256/apps/lareira.png', fs.readFileSync(path.join(raiz, 'ui', 'icone.png')));
  por('usr/share/applications/lareira.desktop', `[Desktop Entry]
Type=Application
Name=Lareira
Comment=Launcher cozy de modpacks
Exec=/opt/lareira/lareira
Icon=lareira
Terminal=false
Categories=Game;
`);
  por('DEBIAN/control', `Package: lareira
Version: ${v}
Section: games
Priority: optional
Architecture: ${debArq}
Recommends: xdg-utils
Maintainer: ramosbezzu <ramosbezzu@users.noreply.github.com>
Homepage: ${pacote.homepage}
Description: Launcher cozy de modpacks
 Instala e atualiza os modpacks dentro do Minecraft Launcher oficial
 ou do TLauncher e abre o launcher escolhido.
`);
  rodar('dpkg-deb', ['--build', '--root-owner-group', deb, path.join(saida, `lareira_${v}_${debArq}.deb`)]);
  fs.rmSync(deb, { recursive: true });
  rodar('tar', ['-czf', path.join(saida, `Lareira-${v}-linux-${arq}.tar.gz`), '-C', saida, 'lareira']);
  fs.rmSync(exe);
}
console.log('pronto:', fs.readdirSync(saida).join(', '));
