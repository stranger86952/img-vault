#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, getpass, json, shutil, sys
from pathlib import Path
try:
    from PIL import Image, ImageSequence
except ImportError:
    print("Pillow が必要です。例: python -m pip install pillow", file=sys.stderr)
    raise
ROOT=Path(__file__).resolve().parent; DATA=ROOT/'data'; I=ROOT/'i'; TPL=ROOT/'assets'/'tpl.html'
def u32(x): return x & 0xffffffff
def imul(a,b): return ((a&0xffffffff)*(b&0xffffffff))&0xffffffff
def hash128(s:str):
    h1,h2,h3,h4=0xdeadbeef,0x41c6ce57,0x9e3779b9,0x85ebca6b
    for ch in s:
        k=ord(ch); h1=imul(h1^k,2654435761); h2=imul(h2^k,1597334677); h3=imul(h3^k,2246822507); h4=imul(h4^k,3266489909)
    h1=u32(h1^(h1>>16)); h2=u32(h2^(h2>>15)); h3=u32(h3^(h3>>16)); h4=u32(h4^(h4>>15))
    return [h1 or 0x243f6a88,h2 or 0x85a308d3,h3 or 0x13198a2e,h4 or 0x03707344]
class PRNG:
    def __init__(self,seed): self.a,self.b,self.c,self.d=seed
    def next(self):
        t=u32(self.a ^ u32(self.a<<11)); self.a,self.b,self.c=self.b,self.c,self.d; self.d=u32(self.d ^ (self.d>>19) ^ t ^ (t>>8)); return self.d
def xor_stream(buf:bytes, seed):
    p=PRNG(seed); out=bytearray(len(buf))
    for i in range(0,len(buf),4):
        r=p.next(); out[i]=buf[i]^(r&255)
        if i+1<len(buf): out[i+1]=buf[i+1]^((r>>8)&255)
        if i+2<len(buf): out[i+2]=buf[i+2]^((r>>16)&255)
        if i+3<len(buf): out[i+3]=buf[i+3]^((r>>24)&255)
    return bytes(out)
def load_rgba(path):
    with Image.open(path) as im:
        frames=getattr(im,'n_frames',1) or 1
        frame=next(ImageSequence.Iterator(im)).copy() if frames>1 else im.copy()
        rgba=frame.convert('RGBA')
        return rgba.width,rgba.height,rgba.tobytes(),{'format':im.format or 'UNKNOWN','frames':int(frames),'mode':im.mode,'note':'Stored as RGBA pixels. Not exact original file bytes.'}
def build(path,pw,rounds,file_id):
    name=path.name; w,h,plain,source=load_rgba(path); actual_id=file_id or f'/i/{name}/'; seed=hash128(f'imgpass-v6\n{actual_id}\n{pw}')
    for i in range(rounds): seed=hash128(':'.join(map(str,seed))+':'+str(i))
    cipher=xor_stream(plain,seed)
    return {'version':6,'type':'raw-rgba-xor-xorshift128-fast-seed','name':name,'id':actual_id,'source':source,'width':w,'height':h,'channels':4,'rounds':rounds,'ciphertextEncoding':'base64','ciphertext':base64.b64encode(cipher).decode('ascii')}
def rebuild_index():
    items=[]
    if DATA.exists():
        for p in sorted(DATA.glob('*.json'), key=lambda x:x.name.lower()):
            name=p.name[:-5]
            if (I/name/'index.html').exists(): items.append(name)
    lis='\n'.join(f'        <li><a href="./{name}/">{name}</a></li>' for name in items) or '        <li><span>no images</span></li>'
    html='<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Images</title><link rel="stylesheet" href="../assets/style.css"></head><body><main class="wrap"><section class="card list-card"><h1 class="list-title">Images</h1><ul class="image-list">\n'+lis+'\n      </ul></section></main></body></html>'
    I.mkdir(exist_ok=True); (I/'index.html').write_text(html,encoding='utf-8')
def main():
    ap=argparse.ArgumentParser(description='画像から GitHub Pages 用のパスワード画像 data を生成します。')
    ap.add_argument('image', nargs='?'); ap.add_argument('--password'); ap.add_argument('--rounds',type=int,default=0); ap.add_argument('--id',dest='file_id'); ap.add_argument('--force',action='store_true'); ap.add_argument('--rebuild-index',action='store_true')
    a=ap.parse_args()
    if a.rebuild_index and not a.image: rebuild_index(); print('generated: i/index.html'); return 0
    if not a.image: ap.error('image is required unless --rebuild-index is used')
    path=Path(a.image); path=(Path.cwd()/path).resolve() if not path.is_absolute() else path
    if not path.exists(): print(f'画像ファイルが存在しません: {path}',file=sys.stderr); return 1
    pw=a.password
    if pw is None:
        pw=getpass.getpass('password: '); pw2=getpass.getpass('password again: ')
        if pw!=pw2: print('パスワードが一致しません。',file=sys.stderr); return 1
    try:
        data=build(path,pw,a.rounds,a.file_id); page=I/path.name/'index.html'; data_path=DATA/f'{path.name}.json'; page.parent.mkdir(parents=True,exist_ok=True); DATA.mkdir(exist_ok=True)
        for p in (page,data_path):
            if p.exists() and not a.force: raise FileExistsError(f'{p} は既にあります。--force で上書きできます。')
        shutil.copyfile(TPL,page); data_path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8'); rebuild_index()
    except Exception as e:
        print(f'error: {e}',file=sys.stderr); return 1
    print(f'generated: {page.relative_to(ROOT)}'); print(f'generated: {data_path.relative_to(ROOT)}'); print('generated: i/index.html'); print(f"source  : {data['source']['format']} {data['width']}x{data['height']}"); print(f'url path: /i/{path.name}/'); return 0
if __name__=='__main__': raise SystemExit(main())
