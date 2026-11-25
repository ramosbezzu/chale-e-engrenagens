---
name: lareira-moder
description: Cria, corrige e publica mods próprios da Lareira (NeoForge 1.21.1) para os packs Chalé e Trilhos. Use quando um mod do pack crasha ou tem bug e dá para consertar com mixin, quando o dono pede para mudar o comportamento de um mod ("edita o Create para...", "faz um mod que..."), quando um mundo não abre por culpa de um mod, ou quando pedir /lareira-moder. Prefira isto a instalar um mod de terceiro só para consertar outro.
---

# lareira-moder: nossos mods e consertos

Leia também o `AGENTS.md` da raiz (versionamento, publicação, armadilhas). Português do Brasil, sem travessão.

## Antes de escrever código

1. **Precisa mesmo de código?** Nesta ordem: já é possível no jogo (ex.: girar a máquina mais rápido), config do mod (`overrides-cozy/config/` mais `"ajustes"`), datapack, e só então mixin.
2. **Ache a causa, não só o sintoma.** Stack trace, depois o bytecode da versão exata do pack (`.teste/jdk/*/bin/javap -p -c -cp .teste/servidor-chale/mods/<jar> 'pacote.Classe$Interna'`), depois o repositório e as issues do mod. O código do branch `dev` pode já ser outro: o que vale é o bytecode.
3. **Pode olhar e aproveitar** o que existe no GitHub se a licença deixar (MIT, LGPL...): credite no código. Não copie arte, nome nem código de mod "All Rights Reserved"; escreva a nossa versão. Nada de redistribuir o `.jar` de outro mod modificado: mixin por cima, sempre.
4. O conserto vale para host e convidado? Mod com bloco, item, entidade ou pacote de rede tem que estar igual nos dois.

## Estrutura

```
mods-proprios/
  lareira-fixes/            consertos de mods dos outros (um mixin por problema)
    mod.json                id, nome, versao (X.Y.Z), jar
    src/lareira/fixes/...   .java
    recursos/               neoforge.mods.toml (com ${versao}), *.mixins.json, assets/, data/
  jars/                     .jar compilados, versionados no git: é daqui que o Lareira baixa
```

- Conserto de crash ou bug: mais um mixin em `lareira-fixes`. Mudança de jogabilidade ou conteúdo novo: mod separado (`lareira-<tema>`), para poder tirar um sem tirar o outro.
- Todo mod nosso entra em `"proprios"` do `cozy.json` (ou `mods.json`).
- **Um `.jar` publicado nunca muda**: mudou o código, sobe a `versao` no `mod.json`. O jar antigo fica em `jars/` (a versão anterior do pack ainda baixa ele).

## Escrever mixin

- Nomes em runtime são os oficiais da Mojang: `remap = false`, sem refmap.
- Classe interna ou não pública: `@Mixin(targets = "a.b.C$Interna", remap = false)`.
- Prefira injeções pequenas (`@Inject`, `@ModifyVariable`, MixinExtras `@ModifyExpressionValue` / `@WrapOperation`, que já vem no NeoForge) a `@Overwrite` e `@Redirect`. Métodos novos com prefixo `lareira$`.
- `"defaultRequire": 1` sempre: se o mod de origem mudar, o teste de servidor acusa em vez de o conserto sumir calado.
- No `neoforge.mods.toml`, prenda a dependência à versão em que o bug existe (ex.: `[6.0.10,6.0.11)`). Se ela subir, o jogo avisa na hora e revemos o conserto.
- Conferir se outro mod do pack já mexe na mesma classe (`unzip -l` e os `*.mixins.json` dos jars).
- Comentário no topo da classe: erro, issue, causa e por que o conserto resolve.
- Mixin de cliente vai em `"client"` no `.mixins.json`. O montador compila contra o servidor: classes só de cliente precisam de classpath extra (o `client-*-srg.jar` de `.minecraft/libraries/net/minecraft/client/`).

## Compilar

```
python ferramentas/montar_mod.py mods-proprios/lareira-fixes
```

Sem Gradle: `javac` contra `.teste/servidor-chale` (rode o `testar_servidor.py` uma vez antes). `--refazer` só para versão que ainda não foi publicada.

## Validar (obrigatório: A/B)

1. **A, sem o mod**: reproduza o problema num servidor de teste. Se não reproduziu, você ainda não sabe se conserta.
2. **B, com o mod**: mesma situação, sem erro, por pelo menos 2 minutos, e com o comportamento certo (não só "não crashou").
3. Problema num mundo específico: copie o mundo (nunca teste no save real), renomeie a cópia para `world` num servidor de teste separado, suba e use `forceload add x1 z1 x2 z2` no console para carregar a área. Servidor sem jogador não carrega chunk sozinho. Para observar: `execute as @e[type=...] run data get entity @s Pos` e `data get block x y z`.
4. `python ferramentas/testar_servidor.py cozy.json` com `RESULTADO: OK`.

## Publicar no pack

1. Entrada no histórico, versão nova (conserto = CORRECAO, conteúdo = MENOR).
2. Conserto urgente: `python build.py cozy.json --congelado` mantém todos os mods da versão publicada e troca só os nossos (precisa do `.mrpack` publicado em `dist/`). Fora isso, build normal.
3. Confira que o diff do manifesto é só o esperado, commit e push. O jar e o manifesto vão **no mesmo push**.
4. Depois do push, confira que a URL do jar em `raw.githubusercontent.com` responde com o sha1 do manifesto.

## Mundo que não abre

1. Jogo fechado. Copie o save inteiro para `.minecraft-chale/backups-recuperacao/<mundo> <data>` antes de qualquer coisa.
2. Prefira consertar o mod a editar o save: o mundo fica intacto. Editar `.mca` é último recurso, sempre na cópia primeiro.
3. Não conte com cópia anterior do Windows: em 2026-11-25 não havia backup do save em lugar nenhum além do `level.dat_old` e do `.dat_old` do jogador (que não guardam o terreno).
