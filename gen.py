#!/usr/bin/env python3
from __future__ import annotations

import argparse
import getpass
import json
import mimetypes
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

try:
    from PIL import Image
except ImportError:
    Image = None


ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
DATA = ROOT / "data"
I = ROOT / "i"
TPL = ASSETS / "tpl.html"


def u32(x: int) -> int:
    return x & 0xFFFFFFFF


def imul(a: int, b: int) -> int:
    return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF


def hash128(s: str) -> list[int]:
    h1, h2, h3, h4 = 0xDEADBEEF, 0x41C6CE57, 0x9E3779B9, 0x85EBCA6B

    for ch in s:
        k = ord(ch)
        h1 = imul(h1 ^ k, 2654435761)
        h2 = imul(h2 ^ k, 1597334677)
        h3 = imul(h3 ^ k, 2246822507)
        h4 = imul(h4 ^ k, 3266489909)

    h1 = u32(h1 ^ (h1 >> 16))
    h2 = u32(h2 ^ (h2 >> 15))
    h3 = u32(h3 ^ (h3 >> 16))
    h4 = u32(h4 ^ (h4 >> 15))

    return [
        h1 or 0x243F6A88,
        h2 or 0x85A308D3,
        h3 or 0x13198A2E,
        h4 or 0x03707344,
    ]


class PRNG:
    def __init__(self, seed: list[int]):
        self.a, self.b, self.c, self.d = seed

    def next(self) -> int:
        t = u32(self.a ^ u32(self.a << 11))
        self.a, self.b, self.c = self.b, self.c, self.d
        self.d = u32(self.d ^ (self.d >> 19) ^ t ^ (t >> 8))
        return self.d


def make_seed(password: str, file_id: str, rounds: int) -> list[int]:
    seed = hash128(f"imgpass-v7\n{file_id}\n{password}")

    for i in range(rounds):
        seed = hash128(":".join(map(str, seed)) + ":" + str(i))

    return seed


def xor_stream(buf: bytes, seed: list[int]) -> bytes:
    prng = PRNG(seed)
    out = bytearray(len(buf))

    for i in range(0, len(buf), 4):
        r = prng.next()

        out[i] = buf[i] ^ (r & 255)

        if i + 1 < len(buf):
            out[i + 1] = buf[i + 1] ^ ((r >> 8) & 255)

        if i + 2 < len(buf):
            out[i + 2] = buf[i + 2] ^ ((r >> 16) & 255)

        if i + 3 < len(buf):
            out[i + 3] = buf[i + 3] ^ ((r >> 24) & 255)

    return bytes(out)


def detect_image_info(path: Path) -> dict:
    mime, _ = mimetypes.guess_type(path.name)

    info = {
        "mime": mime or "application/octet-stream",
        "format": "UNKNOWN",
        "width": None,
        "height": None,
        "note": "Stored as encrypted original file bytes. Not expanded to RGBA.",
    }

    if Image is None:
        return info

    try:
        with Image.open(path) as im:
            info["format"] = im.format or "UNKNOWN"
            info["width"] = im.width
            info["height"] = im.height

            if im.format:
                fmt = im.format.lower()

                if fmt == "jpeg":
                    info["mime"] = "image/jpeg"
                elif fmt == "png":
                    info["mime"] = "image/png"
                elif fmt == "webp":
                    info["mime"] = "image/webp"
                elif fmt == "gif":
                    info["mime"] = "image/gif"
                elif fmt == "bmp":
                    info["mime"] = "image/bmp"
                elif fmt in ("tiff", "tif"):
                    info["mime"] = "image/tiff"

    except Exception:
        pass

    return info


def build_data(image_path: Path, password: str, rounds: int, file_id: str | None) -> tuple[dict, bytes]:
    name = image_path.name
    actual_id = file_id or f"/i/{name}/"

    plain = image_path.read_bytes()
    seed = make_seed(password, actual_id, rounds)
    cipher = xor_stream(plain, seed)

    image_info = detect_image_info(image_path)

    meta = {
        "version": 7,
        "type": "file-bytes-xor-xorshift128-fast-seed",
        "name": name,
        "id": actual_id,
        "mime": image_info["mime"],
        "source": {
            "format": image_info["format"],
            "width": image_info["width"],
            "height": image_info["height"],
            "originalBytes": len(plain),
            "note": image_info["note"],
        },
        "rounds": rounds,
        "dataFile": f"{name}.bin",
        "dataEncoding": "binary",
        "stream": "xorshift128 seeded by hash128(imgpass-v7/id/password)",
    }

    return meta, cipher


