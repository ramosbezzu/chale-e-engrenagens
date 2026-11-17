# AGENTS.md: como manter os modpacks

Instruções para a IA (Claude Code ou outra) que for mexer neste repositório. O dono pede mods novos em linguagem natural ("coloca o mod X", "quero algo de cozinha", "o jogo está travando") e espera que a IA faça tudo: pesquisar, adicionar, otimizar, testar, versionar e publicar. Leia este arquivo inteiro antes de mexer.

Responda sempre em português do Brasil. Não use travessão (o caractere "—") em nenhum texto: nem nas respostas, nem em commits, nem no histórico do pack.

## O que é este repositório

Dois modpacks NeoForge 1.21.1 e o launcher **Lareira**, que instala e atualiza os packs a partir deste repositório público.

| Pack | Config | Lock | Overrides | Manifesto | Pasta no launcher oficial |
|---|---|---|---|---|---|
| Chalé & Engrenagens (cozy, PC fraco, o principal) | `cozy.json` | `cozy.lock.json` | `overrides-cozy/` | `manifest/chale.json` | `.minecraft-chale` |
| Trilhos & Engrenagens (tech, Create e trens) | `mods.json` | `lock.json` | (nenhum) | `manifest/trilhos.json` | `.minecraft-trilhos` |

- `build.py`: resolve os mods no Modrinth (API v2), puxa as dependências obrigatórias, acusa incompatibilidades declaradas, gera o lock, o `.mrpack` em `dist/` e o manifesto em `manifest/`.
- `manifest/`: é **o que os jogadores recebem**. O launcher lê `manifest/index.json` e `manifest/<id>.json` direto do branch `main` no GitHub. Fazer push em `main` com manifesto novo = publicar a atualização para todo mundo. Nunca faça push de manifesto não testado.
- `launcher/`: código do Lareira (Node 24, sem dependências). Só mexa nele se o pedido for sobre o launcher.
- `ferramentas/testar_servidor.py`: teste automático de servidor (seção "Testar").
- `dist/` e `.teste/` estão no `.gitignore` (têm os .jar). O `.mrpack` da versão atual precisa existir em `dist/` para o teste e para `build.py --manifesto`; se não existir, rode `python build.py cozy.json`.

Comandos: no Windows use `python` (3.10+); no WSL/Linux use `python3`. Node 24+ só para o launcher.

## Quem joga e como

- O dono hospeda pelo **Minecraft Launcher oficial** (pasta `%APPDATA%\.minecraft-chale`). PC forte, usa shaders BSL, render 24, simulação 16 por escolha própria.
- A esposa joga pelo **TLauncher** com conta offline, num PC **fraco**. Ela é jogadora casual: o pack precisa ser simples de usar e leve.
- Multiplayer por LAN via EasyLAN, conectando pelo IP do Tailscale (100.x). Host e cliente **precisam estar exatamente na mesma versão do pack**; versões diferentes dão "channel missing on the server side".
- **Nunca** instale nem rode o modo TLauncher no PC do dono: o TLauncher dele usa a `.minecraft` com mods Fabric 26.3 que não podem ser tocados.

## Fluxo para pedido de mod novo

1. **Entender o pedido.** Se o dono pediu uma categoria ("algo de cozinha"), pesquise 2 ou 3 candidatos e escolha o mais leve e mais mantido, explicando a escolha em uma linha. Se pediu um mod específico, use esse.
2. **Pesquisar no Modrinth antes de editar qualquer coisa** (`https://api.modrinth.com/v2/project/<slug>` e `/project/<slug>/version`):
   - Existe build **NeoForge 1.21.1**? Sem isso, não entra. Não use builds Forge, Fabric ou "Sinytra Connector".
   - Ela é `release`? Beta/alpha só se não houver alternativa, e diga isso ao dono.
   - Dependências obrigatórias: quantas e quais. Cada uma é peso a mais.
   - Incompatibilidades declaradas e issues abertas recentes com crash envolvendo mods que já estão no pack (Create, Sodium, Iris, Aeronautics/Sable, Carry On, Storage Drawers, Another Furniture, GraveStone).
   - `client_side` / `server_side`: mods só de cliente não vão para o servidor (o `build.py` cuida disso pelo campo `env`).
   - Mod que não está no Modrinth (só CurseForge) **não entra**: o launcher só baixa de `cdn.modrinth.com`. Avise o dono e sugira alternativa. Exemplos já conferidos: Mining Gadgets e Building Gadgets não existem no Modrinth.
   - Licença `All Rights Reserved` sem permissão de modpack: tudo bem, porque o launcher baixa do Modrinth e não redistribui o arquivo.
