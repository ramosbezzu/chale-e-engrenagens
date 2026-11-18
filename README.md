# Lareira

Launcher cozy em pixel art para os modpacks **Chalé & Engrenagens** e **Trilhos & Engrenagens** (NeoForge 1.21.1).

O Lareira não roda o jogo sozinho: ele instala e atualiza o pack dentro do **Minecraft Launcher oficial** ou do **TLauncher** e depois abre o launcher que você usa. Chega de copiar pasta de mods.

## Baixar

Pegue o arquivo do seu sistema na página de [releases](https://github.com/ramosbezzu/chale-e-engrenagens/releases/latest):

| Sistema | Arquivo | Como abrir |
|---|---|---|
| Windows | `Lareira-x.y.z-windows-x64.exe` | Dois cliques. Se o SmartScreen avisar, "Mais informações" e "Executar assim mesmo". |
| macOS (Apple Silicon) | `Lareira-x.y.z-mac-arm64.zip` | Descompacte, botão direito no Lareira, "Abrir". No macOS 15+, libere em Ajustes, Privacidade e Segurança, "Abrir mesmo assim". |
| macOS (Intel) | `Lareira-x.y.z-mac-x64.zip` | Igual ao de cima. |
| Debian / Ubuntu | `lareira_x.y.z_amd64.deb` | `sudo apt install ./lareira_x.y.z_amd64.deb` e procure "Lareira" no menu. |
| Outras distros | `Lareira-x.y.z-linux-x64.tar.gz` | Extraia e rode `./lareira`. |

Os executáveis não são assinados, por isso os avisos do Windows e do macOS.

## Como usar

1. Abra uma vez o Minecraft Launcher (ou o TLauncher), entre na conta e feche.
2. Abra o Lareira, escolha o pack e clique em **Instalar**. Na primeira vez ele baixa o NeoForge e os mods direto do Modrinth.
3. Clique em **Jogar**: o launcher abre com o perfil do pack já selecionado.
4. Quando sair versão nova, o botão vira **Atualizar** e a lista de novidades mostra o que é compatível e o que não é.
5. A versão anterior continua disponível: em **Versão**, escolha "anterior" para ficar nela (ou voltar para ela) enquanto o resto do grupo não atualiza.

O que o Lareira faz em cada launcher:

- **Minecraft Launcher**: cada pack ganha uma pasta própria (`.minecraft-chale`, `.minecraft-trilhos`) e um perfil só, com a versão no nome. A sua `.minecraft` normal não é tocada.
- **TLauncher**: o pack vai para a pasta de jogo do TLauncher. Na primeira vez, os mods que já estavam lá são movidos para `mods-antes-do-lareira-DATA` (nada é apagado). A memória (RAM) continua sendo ajustada nas configurações do TLauncher.

Mundos, opções e configs que você mexeu são mantidos nas atualizações. A pasta `mods` vira um espelho exato do pack, porque quem joga junto precisa ter exatamente os mesmos mods.

## Pedir mod novo (com IA)

Abra o Claude Code nesta pasta e peça em português ("coloca o mod X no Chalé"). As regras que a IA segue para pesquisar, otimizar, testar e publicar estão em [AGENTS.md](AGENTS.md); o `CLAUDE.md` só aponta para ele. O teste de servidor é automático:

```
python ferramentas/testar_servidor.py cozy.json
```

## Publicar uma versão nova de um pack

```bash
# 1. edite cozy.json (ou mods.json): mods, "version" e uma entrada nova em "historico"
python3 build.py cozy.json          # resolve no Modrinth, gera o .mrpack e manifest/chale.json
# 2. teste (cliente e servidor) e publique
git add -A && git commit -m "Chalé 1.3.0" && git push
```

Pronto: todo Lareira aberto depois disso mostra **Atualizar**. A versão que estava publicada vira automaticamente a "anterior" dentro do manifesto (o `build.py` guarda uma; `"manter_anteriores": 2` no json do pack guarda mais). O launcher lê `manifest/index.json` e `manifest/<pack>.json` direto do branch `main` (o GitHub pode levar até 5 minutos para servir o arquivo novo).

Cada entrada de `historico` tem `versao`, `data`, `titulo`, `novidades`, `compativel` e `incompativel`. É o que aparece na tela de novidades. A partir do Lareira 1.1.0 a entrada também pode ter `mensagem`, `secoes` (título, itens e fotos do Modrinth), `despedida` e `tema` (ver AGENTS.md). Pacotes de recursos entram em `resourcepacks` e chegam pelo campo `pacotes` do manifesto.

Entre 15/11 e 06/01 o Lareira se enfeita sozinho para o Natal (pisca-pisca, árvore, trenó). Para ver fora da época: abra a janela com `&natal=1` no endereço.

`python3 build.py cozy.json --manifesto` regenera só o manifesto a partir do `.mrpack` que já existe em `dist/`, sem buscar versões novas de mods (útil para corrigir um texto do histórico).

## Publicar uma versão nova do launcher

```bash
# troque a versão em launcher/package.json e em VERSAO no launcher/lareira.js
python3 build.py cozy.json --manifesto   # atualiza a versão anunciada em manifest/index.json
git commit -am "Lareira 1.0.1" && git tag launcher-v1.0.1 && git push --follow-tags
```

O GitHub Actions monta os executáveis dos três sistemas e cria o release. Quem estiver numa versão antiga vê um aviso com o botão **Baixar**.

## Desenvolver

Precisa só do Node 24+, sem dependências.

```bash
cd launcher
node lareira.js                 # abre a interface
node teste.js                   # testes (não usam internet)
node empacotar/montar.js        # monta o executável do sistema atual em launcher/build/
LAREIRA_MANIFESTO=../manifest node lareira.js   # usa o manifesto local em vez do GitHub
```

- `launcher/lareira.js`: tudo que mexe no computador (detectar launchers, baixar, NeoForge, perfis). Serve a interface em `127.0.0.1` com um token aleatório.
- `launcher/ui/`: a interface (HTML, CSS e a cena em pixel art desenhada em canvas).
- `build.py`: resolve os mods no Modrinth e gera `manifest/`.

Dados do Lareira (log, Java 21 próprio para rodar o instalador do NeoForge, cache do manifesto): `%APPDATA%\Lareira`, `~/Library/Application Support/Lareira` ou `~/.config/lareira`.

## Licenças

Código do launcher: MIT. Fonte [Jersey 10](https://fonts.google.com/specimen/Jersey+10): SIL OFL 1.1 (`launcher/ui/FONTE-LICENCA.txt`). Os mods não são redistribuídos aqui: o Lareira baixa cada um do Modrinth, e cada mod tem a própria licença (veja `lock.json` e `cozy.lock.json`). Não é um produto oficial do Minecraft nem tem ligação com a Mojang ou a Microsoft.
