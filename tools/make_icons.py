"""Render web/assets/everynote-icon.svg to PNG sizes and build host/Assets/app.ico + installer wizard images.
Needs: playwright (node) with chromium for rasterising, python PIL.   usage: python tools/make_icons.py"""
import os, subprocess, sys, io, json
from PIL import Image
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
svg = open(os.path.join(root, 'web/assets/everynote-icon.svg'), encoding='utf-8').read()
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
out = os.environ.get('ICON_TMP', os.path.join(root, 'dev', 'out', 'icons'))
os.makedirs(out, exist_ok=True)
js = """
import {chromium} from '%s';
import fs from 'fs';
const [svgPath, outDir, sizes] = [process.argv[2], process.argv[3], JSON.parse(process.argv[4])];
const svg = fs.readFileSync(svgPath, 'utf8');
const b = await chromium.launch({executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p = await b.newPage({deviceScaleFactor: 1});
for (const s of sizes) {
  await p.setViewportSize({width: s, height: s});
  await p.setContent('<body style="margin:0;background:transparent">' + svg.replace(/width="256" height="256"/, 'width="' + s + '" height="' + s + '"') + '</body>');
  await p.screenshot({path: outDir + '/icon-' + s + '.png', omitBackground: true});
}
await b.close();
""" % os.environ.get('PW', '/tmp/npmtest/node_modules/playwright/index.mjs')
tmpjs = os.path.join(out, 'render.mjs'); open(tmpjs, 'w').write(js)
subprocess.check_call(['node', tmpjs, os.path.join(root, 'web/assets/everynote-icon.svg'), out, json.dumps(sizes + [512])])
imgs = [Image.open(os.path.join(out, f'icon-{s}.png')).convert('RGBA') for s in sizes]
ico = os.path.join(root, 'host/Assets/app.ico')
imgs[-1].save(ico, format='ICO', sizes=[(s, s) for s in sizes], append_images=[])
# PIL's ICO writer resamples from the largest image; that is fine for 16..256
Image.open(os.path.join(out, 'icon-512.png')).save(os.path.join(root, 'web/assets/everynote-icon-512.png'))
Image.open(os.path.join(out, 'icon-256.png')).save(os.path.join(root, 'web/assets/everynote-icon-256.png'))
import shutil; shutil.copy(ico, os.path.join(root, 'installer/everynote.ico'))
# Inno wizard images (BMP): large 164x314, small 55x55
big = Image.new('RGB', (164, 314), (43, 58, 155))
grad = Image.new('RGB', (1, 314))
for y in range(314):
    t = y / 313; grad.putpixel((0, y), (int(91 + (43 - 91) * t), int(124 + (58 - 124) * t), int(250 + (155 - 250) * t)))
big.paste(grad.resize((164, 314)), (0, 0))
ic = Image.open(os.path.join(out, 'icon-128.png')).convert('RGBA')
big.paste(ic, (18, 70), ic)
big.save(os.path.join(root, 'installer/wizard-large.bmp'))
sm = Image.new('RGB', (55, 55), (255, 255, 255)); i48 = Image.open(os.path.join(out, 'icon-48.png')).convert('RGBA'); sm.paste(i48, (4, 4), i48)
sm.save(os.path.join(root, 'installer/wizard-small.bmp'))
print('ok')