3. **Avaliar o custo de desempenho** (seção "Otimizar"). Se for pesado para o PC fraco, diga isso antes e proponha a versão leve ou uma config que reduza o custo.
4. **Editar o config do pack** (`cozy.json` por padrão; `mods.json` só se o pedido for para o Trilhos):
   - Coloque o slug no grupo certo de `"mods"` (Nucleo, Addons do Create, Tecnologia, Magia e Fazenda, Ferramentas, Veiculos, Comidas, Animais, Mundo, Decoracao, Storage, Qualidade de vida, Facilitadores, Performance). Crie grupo novo só se nenhum servir.
   - Não liste dependências: o `build.py` resolve sozinho (aparecem no grupo "Dependencias" do lock).
   - Precisa fixar versão? Use `"pins": {"slug": "version_number exato"}` e documente o motivo em "Armadilhas conhecidas".
5. **Subir a versão** em `"version"` (seção "Versionamento") e escrever a entrada nova no **topo** de `"historico"`.
6. **Gerar**: `python build.py cozy.json`. Leia a saída inteira. `conflito: A x B` ou `sem build NeoForge` param o processo: resolva antes de seguir.
7. **Revisar o diff do lock** (`git diff cozy.lock.json`): além do mod novo, o build sobe a versão de **todos** os outros mods para a release mais nova. Liste no histórico os mods importantes que mudaram de versão (Create, Sodium, Iris, Aeronautics, AE2). Se algum update grande for arriscado e você não puder testar, fixe a versão anterior com `pins`.
8. **Testar** (seção "Testar"). Sem teste de servidor OK, não publica.
9. **Publicar**: commit e push (seção "Publicar"). Depois diga ao dono, curto: o que entrou, o que mudou, se precisa de algo dele (ex.: abrir o jogo para testar o cliente), e lembre que host e esposa precisam clicar em **Atualizar** no Lareira antes de jogar juntos.

Pedido para **remover** mod: mesmo fluxo, sem os passos 2 e 3. No histórico, em `incompativel`, avise o que some do mundo (blocos e itens do mod removido viram ar ou somem do inventário).

Pedido de **correção de crash ou travamento**: vá para "Diagnosticar" antes de mexer na lista de mods.

## Versionamento

Versão do pack em `MAIOR.MENOR.CORRECAO`:

- **CORRECAO** (1.2.6 -> 1.2.7): só correção de crash, troca de config, remoção de mod quebrado, update de mods sem mod novo.
- **MENOR** (1.2.6 -> 1.3.0): qualquer mod novo ou grupo novo.
- **MAIOR** (1.x -> 2.0.0): troca de versão do Minecraft ou do NeoForge major, ou mudança que exige mundo novo.

Se o dono pedir um número específico ("faz a 1.2.7"), use o número dele, mesmo que a regra acima sugira outro.

Toda versão publicada fica disponível como "anterior" no launcher na versão seguinte (o `build.py` copia a versão que estava no manifesto para `"anteriores"`; `"manter_anteriores": N` no json guarda mais). Por isso:

- **Nunca** apague nem edite à mão `manifest/*.json`. Sempre gere pelo `build.py`.
- **Nunca** gere a mesma versão duas vezes com conteúdo diferente depois de publicada. Errou depois do push? Suba a CORRECAO.
- Antes do push, se precisar refazer, rode `git checkout manifest/` e gere de novo, senão a versão nova vira "anterior" dela mesma. (O `build.py` só guarda como anterior versões menores que a atual, mas o manifesto local tem que ser o publicado.)
- `python build.py cozy.json --manifesto` regenera só o manifesto a partir do `.mrpack` existente, sem buscar mods. Use para corrigir texto do histórico **antes** do push.

### Entrada de histórico

```json
{
  "versao": "1.3.0",
  "data": "AAAA-MM-DD",
  "titulo": "Curto, o tema da versão",
  "novidades": ["O que entrou, em linguagem de jogador", "Mods que mudaram de versão e importam"],
  "compativel": ["Mundos da 1.2.6 abrem normalmente"],
  "incompativel": ["Não conecta com quem está na 1.2.6: quem joga junto precisa atualizar junto", "Avisos reais de quebra"]
}
```

