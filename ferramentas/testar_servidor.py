#!/usr/bin/env python3
"""Sobe um servidor NeoForge de teste com os mods do pack, gera um mundo e desliga.

  python ferramentas/testar_servidor.py cozy.json          (Chale & Engrenagens)
  python ferramentas/testar_servidor.py mods.json          (Trilhos & Engrenagens)
  opcoes: --tempo 900  --ram 6  --manter-mundo

Usa o .mrpack de dist/ (rode o build.py antes). Tudo fica em .teste/ (fora do git):
cache de downloads, Java 21 proprio se o do sistema nao servir, e a pasta do servidor.
Sai com codigo 0 se o servidor chegou no "Done" sem crash, 1 caso contrario.
So stdlib: roda igual no Windows, no WSL, no Linux e no Mac.
"""
import hashlib, json, os, platform, queue, re, shutil, subprocess, sys, tarfile, threading, time
import urllib.request, zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = RAIZ / ".teste"
CACHE = TESTE / "cache"
UA = {"User-Agent": "chale-e-engrenagens-teste/1.0"}
WIN = os.name == "nt"


# Erros que aparecem em todo boot do pack e nao quebram nada: loot tables e receitas de
# compatibilidade com mods que nao estao no pack (o Steam 'n' Rails sozinho gera centenas).
# Ao confirmar que um erro novo e inofensivo, acrescente aqui com um comentario.
RUIDO = [
    r"Couldn't parse element ResourceKey\[minecraft:root / minecraft:loot_table\]",
    r"Parsing error loading recipe createdeco:placard",  # receita do Create Deco, quebrada no proprio mod
    r"Sable/\]: Failed to apply tag physics properties\. Unknown block: copycats:",  # tag do Sable cita bloco que o Copycats+ nao tem
]


def baixar(url, destino, sha1=None):
    destino = Path(destino)
    if destino.exists() and (not sha1 or hashlib.sha1(destino.read_bytes()).hexdigest() == sha1):
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    parte = destino.with_suffix(destino.suffix + ".parte")
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r, open(parte, "wb") as f:
                shutil.copyfileobj(r, f)
            if sha1 and hashlib.sha1(parte.read_bytes()).hexdigest() != sha1:
                raise RuntimeError("sha1 diferente")
            parte.replace(destino)
            return destino
        except Exception as e:  # noqa: BLE001
            erro = e
            time.sleep(2 * (tentativa + 1))
    raise SystemExit(f"falha ao baixar {url}: {erro}")


def versao_java(java):
    try:
        saida = subprocess.run([str(java), "-version"], capture_output=True, text=True, timeout=30).stderr
    except (OSError, subprocess.TimeoutExpired):
        return 0
    m = re.search(r'version "(\d+)(?:\.(\d+))?', saida)
    if not m:
        return 0
    return int(m.group(2)) if m.group(1) == "1" else int(m.group(1))


def achar_java():
    """Java 21 (o NeoForge 1.21.1 pede 21; 25+ ainda nao e garantido)."""
    nome = "java.exe" if WIN else "java"
    candidatos = []
    if os.environ.get("JAVA"):
        candidatos.append(Path(os.environ["JAVA"]))
    if shutil.which("java"):
        candidatos.append(Path(shutil.which("java")))
    lareira = [Path(os.environ["APPDATA"]) / "Lareira" / "java"] if os.environ.get("APPDATA") else []
    lareira += [Path.home() / ".config" / "lareira" / "java", Path.home() / "Library/Application Support/Lareira/java"]
    for base in lareira + [TESTE / "java"]:
        if base.is_dir():
            candidatos += list(base.glob(f"*/bin/{nome}")) + list(base.glob(f"*/Contents/Home/bin/{nome}"))
    for java in candidatos:
        if versao_java(java) == 21:
            return java
    print("Baixando Java 21 (Eclipse Temurin) para .teste/java ...")
    so = "windows" if WIN else "mac" if sys.platform == "darwin" else "linux"
    arq = "aarch64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    pacote = baixar(f"https://api.adoptium.net/v3/binary/latest/21/ga/{so}/{arq}/jre/hotspot/normal/eclipse",
                    CACHE / ("jre21.zip" if WIN else "jre21.tar.gz"))
    shutil.rmtree(TESTE / "java", ignore_errors=True)
    (TESTE / "java").mkdir(parents=True)
    if WIN:
        zipfile.ZipFile(pacote).extractall(TESTE / "java")
    else:
        tarfile.open(pacote).extractall(TESTE / "java")
    achados = list((TESTE / "java").glob(f"*/bin/{nome}")) + list((TESTE / "java").glob(f"*/Contents/Home/bin/{nome}"))
    if not achados:
        raise SystemExit("nao consegui preparar o Java 21")
    return achados[0]


def mrpack(cfg):
    seguro = re.sub(r"[^A-Za-z0-9]+", "-", cfg["name"].replace("&", "e")).strip("-")
    caminho = RAIZ / "dist" / f"{seguro}-{cfg['version']}.mrpack"
    if not caminho.exists():
        raise SystemExit(f"{caminho.name} nao existe: rode  python build.py {sys.argv[1]}  antes")
    return caminho