def rebuild_index() -> None:
    items: list[str] = []

    if DATA.exists():
        for p in sorted(DATA.glob("*.json"), key=lambda x: x.name.lower()):
            name = p.name[:-5]

            if (I / name / "index.html").exists():
                items.append(name)

    if items:
        lis = "\n".join(
            f'        <li><a href="./{quote(name)}/">{name}</a></li>'
            for name in items
        )
    else:
        lis = "        <li><span>no images</span></li>"

    index_html = f"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Images</title>
  <link rel="icon" href="../assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../assets/style.css">
</head>
<body>
  <main class="wrap">
    <section class="card list-card">
      <h1 class="list-title">Images</h1>
      <ul class="image-list">
{lis}
      </ul>

      <nav class="corner-links" aria-label="site links">
        <a class="corner-button corner-left" href="../README.md/" aria-label="README">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5v-16z"></path>
            <path d="M5 5.5A2.5 2.5 0 0 0 2.5 3H2v16h.5A2.5 2.5 0 0 1 5 21.5"></path>
          </svg>
        </a>

        <a id="repoLink" class="corner-button corner-right" href="https://github.com/" target="_blank" rel="noopener" aria-label="repository">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 18.5c-3 .8-3-1.5-4.2-2"></path>
            <path d="M16 22v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.7 1.4a12.5 12.5 0 0 0-6.7 0C6.7 1.4 5.6 1.7 5.6 1.7a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 4.1 9c0 5.1 3.1 6.3 6.1 6.6a3 3 0 0 0-.8 1.9V22"></path>
          </svg>
        </a>
      </nav>
    </section>
  </main>

  <script>
    (() => {{
      const link = document.getElementById("repoLink");
      if (!link) return;

      const host = location.hostname;
      if (!host.endsWith(".github.io")) return;

      const owner = host.replace(/\\.github\\.io$/, "");
      const parts = location.pathname.split("/").filter(Boolean);
      const repo = parts[0] && parts[0] !== "i" && parts[0] !== "README.md"
        ? parts[0]
        : `${{owner}}.github.io`;

      link.href = `https://github.com/${{owner}}/${{repo}}`;
    }})();
  </script>
</body>
</html>
"""

    I.mkdir(exist_ok=True)
    (I / "index.html").write_text(index_html, encoding="utf-8")


def write_outputs(image_path: Path, meta: dict, cipher: bytes, force: bool) -> tuple[Path, Path, Path]:
    if not TPL.exists():
        raise FileNotFoundError(f"{TPL} がありません。")

    name = image_path.name

    page_dir = I / name
    page_path = page_dir / "index.html"

    json_path = DATA / f"{name}.json"
    bin_path = DATA / f"{name}.bin"

    page_dir.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)

    for p in (page_path, json_path, bin_path):
        if p.exists() and not force:
            raise FileExistsError(f"{p} は既にあります。--force で上書きできます。")

    shutil.copyfile(TPL, page_path)

    json_path.write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    bin_path.write_bytes(cipher)

    rebuild_index()

    return page_path, json_path, bin_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="画像ファイルを GitHub Pages 用のパスワード付き data に変換します。"
    )

    parser.add_argument("image", help="例: ./p/sample.jpg")
    parser.add_argument("--password", help="省略時は対話入力します。")
    parser.add_argument("--rounds", type=int, default=0, help="追加ハッシュ回数。既定: 0")
    parser.add_argument("--id", dest="file_id", help="seed に混ぜる固定 ID。既定: /i/<filename>/")
    parser.add_argument("--force", action="store_true", help="既存ファイルを上書きします。")

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.rounds < 0:
        print("error: --rounds は 0 以上にしてください。", file=sys.stderr)
        return 1

    image_path = Path(args.image)

    if not image_path.is_absolute():
        image_path = (Path.cwd() / image_path).resolve()

    if not image_path.exists():
        print(f"画像ファイルが存在しません: {image_path}", file=sys.stderr)
        return 1

    if not image_path.is_file():
        print(f"ファイルではありません: {image_path}", file=sys.stderr)
        return 1

    password = args.password

    if password is None:
        password = getpass.getpass("password: ")
        password2 = getpass.getpass("password again: ")

        if password != password2:
            print("パスワードが一致しません。", file=sys.stderr)
            return 1

    try:
        meta, cipher = build_data(image_path, password, args.rounds, args.file_id)
        page_path, json_path, bin_path = write_outputs(image_path, meta, cipher, args.force)

    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    print(f"generated: {page_path.relative_to(ROOT)}")
    print(f"generated: {json_path.relative_to(ROOT)}")
    print(f"generated: {bin_path.relative_to(ROOT)}")
    print("generated: i/index.html")
    print(f"source  : {meta['source']['format']} {meta['source']['width']}x{meta['source']['height']}")
    print(f"mime    : {meta['mime']}")
    print(f"bytes   : {meta['source']['originalBytes']} -> {len(cipher)}")
    print(f"url path: /i/{image_path.name}/")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())