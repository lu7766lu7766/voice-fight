#!/usr/bin/env python3
"""把 art/raw/ 裡的原始圖（例如 Gemini 生成的圖）整理成遊戲用的圖檔，並產生 public/img/manifest.json。

需要 Python 3 與 Pillow、numpy：pip install pillow numpy
用法：python3 scripts/art.py            （處理全部）
      python3 scripts/art.py --ground 0.84   （指定背景圖地面高度，0~1 由上往下）

原始圖放法：
  art/raw/chars/<角色id>/idle.png    待機（必要），也可以直接放 art/<角色id>/idle.png
  art/raw/chars/<角色id>/attack.png  出招
  art/raw/chars/<角色id>/hurt.png    受傷
  art/raw/chars/<角色id>/win.png     勝利
  art/raw/fx/<名稱>.png               特效圖：黑底 → 發光疊加；綠底／白底 → 去背
  art/raw/bg.png                      戰鬥背景
角色 id：xiaoyao linger yueru anu jingchou yuer
角色圖請用純綠（#00FF00）或純白背景、角色面向右邊、腳踩在圖的下緣附近。
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'art'
RAW = Path(os.environ.get('ART_RAW', ART / 'raw'))
OUT = ROOT / 'public' / 'img'
EXTS = ('.png', '.jpg', '.jpeg', '.webp')
CHAR_IDS = ('xiaoyao', 'linger', 'yueru', 'anu', 'jingchou', 'yuer')

CHAR_CANVAS_H = 600     # 原圖整張畫布縮放成的高度（px），同一角色每張圖用同樣比例
CHAR_UNITS = 150        # 整張畫布高度相當於幾個遊戲單位（角色約 130 單位高）
FX_MAX = 512
BG_W = 1280


def find(folder, stem=None):
    if not folder.exists():
        return []
    files = sorted(p for p in folder.iterdir() if p.suffix.lower() in EXTS)
    return [p for p in files if stem is None or p.stem == stem]


def border_color(rgb):
    a = np.asarray(rgb)
    edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    return np.median(edge, axis=0)


def has_alpha(img):
    if img.mode != 'RGBA':
        return False
    a = np.asarray(img)[:, :, 3]
    return a[0, 0] < 10 and a[-1, -1] < 10


def cut_out(img, tol=60):
    """從畫面四周往內填色，把和背景相連的近似色當成背景去掉，角色內部同色不受影響。"""
    if has_alpha(img):
        return img.convert('RGBA')
    rgb = img.convert('RGB')
    bg = border_color(rgb)
    filled = rgb.copy()
    # 填色用的記號色：要和背景差很多（Pillow 遇到相近色會直接不填）
    sentinel = tuple(int(v) ^ 0xFF for v in np.round(bg).astype(int))
    sentinel = (sentinel[0] | 1, sentinel[1] & 0xFE, sentinel[2] | 1)
    w, h = filled.size
    step = max(1, min(w, h) // 64)
    seeds = [(x, 0) for x in range(0, w, step)] + [(x, h - 1) for x in range(0, w, step)] + \
            [(0, y) for y in range(0, h, step)] + [(w - 1, y) for y in range(0, h, step)]
    px = filled.load()
    for s in seeds:
        c = np.array(px[s])
        if tuple(c) == sentinel or np.abs(c - bg).max() > tol:
            continue
        ImageDraw.floodfill(filled, s, sentinel, thresh=tol)
    a = np.asarray(filled)
    mask = np.all(a == sentinel, axis=2)
    # 被頭髮、手臂圍起來的背景色空隙（從四周填不到）：同色且不是零星小點的也去掉
    near = np.abs(np.asarray(rgb).astype(np.int16) - bg).max(axis=2) <= tol
    holes = Image.fromarray((near * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    mask |= np.asarray(holes) > 0
    alpha = Image.fromarray(np.where(mask, 0, 255).astype(np.uint8))
    # 邊緣柔化 + 去除背景色溢色
    band = np.asarray(alpha.filter(ImageFilter.MinFilter(5))) < 255
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
    out = np.asarray(rgb).astype(np.int16).copy()
    if bg[1] > bg[0] + 60 and bg[1] > bg[2] + 60:  # 綠幕
        r, g, b = out[:, :, 0], out[:, :, 1], out[:, :, 2]
        # 邊緣一律去綠；內部只處理明顯是綠幕殘留的小點（綠遠大於紅藍）
        spill = band | (g > 2 * np.maximum(r, b) + 40)
        g[spill] = np.minimum(g[spill], np.maximum(r[spill], b[spill]))
    rgba = np.dstack([out.clip(0, 255).astype(np.uint8), np.asarray(alpha)])
    return Image.fromarray(rgba, 'RGBA')


def save_webp(img, path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, 'WEBP', quality=88, method=6, **kw)


def rel(path):
    return path.relative_to(ROOT / 'public').as_posix()


def char_files(cid):
    """art/raw/chars/<id>/ 和 art/<id>/ 都可以放，同一個動作兩邊都有時以 art/raw/ 為準。"""
    files = {f.stem: f for f in find(ART / cid)}
    files.update({f.stem: f for f in find(RAW / 'chars' / cid)})
    return [files[k] for k in sorted(files)]


def do_chars(manifest, prev):
    for cid in CHAR_IDS:
        poses = {}
        for f in char_files(cid):
            img = Image.open(f)
            k = CHAR_CANVAS_H / img.height
            img = cut_out(img)
            img = img.resize((round(img.width * k), CHAR_CANVAS_H), Image.LANCZOS)
            box = img.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
            if not box:
                print(f'  ! {f.relative_to(ROOT)} 去背後是空的，略過')
                continue
            img = img.crop(box)
            # 腳底中心：最下面 8% 的不透明像素平均 x（換算回原畫布座標）
            a = np.asarray(img.getchannel('A')) > 128
            rows = a[int(a.shape[0] * 0.92):]
            xs = np.nonzero(rows)[1]
            foot = box[0] + (float(xs.mean()) if len(xs) else img.width / 2)
            out = OUT / 'chars' / cid / (f.stem + '.webp')
            save_webp(img, out)
            poses[f.stem] = {'src': rel(out), 'w': img.width, 'h': img.height, 'left': box[0], 'foot': foot,
                             'u': round(CHAR_UNITS / CHAR_CANVAS_H, 4)}
            print(f'  角色 {cid}/{f.stem}: {img.width}x{img.height}')
        if poses:
            # 同一角色的圖構圖相同，一律用待機圖的腳底位置，抬腳、跨步的動作才不會左右跳
            base = poses['idle']['foot'] if 'idle' in poses else None
            for e in poses.values():
                foot, left = e.pop('foot'), e.pop('left')
                e['ax'] = round((foot if base is None else base) - left, 1)
        # 原始圖已經刪掉、但之前處理好的圖還在的動作照樣保留
        for pose, e in prev.get(cid, {}).items():
            if pose not in poses and (ROOT / 'public' / e['src']).exists():
                poses[pose] = e
                print(f'  角色 {cid}/{pose}: 沒有原始圖，沿用已處理的 {e["src"]}')
        if poses:
            manifest['chars'][cid] = dict(sorted(poses.items()))


def do_fx(manifest):
    for f in find(RAW / 'fx'):
        img = Image.open(f)
        bg = border_color(img.convert('RGB'))
        if has_alpha(img):
            blend = 'source-over'
            img = img.convert('RGBA')
        elif bg.max() < 45:
            # 黑底發光圖：直接用「相加」混色疊上去，黑色自然消失
            blend = 'lighter'
            img = img.convert('RGB')
            arr = np.asarray(img).astype(np.int16) - int(bg.max())
            img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
        else:
            blend = 'source-over'
            img = cut_out(img)
        box = (img.getchannel('A') if img.mode == 'RGBA' else img.convert('L').point(lambda v: 255 if v > 12 else 0)).getbbox()
        if box:
            img = img.crop(box)
        img.thumbnail((FX_MAX, FX_MAX), Image.LANCZOS)
        out = OUT / 'fx' / (f.stem + '.webp')
        save_webp(img, out)
        manifest['fx'][f.stem] = {'src': rel(out), 'w': img.width, 'h': img.height, 'blend': blend}
        print(f'  特效 {f.stem}: {img.width}x{img.height} ({blend})')


def do_bg(manifest, ground):
    files = find(RAW, 'bg')
    if not files:
        return
    img = Image.open(files[0]).convert('RGB')
    img = img.resize((BG_W, round(img.height * BG_W / img.width)), Image.LANCZOS)
    out = OUT / 'bg.webp'
    save_webp(img, out)
    manifest['bg'] = {'src': rel(out), 'w': img.width, 'h': img.height, 'ground': ground}
    print(f'  背景: {img.width}x{img.height}，地面 {ground}')


def main():
    ground = 0.85
    old = OUT / 'manifest.json'
    prev = {}
    if old.exists():
        prev = json.loads(old.read_text(encoding='utf8'))
        if prev.get('bg'):
            ground = prev['bg'].get('ground', ground)
    if '--ground' in sys.argv:
        ground = float(sys.argv[sys.argv.index('--ground') + 1])
    manifest = {'chars': {}, 'fx': {}, 'bg': None}
    do_chars(manifest, prev.get('chars', {}))
    do_fx(manifest)
    do_bg(manifest, ground)
    OUT.mkdir(parents=True, exist_ok=True)
    old.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding='utf8')
    print('已寫入', old.relative_to(ROOT))


if __name__ == '__main__':
    main()