É isso que o jogador lê na tela de novidades do launcher. Escreva para a esposa do dono entender: nada de nome de arquivo .jar, nada de jargão. `incompativel` sempre traz a linha de multiplayer quando a lista de mods mudou.

## Otimizar

O alvo do Chalé é o **PC fraco**. Regras:

- Antes de adicionar, pergunte-se: mexe em geração de mundo, entidades por tick ou renderização? Esses são os caros. Decoração, comida e QoL costumam ser baratos.
- Mods de worldgen pesados ficam fora do Chalé (Tectonic foi tirado de propósito). Estruturas novas: prefira as que usam o Structure Layout Optimizer bem (YUNG's, Towns and Towers).
- Mods que adicionam muitas entidades ou mobs com IA complexa: cuidado, e confira se AI Improvements e Entity Culling cobrem.
- Shaders ficam **desligados por padrão** no Chalé (`"shaders_enabled": false`). Não mude isso.
- Grupo Performance atual (não remova sem motivo forte): sodium, sodium-extra, reeses-sodium-options, lithium, ferrite-core, modernfix, immediatelyfast, entityculling, moreculling, dynamic-fps, badoptimizations, fastsuite, fastworkbench, fastfurnace, ksyxis, clumps, lmd, alternate-current, ai-improvements, neruina, modelfix, spark, packet-fixer, structure-layout-optimizer, zfastnoise, chunky, colorwheel.
- Mod novo de otimização: confira se não duplica um que já existe (ex.: dois mods de culling, dois de pathfinding) e se é compatível com Sodium 0.8+ e Iris.
- Config que deixa mais leve: coloque o arquivo em `overrides-cozy/config/` (vale para instalação nova) **e** uma regra em `"ajustes"` do `cozy.json` (`{"arquivo", "de", "para"}`), que o launcher aplica também em quem já tem o pack instalado com a config antiga. Os ajustes atuais (EasyLAN offline, livro de receitas, radar do Xaero, Flywheel FLAT, Sable 160, maxBlocksMoved 16384) devem continuar.
- Configs de servidor do NeoForge 1.21.1 ficam em `config/`, não em `saves/*/serverconfig`.
- Não mexa em `options.txt` nem em RAM do jogador. O launcher calcula a RAM pelo PC (3 a 6 GB).

## Testar

Ordem mínima para toda versão nova:

1. **Build limpo**: `python build.py cozy.json` sem conflito.
2. **Servidor** (obrigatório, automático):
   ```
   python ferramentas/testar_servidor.py cozy.json
   ```
   Instala o servidor NeoForge em `.teste/`, coloca só os mods de servidor, gera um mundo novo e desliga. Precisa terminar com `RESULTADO: OK`. Se falhar, leia o log que ele aponta: a primeira exceção com nome de mod geralmente é a culpada. Mixin que falha também conta como falha. Na primeira vez baixa o Java 21 e uns 400 MB de mods (fica em cache).
3. **Manifesto e launcher**: `node launcher/teste.js` (sem internet) tem que dizer `tudo certo`. Confira que `manifest/<id>.json` tem a versão nova e a anterior em `"anteriores"`.
4. **Cliente**: a IA não consegue abrir o jogo. Peça ao dono, numa frase: "abre o Lareira, clica em Atualizar, entra num mundo de teste e me avisa". Depois leia `%APPDATA%\.minecraft-chale\logs\latest.log` (no WSL: `/mnt/c/Users/<usuario>/AppData/Roaming/.minecraft-chale/logs/latest.log`) e `crash-reports/`. Teste o que o mod novo faz e o que já quebrou antes: **Shift + botão direito** em bloco e em baú (Carry On), abrir a bancada (livro de receitas), uma contraption do Create andando, e entrar na LAN com a esposa se possível.
5. Se o teste de cliente não aconteceu ainda, publique mesmo assim só se o servidor passou, e diga claramente ao dono que o cliente não foi testado.

## Diagnosticar crash ou travamento

1. Peça o que aconteceu e quando (abrindo o jogo, gerando mundo, ao clicar em algo, ao conectar na LAN).
2. Leia o crash report mais recente e o `latest.log` da pasta do jogo. Procure a primeira exceção, `Mixin apply failed`, `Caused by`, e nomes de mod no stack trace.
3. **Config corrompida**: o PC do dono desliga sozinho às vezes (Kernel-Power 41, problema de energia/hardware, não do pack). Isso deixa arquivos de `config/` só com bytes nulos, que derrubam mods em cascata (ex.: spark com config nula gera o falso erro "sodium_extra not found in ModList"). Procure arquivos em `config/` cujo conteúdo é todo `\x00` e mova para uma pasta `_corrompidos-DATA` fora de `config/`; o mod recria o arquivo.
4. "channel missing on the server side" na LAN = versões diferentes entre host e cliente. Os dois atualizam pelo Lareira.
5. Mod culpado identificado: remova ou fixe a versão boa (`pins`), suba CORRECAO, registre em "Armadilhas conhecidas".
6. Travamento (não crash): peça ao dono para rodar `/spark profiler start`, jogar 1 a 2 minutos, `/spark profiler stop` e mandar o link.

## Publicar

```
git add -A
git commit -m "Chalé 1.3.0: <resumo curto>"
git push
```

- Commit com o autor `ramosbezzu <ramosbezzu@users.noreply.github.com>` (já configurado neste clone). Nunca use e-mail pessoal: o repositório é público.
- Em até uns 5 minutos todo Lareira aberto mostra "Atualizar".
- Não crie tag para versão de pack. Tag `launcher-vX.Y.Z` é só para versão nova do launcher (ver `README.md`) e dispara o build no GitHub Actions.
- O `.mrpack` em `dist/` não vai para o git. Se o dono pedir o arquivo para outro launcher, ele está em `dist/`.

## Armadilhas conhecidas (não repita)

- **Steam 'n' Rails** fixado em `0.3.0-beta.2+neoforge-mc1.21.1`: a 0.2.1 é anterior ao fix de crash com Create 6.0.10.
- **Create** parou na 1.21.1: é por isso que o pack é 1.21.1. Não suba o Minecraft.
- **hoe-scythes** REMOVIDO: crasha no carregamento ("Cannot get config value before config is loaded"). O Instrumentus substitui (foice, martelo 3x3, paxel).
- **carryon-aeronautics-compat** REMOVIDO: a 1.1.1 falha o mixin no Carry On 2.2.6.13 e crasha com Shift + botão direito. Não recoloque sem checar versão.
- **Sable** (do Create Aeronautics) exige Sodium >= 0.8.12 e Create [6.0.10, 6.1.0). Update do Create para 6.1 quebra o Aeronautics: confira antes.
- **Create Aeronautics** tem defeito visual com shaders Iris. **Colorwheel** é necessário para o Flywheel funcionar com shaders.
- Patches que ficam por causa do Aeronautics: `create-aeronautics-compatability` (Another Furniture, Storage Drawers) e `gravestone-and-sable-compatibility-patch`.
- **Iron Chests** não tem build NeoForge 1.21.1. O Sophisticated Storage já cobre baús melhores.
- **FastWorkbench** esconde o livro de receitas por padrão; o pack força `"Remove Recipe Book Button"=false` (a esposa sentiu falta).
- **EasyLAN** vem com `online-mode=true`; o pack força `false` para a conta offline do TLauncher conseguir entrar.
- Tirados de propósito do Chalé por desempenho ou foco: Tectonic, Diesel Generators, Power Loader, Create Crafts & Additions.
- **Skins**: o **Skin Restorer** não serve, porque não funciona no TLauncher (ele sobrescreve o sistema de skins do cliente). O pack usa o **Quick Skin** (cliente e servidor, sincroniza pelo próprio mod, menu na tela inicial e na pausa). Os limites de 128x128 e 1 MB em `quickskin-server.json` são de propósito, por causa do PC fraco.
- **Cozinha**: Cooking for Blockheads (funcional, lê receitas de todos os mods de comida) e Delicious Kitchen Appliances (micro-ondas, fogão, lava-louças) convivem bem; o servidor sobe sem erro novo com os dois (1.2.7).
- A pasta portátil antiga (`Chale-e-Engrenagens-<versao>` com `.bat` e `.ps1`) está **aposentada**: o Lareira substitui. Não gere mais.

Ao descobrir uma armadilha nova, adicione aqui no mesmo commit da correção.
