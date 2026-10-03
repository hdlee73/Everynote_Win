// Generates dev/samples/*.pdf using Chromium (Korean + English text). Run: node dev/make-samples.mjs
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const pages = Array.from({ length: 12 }, (_, i) => `<section style="page-break-after:always;height:1000px"><h1>PDF Note 샘플 문서 — ${i + 1}쪽</h1>
<p>The quick brown fox jumps over the lazy dog. 다람쥐 헌 쳇바퀴에 타고파. 필기와 하이라이트, 검색을 시험하기 위한 문장입니다.</p>
<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>
<h2>${i + 1}. 세부 검토사항</h2><p>토큰증권 2026 — 한글 변환 테스트 문장입니다. Search for fox and 다람쥐.</p>
<table border=1 cellpadding=6 style="border-collapse:collapse"><tr><td>항목</td><td>값</td></tr><tr><td>A</td><td>${i * 3}</td></tr></table></section>`).join('');
await p.setContent(`<html><body style="font-family:'Noto Sans CJK KR','Noto Sans KR',sans-serif;font-size:16px;padding:40px">${pages}</body></html>`);
await p.pdf({ path: new URL('./samples/sample-ko.pdf', import.meta.url).pathname, format: 'A4', printBackground: true });
await b.close(); console.log('ok');