def main():
    args = sys.argv[1:]
    if not args or args[0].startswith("-"):
        raise SystemExit(__doc__)
    opcao = lambda nome, padrao: int(args[args.index(nome) + 1]) if nome in args else padrao
    tempo, ram = opcao("--tempo", 900), opcao("--ram", 6)
    cfg = json.loads((RAIZ / args[0]).read_text(encoding="utf-8"))
    pacote = zipfile.ZipFile(mrpack(cfg))
    index = json.loads(pacote.read("modrinth.index.json"))
    neo = index["dependencies"]["neoforge"]
    srv = TESTE / f"servidor-{cfg.get('id', Path(args[0]).stem)}"
    java = achar_java()
    print(f"Pack {cfg['name']} {cfg['version']} | NeoForge {neo} | Java {java}")

    # 1. NeoForge server (reaproveita se ja for a mesma versao)
    marca = srv / ".neoforge"
    if not marca.exists() or marca.read_text().strip() != neo:
        shutil.rmtree(srv, ignore_errors=True)
        srv.mkdir(parents=True)
        inst = baixar(f"https://maven.neoforged.net/releases/net/neoforged/neoforge/{neo}/neoforge-{neo}-installer.jar",
                      CACHE / f"neoforge-{neo}-installer.jar")
        print("Instalando o servidor NeoForge ...")
        r = subprocess.run([str(java), "-jar", str(inst), "--installServer", str(srv)], cwd=srv, capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stdout[-3000:], r.stderr[-3000:])
            raise SystemExit("instalador do NeoForge falhou")
        marca.write_text(neo)

    # 2. estado limpo a cada rodada
    for pasta in ("mods", "config", "logs", "crash-reports", "defaultconfigs"):
        shutil.rmtree(srv / pasta, ignore_errors=True)
    if "--manter-mundo" not in args:
        shutil.rmtree(srv / "world", ignore_errors=True)

    # 3. mods de servidor (env.server != unsupported), com cache por sha1
    mods = [f for f in index["files"] if f["path"].startswith("mods/") and f["env"]["server"] != "unsupported"]
    print(f"Preparando {len(mods)} mods de servidor ...")
    (srv / "mods").mkdir()
    for f in mods:
        sha1 = f["hashes"]["sha1"]
        proprio = RAIZ / "mods-proprios" / "jars" / Path(f["path"]).name
        if proprio.exists():  # mod nosso: ainda pode nao estar no GitHub
            if hashlib.sha1(proprio.read_bytes()).hexdigest() != sha1:
                raise SystemExit(f"{proprio.name} mudou depois do build: rode o build.py de novo")
            shutil.copyfile(proprio, srv / f["path"])
            continue
        jar = baixar(f["downloads"][0], CACHE / "mods" / sha1[:2] / f"{sha1}.jar", sha1)
        shutil.copyfile(jar, srv / f["path"])
    for nome in pacote.namelist():
        if nome.startswith("overrides/config/") and not nome.endswith("/"):
            destino = srv / nome[len("overrides/"):]
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_bytes(pacote.read(nome))

    (srv / "eula.txt").write_text("eula=true\n")
    (srv / "server.properties").write_text(
        "online-mode=false\nserver-port=25599\nview-distance=6\nsimulation-distance=6\nlevel-seed=chale\nspawn-protection=0\n")
    (srv / "user_jvm_args.txt").write_text(f"-Xmx{ram}G\n-Xms2G\n")
    argumentos = srv / "libraries/net/neoforged/neoforge" / neo / ("win_args.txt" if WIN else "unix_args.txt")

    # 4. sobe, espera o "Done", manda stop
    print(f"Subindo o servidor (limite {tempo}s) ...")
    inicio = time.time()
    proc = subprocess.Popen([str(java), "@user_jvm_args.txt", f"@{argumentos.relative_to(srv)}", "nogui"], cwd=srv,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    linhas = queue.Queue()
    threading.Thread(target=lambda: [linhas.put(l) for l in proc.stdout] and linhas.put(None), daemon=True).start()
    pronto = None
    while time.time() - inicio < tempo:
        try:
            linha = linhas.get(timeout=1)
        except queue.Empty:
            if proc.poll() is not None:
                break
            continue
        if linha is None:
            break
        if re.search(r"Done \(\d", linha):
            pronto = time.time() - inicio
            print(f"  servidor pronto em {pronto:.0f}s, desligando ...")
            proc.stdin.write("stop\n")
            proc.stdin.flush()
            break
    if pronto is None and proc.poll() is None:
        print("  tempo esgotado, matando o processo")
        proc.kill()
    try:
        proc.wait(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()

    # 5. resumo
    log = (srv / "logs" / "latest.log")
    texto = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    todos = [l for l in texto.splitlines() if re.search(r"/(ERROR|FATAL)\]", l)]
    erros = [l for l in todos if not any(re.search(r, l) for r in RUIDO)]
    # agrupa repeticoes (mesma mensagem sem o horario)
    vistos = {}
    for l in erros:
        chave = re.sub(r"^\[[^]]*\] ", "", l)[:240]
        vistos[chave] = vistos.get(chave, 0) + 1
    mixins = [l for l in texto.splitlines() if re.search(r"Mixin apply.*failed|MixinApplyError|InvalidMixinException", l)]
    crashes = sorted((srv / "crash-reports").glob("*.txt")) if (srv / "crash-reports").exists() else []
    print()
    print(f"Log: {log}")
    print(f"Linhas ERROR/FATAL: {len(todos)} ({len(todos) - len(erros)} sao ruido conhecido e inofensivo)")
    for chave, n in list(vistos.items())[:30]:
        print(f"  {n}x {chave}")
    if mixins:
        print("Mixins que falharam:")
        for l in mixins[:10]:
            print("  " + l[:240])
    if crashes:
        print(f"CRASH REPORT: {crashes[-1]}")
        print("\n".join(crashes[-1].read_text(encoding="utf-8", errors="replace").splitlines()[:40]))
    ok = pronto is not None and not crashes and not mixins
    print()
    print("RESULTADO: " + (f"OK (pronto em {pronto:.0f}s)" if ok else "FALHOU"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
