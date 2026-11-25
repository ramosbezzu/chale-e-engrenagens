#!/usr/bin/env python3
"""Compila um mod proprio (mods-proprios/<mod>/) sem Gradle e grava o .jar em mods-proprios/jars/.

  python ferramentas/montar_mod.py mods-proprios/lareira-fixes
  opcoes: --refazer (sobrescreve um .jar da mesma versao que ainda NAO foi publicado)

Compila com o javac contra o servidor de teste (.teste/servidor-*), que tem o Minecraft, o NeoForge,
o Mixin e todos os mods do pack: rode antes o testar_servidor.py pelo menos uma vez.
O JDK 21 (Temurin) e baixado para .teste/jdk se preciso. O .jar sai identico byte a byte para o mesmo
codigo. So stdlib: roda igual no Windows e no WSL.
"""
import hashlib, io, json, os, platform, re, shutil, subprocess, sys, tarfile, urllib.request, zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TESTE = RAIZ / ".teste"
JARS = RAIZ / "mods-proprios" / "jars"
UA = {"User-Agent": "chale-e-engrenagens-teste/1.0"}
WIN = os.name == "nt"


def pegar(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        return r.read()


def achar_jdk():
    """Pasta bin de um JDK 21 (o JRE do sistema nao tem javac)."""
    nome = "javac.exe" if WIN else "javac"
    achado = shutil.which("javac")
    if achado and re.search(r"\b21\.", subprocess.run([achado, "-version"], capture_output=True, text=True).stdout):
        return Path(achado).parent
    for javac in sorted((TESTE / "jdk").glob(f"*/bin/{nome}")) + sorted((TESTE / "jdk").glob(f"*/Contents/Home/bin/{nome}")):
        return javac.parent
    so = "windows" if WIN else "mac" if platform.system() == "Darwin" else "linux"
    arq = "aarch64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    print("Baixando o JDK 21 (Eclipse Temurin) para .teste/jdk ...")
    info = json.loads(pegar("https://api.adoptium.net/v3/assets/latest/21/hotspot"
                            f"?architecture={arq}&image_type=jdk&os={so}&vendor=eclipse"))[0]["binary"]["package"]
    dados = pegar(info["link"])
    if hashlib.sha256(dados).hexdigest() != info["checksum"]:
        raise SystemExit("JDK baixado com sha256 diferente")
    (TESTE / "jdk").mkdir(parents=True, exist_ok=True)
    if info["name"].endswith(".zip"):
        zipfile.ZipFile(io.BytesIO(dados)).extractall(TESTE / "jdk")
    else:
        tarfile.open(fileobj=io.BytesIO(dados)).extractall(TESTE / "jdk", filter="data")
    return achar_jdk()


def classpath():
    srv = next((p for p in (TESTE / "servidor-chale", TESTE / "servidor-trilhos") if (p / "libraries").is_dir()), None)
    if not srv:
        raise SystemExit("rode antes  python ferramentas/testar_servidor.py cozy.json  (o mod compila contra o servidor de teste)")
    libs = [p for p in (srv / "libraries").rglob("*.jar")
            if "installertools" not in p.parts and not p.name.endswith(("-slim.jar", "-unpacked.jar", "-fatjar.jar", "-all.jar"))]
    jars = libs + sorted((srv / "mods").glob("*.jar"))
    # bibliotecas embutidas (jar-in-jar): MixinExtras no NeoForge, Catnip/Ponder no Create...
    dentro = TESTE / "jarjar"
    dentro.mkdir(exist_ok=True)
    extras = {}
    for j in jars:
        with zipfile.ZipFile(j) as z:
            for n in z.namelist():
                if n.startswith("META-INF/jarjar/") and n.endswith(".jar"):
                    destino = dentro / Path(n).name
                    if not destino.exists():
                        destino.write_bytes(z.read(n))
                    extras[destino.name] = destino
    return [str(p) for p in jars + list(extras.values())]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        raise SystemExit(__doc__)
    mod = (RAIZ / args[0]).resolve()
    meta = json.loads((mod / "mod.json").read_text(encoding="utf-8"))
    if not re.fullmatch(r"\d+\.\d+\.\d+", meta["versao"]) or not re.fullmatch(r"[a-z0-9-]+", meta["jar"]):
        raise SystemExit("mod.json: versao tem que ser X.Y.Z e jar so minusculas e hifen")
    saida = JARS / f"{meta['jar']}-{meta['versao']}.jar"
    bin_ = achar_jdk()
    obj = TESTE / "classes" / meta["jar"]
    shutil.rmtree(obj, ignore_errors=True)
    obj.mkdir(parents=True)
    fontes = sorted((mod / "src").rglob("*.java"))
    lista = obj.parent / f"{meta['jar']}.args"
    aspas = lambda s: '"' + str(s).replace("\\", "/") + '"'
    lista.write_text("\n".join(["--release 21", "-proc:none", "-g", "-encoding UTF-8", "-Xlint:-classfile", "-nowarn",
                                "-d " + aspas(obj), "-cp " + aspas(os.pathsep.join(classpath()))] + [aspas(f) for f in fontes]), encoding="utf-8")
    r = subprocess.run([str(bin_ / ("javac.exe" if WIN else "javac")), f"@{lista}"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("nao compilou:\n" + r.stdout + r.stderr)

    arquivos = {"META-INF/MANIFEST.MF": b"Manifest-Version: 1.0\r\n\r\n"}
    for base in (mod / "recursos", obj):
        for f in sorted(base.rglob("*")):
            if f.is_file():
                dados = f.read_bytes()
                if f.suffix in (".toml", ".json"):
                    dados = dados.replace(b"\r\n", b"\n").replace(b"${versao}", meta["versao"].encode())
                arquivos[f.relative_to(base).as_posix()] = dados
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for nome in sorted(arquivos, key=lambda n: (n != "META-INF/MANIFEST.MF", n)):
            i = zipfile.ZipInfo(nome, (2020, 1, 1, 0, 0, 0))  # data fixa: mesmo codigo, mesmo sha1
            i.compress_type, i.external_attr, i.create_system = zipfile.ZIP_DEFLATED, 0o644 << 16, 3
            z.writestr(i, arquivos[nome])
    JARS.mkdir(parents=True, exist_ok=True)
    # compara o conteudo: o zlib de outra maquina pode comprimir diferente
    if saida.exists():
        with zipfile.ZipFile(saida) as z:
            if {n: z.read(n) for n in z.namelist()} == arquivos:
                print(f"{saida.name}: ja esta igual ao codigo")
                return
        if "--refazer" not in sys.argv:
            raise SystemExit(f"{saida.name} ja existe com outro conteudo. Suba a versao no mod.json "
                             "(ou --refazer, so se esta versao nunca foi publicada)")
    saida.write_bytes(buf.getvalue())
    print(f"{saida.relative_to(RAIZ)}  {len(buf.getvalue())} bytes  sha1 {hashlib.sha1(buf.getvalue()).hexdigest()}")


if __name__ == "__main__":
    main()
