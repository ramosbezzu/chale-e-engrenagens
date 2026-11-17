#!/usr/bin/env python3
"""Resolve mods.json contra a API do Modrinth e gera lock.json, o .mrpack e o manifesto do launcher.

  python3 build.py cozy.json               resolve tudo de novo (versao nova do pack)
  python3 build.py cozy.json --manifesto   so regenera manifest/ a partir do .mrpack existente
"""
import json, re, sys, time, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API = "https://api.modrinth.com/v2"
UA = "minecreatepak-builder/1.0"
RANK = {"release": 0, "beta": 1, "alpha": 2}


def get(path):
    req = urllib.request.Request(API + path, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 and e.code < 500:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(f"falhou: {path}")


def pick(slug, cfg):
    versions = [
        v for v in get(f"/project/{slug}/version")
        if cfg["minecraft"] in v["game_versions"] and "neoforge" in v["loaders"]
    ]
    if not versions:
        raise SystemExit(f"{slug}: sem build NeoForge {cfg['minecraft']}")
    pin = cfg.get("pins", {}).get(slug)
    if pin:
        match = [v for v in versions if v["version_number"] == pin]
        if not match:
            raise SystemExit(f"{slug}: pin {pin} nao encontrado")
        return match[0]
    # Modrinth devolve do mais novo para o mais antigo; sort estavel mantem isso.
    return sorted(versions, key=lambda v: RANK[v["version_type"]])[0]


def environment(project):
    # Singleplayer roda um servidor integrado, entao o cliente sempre leva tudo,
    # mesmo mods que o Modrinth marca como "server only" (ex.: worldgen).
    server = "unsupported" if project["server_side"] == "unsupported" else "required"
    return {"client": "required", "server": server}


# O que muda de uma versao do pack para outra (o resto do manifesto e igual para todas).
CAMPOS_VERSAO = ("versao", "minecraft", "neoforge", "arquivos", "configs", "ajustes")


def mrpack_path(cfg):
    safe = re.sub(r"[^A-Za-z0-9]+", "-", cfg["name"].replace("&", "e")).strip("-")
    return ROOT / "dist" / f"{safe}-{cfg['version']}.mrpack"


def manifest(cfg):
    """Gera manifest/<id>.json (o que o launcher Lareira baixa do GitHub) a partir do .mrpack."""
    with zipfile.ZipFile(mrpack_path(cfg)) as z:
        index = json.loads(z.read("modrinth.index.json"))
        configs = [
            {"caminho": n[len("overrides/"):], "conteudo": z.read(n).decode("utf-8")}
            for n in sorted(z.namelist()) if n.startswith("overrides/") and not n.endswith("/")
        ]
    out = ROOT / "manifest"
    out.mkdir(exist_ok=True)
    destino = out / f"{cfg['id']}.json"
    # A versao que estava publicada continua disponivel no launcher como "anterior"
    # (para quem ainda nao pode atualizar, ou se a nova der problema).
    numero = lambda v: tuple(int(x) for x in v["versao"].split("."))
    anteriores = []
    if destino.exists():
        antigo = json.loads(destino.read_text(encoding="utf-8"))
        candidatas = [{k: antigo[k] for k in CAMPOS_VERSAO}] + antigo.get("anteriores", [])
        atual = tuple(int(x) for x in cfg["version"].split("."))
        candidatas = sorted((c for c in candidatas if numero(c) < atual), key=numero, reverse=True)
        anteriores = candidatas[:cfg.get("manter_anteriores", 1)]
    pack = {
        "formato": 1,
        "id": cfg["id"],
        "nome": cfg.get("titulo", cfg["name"]),
        "versao": cfg["version"],
        "resumo": cfg["summary"],
        "minecraft": cfg["minecraft"],
        "neoforge": cfg["neoforge"],
        "pasta": cfg["pasta"],
        "perfil": cfg["perfil"],
        "icone": cfg.get("icone", "Furnace"),
        "marcadorAntigo": cfg.get("marcador_antigo"),
        "arquivos": [
            {"caminho": f["path"], "sha1": f["hashes"]["sha1"], "tamanho": f["fileSize"], "url": f["downloads"][0]}
            for f in index["files"]
        ],
        "configs": configs,
        "ajustes": cfg.get("ajustes", []),
        "historico": cfg.get("historico", []),
        "anteriores": anteriores,
    }
    destino.write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    packs = []
    for path in sorted(out.glob("*.json")):
        if path.name != "index.json":
            p = json.loads(path.read_text(encoding="utf-8"))
            packs.append({"id": p["id"], "arquivo": path.name, "nome": p["nome"], "versao": p["versao"]})
    launcher = json.loads((ROOT / "launcher" / "package.json").read_text(encoding="utf-8"))
    (out / "index.json").write_text(json.dumps({
        "formato": 1,
        "launcher": {"versao": launcher["version"], "pagina": launcher["homepage"] + "/releases/latest"},
        "packs": packs,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"manifesto -> manifest/{cfg['id']}.json ({len(pack['arquivos'])} arquivos, "
          f"anterior: {', '.join(a['versao'] for a in anteriores) or 'nenhuma'})")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cfg_path = ROOT / (args[0] if args else "mods.json")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    if "--manifesto" in sys.argv:
        # So regenera o manifesto do launcher a partir do .mrpack ja existente (nao resolve mods de novo).
        return manifest(cfg)
    lock_path = ROOT / ("lock.json" if cfg_path.stem == "mods" else f"{cfg_path.stem}.lock.json")
    queue = [(s, group) for group, slugs in cfg["mods"].items() for s in slugs]
    resolved, conflicts = {}, []
    while queue:
        ref, group = queue.pop(0)
        project = get(f"/project/{ref}")
        pid = project["id"]
        if pid in resolved:
            continue
        version = pick(project["slug"], cfg)
        resolved[pid] = {"project": project, "version": version, "group": group}
        for dep in version["dependencies"]:
            dep_pid = dep["project_id"]
            if dep_pid is None and dep["version_id"]:
                dep_pid = get(f"/version/{dep['version_id']}")["project_id"]
            if dep["dependency_type"] == "required":
                queue.append((dep_pid, "Dependencias"))
            elif dep["dependency_type"] == "incompatible":
                conflicts.append((project["slug"], dep_pid))
    for slug, other in conflicts:
        if other in resolved:
            raise SystemExit(f"conflito: {slug} x {resolved[other]['project']['slug']}")

    files, lock = [], []
    for item in sorted(resolved.values(), key=lambda i: i["project"]["slug"]):
        p, v = item["project"], item["version"]
        f = next((x for x in v["files"] if x["primary"]), v["files"][0])
        env = environment(p)
        files.append({
            "path": f"mods/{f['filename']}",
            "hashes": {"sha1": f["hashes"]["sha1"], "sha512": f["hashes"]["sha512"]},
            "env": env,
            "downloads": [f["url"]],
            "fileSize": f["size"],
        })
        lock.append({
            "slug": p["slug"], "title": p["title"], "group": item["group"],
            "version": v["version_number"], "type": v["version_type"],
            "published": v["date_published"][:10], "env": env, "file": f["filename"],
            "license": p["license"]["id"],
        })
    shader_default = None
    for slug in cfg.get("shaders", []):
        project = get(f"/project/{slug}")
        version = next(v for v in get(f"/project/{slug}/version") if "iris" in v["loaders"])
        f = next((x for x in version["files"] if x["primary"]), version["files"][0])
        files.append({
            "path": f"shaderpacks/{f['filename']}",
            "hashes": {"sha1": f["hashes"]["sha1"], "sha512": f["hashes"]["sha512"]},
            "env": {"client": "required", "server": "unsupported"},
            "downloads": [f["url"]],
            "fileSize": f["size"],
        })
        lock.append({
            "slug": slug, "title": project["title"], "group": "Shaders",
            "version": version["version_number"], "type": version["version_type"],
            "published": version["date_published"][:10],
            "env": {"client": "required", "server": "unsupported"}, "file": f["filename"],
            "license": project["license"]["id"],
        })
        if slug == cfg.get("default_shader"):
            shader_default = f["filename"]

    index = {
        "formatVersion": 1, "game": "minecraft",
        "versionId": cfg["version"], "name": cfg["name"], "summary": cfg["summary"],
        "files": files,
        "dependencies": {"minecraft": cfg["minecraft"], "neoforge": cfg["neoforge"]},
    }
    lock_path.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    out = mrpack_path(cfg)
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("modrinth.index.json", json.dumps(index, indent=2, ensure_ascii=False))
        if shader_default:
            z.writestr("overrides/config/iris.properties",
                       f"shaderPack={shader_default}\n"
                       f"enableShaders={str(cfg.get('shaders_enabled', True)).lower()}\n")
        overrides = ROOT / cfg.get("overrides", "overrides")
        if overrides.is_dir():
            for path in sorted(overrides.rglob("*")):
                if path.is_file():
                    z.write(path, Path("overrides") / path.relative_to(overrides))
    print(f"{len(files)} mods -> {out}")
    manifest(cfg)


if __name__ == "__main__":
    sys.exit(main())
