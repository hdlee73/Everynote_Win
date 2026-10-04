// Unit tests for js/store.js + js/shapes.js + painter pure parts. Runs in node (host.js falls back to its in-memory fake FS).
// usage: node dev/store-test.mjs     (ports of StudyStoreTest, StickyStyleTest, AttachmentTest, TypingSearchTest, PageEditTest, ... expectations)
import assert from 'node:assert/strict';
globalThis.window = globalThis;
const { AnnotationStore, JSONException, Mark, PageElement, InkStroke, InkPoint, StudyEntry, OutlineItem, TranslationNote, stringify } = await import('../web/js/store.js');
const { Shapes, Table } = await import('../web/js/shapes.js');
const { AnnotationPainter, Typeface } = await import('../web/js/painter.js');
const { host } = await import('../web/js/host.js');

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const throwsJson = (fn, msg) => assert.throws(fn, e => e instanceof JSONException && (!msg || e.message === msg));
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const U = () => 'C:\\Docs\\' + crypto.randomUUID() + '.pdf';
const uuid = () => crypto.randomUUID();
const el = (o = {}) => Object.assign(new PageElement(), o);
const rt = e => PageElement.fromJson(JSON.parse(stringify(e.toJson())));

// ------------------------------------------------------------------ StickyStyleTest
test('stickyStyleSurvivesSaveAndLoad', () => {
  const m = new Mark(); m.note = '메모'; m.noteOnly = true; m.paper = 0xFFCFE8FF | 0; m.fontSp = 20; m.boxSize = 2;
  const back = Mark.fromJson(JSON.parse(stringify(m.toJson())));
  assert.equal(back.paper, 0xFFCFE8FF | 0); assert.equal(back.fontSp, 20); assert.equal(back.boxSize, 2);
});
test('oldNotesKeepTheDefaultLook', () => {
  const old = Mark.fromJson({ page: 1, note: 'x' });
  assert.equal(old.paper, 0xFFFFF3A6 | 0); assert.equal(old.fontSp, 13); assert.equal(old.boxSize, 1);
  assert.equal(old.color, 0x66FFEB3B); assert.equal(old.visible, true); assert.ok(Number.isNaN(old.left));
});
test('outOfRangeStyleIsClamped', () => {
  const odd = Mark.fromJson({ fontSp: 99, boxSize: 9 }); assert.equal(odd.fontSp, 28); assert.equal(odd.boxSize, 2);
  const low = Mark.fromJson({ fontSp: -3, boxSize: -1 }); assert.equal(low.fontSp, 9); assert.equal(low.boxSize, 0);
});

// ------------------------------------------------------------------ StudyStoreTest
const entry = () => { const e = new StudyEntry(); e.page = 1; e.x = .3; e.y = .7; e.text = '한글, "English"\nNext <line>'; e.comment = '설명\t뒤쪽'; e.excerpt = true; return e; };
test('notesPersistAndDocumentsStaySeparate', async () => {
  const uri = U(); const store = await new AnnotationStore().open(uri);
  store.studyEntries.push(entry()); await store.save();
  const again = await new AnnotationStore().open(uri);
  assert.equal(again.studyEntries.length, 1); near(again.studyEntries[0].y, .7, .001);
  assert.equal(again.studyEntries[0].text, '한글, "English"\nNext <line>'); assert.equal(again.studyEntries[0].comment, '설명\t뒤쪽');
  await again.open(U()); assert.equal(again.studyEntries.length, 0);
});
test('backupRestoresNotesAndExistingAnnotations', async () => {
  const uri = U(); const store = await new AnnotationStore().open(uri);
  store.studyEntries.push(entry()); store.bookmarks.add(1);
  const json = store.exportJson(uri, 'document.pdf'); store.studyEntries.length = 0;
  await store.importJson(json, 2); assert.equal(store.studyEntries.length, 1); assert.ok(store.bookmarks.has(1));
});
test('failedImportDoesNotEraseExistingNotes', async () => {
  const uri = U(); const store = await new AnnotationStore().open(uri); store.studyEntries.push(entry());
  const json = store.exportJson(uri, 'document.pdf');
  throwsJson(() => store.importJson(json, 1)); assert.equal(store.studyEntries.length, 1);
  const root = JSON.parse(json); root.studyEntries[0].x = 2;
  throwsJson(() => store.importJson(JSON.stringify(root), 2)); assert.equal(store.studyEntries.length, 1);
});
test('oldBackupsLoadWithoutStudyEntries', async () => {
  const uri = U(); const store = await new AnnotationStore().open(uri); store.studyEntries.push(entry());
  const root = JSON.parse(store.exportJson(uri, 'document.pdf')); root.format = 'PDF Note annotations v1'; delete root.studyEntries;
  await store.importJson(JSON.stringify(root), 2); assert.equal(store.studyEntries.length, 0);
});
test('importRejectsForeignFormatAndMissingArrays', async () => {
  const s = new AnnotationStore();
  throwsJson(() => s.importJson('{"format":"x"}', 5), 'PDF Note 주석 백업이 아닙니다');
  throwsJson(() => s.importJson('{"format":"PDF Note annotations v2","marks":[]}', 5));
  throwsJson(() => s.importJson('[1]', 5)); throwsJson(() => s.importJson('nonsense', 5));
  const ok = '{"format":"PDF Note annotations v1","marks":[],"bookmarks":[],"outlines":[],"strokes":[],"translations":[]}';
  await s.importJson(ok, 1);
  const bad = JSON.parse(ok); bad.bookmarks = [3];
  throwsJson(() => s.importJson(JSON.stringify(bad), 3), '문서 페이지 범위를 벗어난 주석');
  bad.bookmarks = [-1]; throwsJson(() => s.importJson(JSON.stringify(bad), 3), '문서 페이지 범위를 벗어난 주석');
});

// ------------------------------------------------------------------ AttachmentTest
test('newAttachmentKindsSurviveSavingAndRejectUnsafeTargets', () => {
  const video = uuid() + '.mp4', thumb = uuid() + '.png';
  for (const [kind, text, asset] of [['sticker', '⭐', ''], ['hyperlink', 'https://example.com/a?b=1', ''], ['hyperlink', 'page:3', ''], ['video', video, thumb], ['youtube', 'dQw4w9WgXcQ', ''], ['hyperlink', 'doc:%EB%85%B8%ED%8A%B8%2Fa.pdf#4', '']]) {
    const back = rt(el({ kind, text, asset })); assert.equal(back.kind, kind); assert.equal(back.text, text); assert.equal(back.asset, asset);
  }
  for (const [kind, text, asset] of [['hyperlink', 'javascript:alert(1)', ''], ['hyperlink', 'page:x', ''], ['video', '../x.mp4', thumb], ['sticker', '', ''], ['youtube', 'short', ''], ['youtube', '../../../etc', ''],
    ['sticker', '12345678901234567', ''], ['hyperlink', 'https://a b', ''], ['image', '', 'x.png'], ['image', '', uuid().toUpperCase() + '.png'], ['bogus', '', ''], ['text', '', uuid() + '.mp4']])
    throwsJson(() => rt(el({ kind, text, asset })), '잘못된 노트 요소');
  assert.equal(rt(el({ kind: 'sticker', text: '1234567890123456' })).text.length, 16);
  assert.equal(rt(el({ kind: 'image', asset: uuid() + '.png' })).kind, 'image');
});
test('shapesAndTablesSurviveSavingAndAreValidated', () => {
  const shape = el({ kind: 'shape', left: .1, top: .1, right: .5, bottom: .5, text: Shapes.shapeSpec('rect', 0xFF000000 | 0, 0x66FF0000, 4) });
  assert.equal(shape.text, 'rect|FF000000|66FF0000|4');
  const t = Table.create(2, 3, 0xFF000000 | 0, 0xFFE5F0FF | 0, 0x00FFFFFF); t.cells[0] = '이름'; t.cells[4] = '값';
  const table = el({ kind: 'table', left: .1, top: .6, right: .9, bottom: .9, text: t.serialize() });
  assert.equal(t.serialize(), '2,3,FF000000,FFE5F0FF,00FFFFFF\n이름\n\n\n\n값\n');
  assert.equal(rt(shape).text, shape.text);
  const back = Table.parse(rt(table).text); assert.equal(back.rows, 2); assert.equal(back.cols, 3); assert.equal(back.cells[0], '이름'); assert.equal(back.cells[4], '값');
  assert.equal(back.line, 0xFF000000 | 0); assert.equal(back.head, 0xFFE5F0FF | 0);
  const bigger = back.resized(3, 4); assert.equal(bigger.cells[0], '이름'); assert.equal(bigger.cells[1 * 4 + 1], '값'); assert.equal(bigger.cells.length, 12);
  for (const bad of ['rect|FF0000|00000000|3', 'hexagon|FF000000|00000000|3', 'rect|FF000000|00000000|300', 'rect|ff000000|00000000|3', 'rect|FF000000|00000000|3\n'])
    throwsJson(() => rt(el({ kind: 'shape', left: .1, top: .1, right: .5, bottom: .5, text: bad })), '잘못된 노트 요소');
  throwsJson(() => rt(el({ kind: 'table', text: '99,99,FF000000,FF000000,FF000000' })));
  throwsJson(() => rt(el({ kind: 'table', text: '0,3,FF000000,FF000000,FF000000' })));
  throwsJson(() => rt(el({ kind: 'table', text: '3,13,FF000000,FF000000,FF000000' })));
  throwsJson(() => rt(el({ kind: 'table', text: '3,3,FF000000,FF000000,FF000000\n' + 'x'.repeat(30000) })));
  assert.equal(rt(el({ kind: 'table', text: '30,12,FF000000,FF000000,FF000000' })).kind, 'table');
  const d = Table.parse('garbage'); assert.equal(d.rows, 3); assert.equal(d.cells.length, 9); assert.equal(d.line, 0xFF3A3A3C | 0);
  assert.equal(Table.create(1, 2, 0, 0, 0).resized(1, 2).cells.length, 2);
  assert.equal(Table.create(1, 1, 0, 0, 0).serialize.call({ rows: 1, cols: 1, line: 1, head: 2, fill: 3, cells: ['a\nb\r'] }), '1,1,00000001,00000002,00000003\na b ');
  assert.equal(Shapes.hex(-1), 'FFFFFFFF'); assert.equal(Shapes.parseColor('FFFF0000'), 0xFFFF0000 | 0); assert.equal(Shapes.parseColor('00000001'), 1);
});

// ------------------------------------------------------------------ TypingSearchTest / NotebookFeatureTest / LibraryWorkflowTest
test('typedTextStylePersistsThroughBackupAndRestore', async () => {
  const store = new AnnotationStore();
  store.elements.push(el({ text: '강조할 문장', textSize: .05, color: 0xFFDC2626 | 0, font: 'serif', bold: true, italic: true }));
  const restored = new AnnotationStore(); await restored.importJson(store.exportJson('x', 'note'), 1);
  const r = restored.elements[0];
  near(r.textSize, .05, 1e-4); assert.equal(r.color, 0xFFDC2626 | 0); assert.equal(r.font, 'serif'); assert.ok(r.bold && r.italic); assert.equal(r.text, '강조할 문장');
});
test('oldBackupsAndUnknownFontsFallBackToReadableDefaults', async () => {
  const store = new AnnotationStore(); store.elements.push(el({ text: 'old' }));
  const root = JSON.parse(store.exportJson('x', 'note')); const o = root.elements[0];
  delete o.textSize; delete o.color; o.font = 'comic-sans';
  const restored = new AnnotationStore(); await restored.importJson(JSON.stringify(root), 1); const r = restored.elements[0];
  assert.equal(r.textSize, PageElement.DEFAULT_TEXT_SIZE); assert.equal(r.color, PageElement.DEFAULT_TEXT_COLOR); assert.equal(r.font, 'sans');
  o.textSize = 5.0; await restored.importJson(JSON.stringify(root), 1); assert.equal(restored.elements[0].textSize, PageElement.DEFAULT_TEXT_SIZE);
  o.textSize = 0.003; await restored.importJson(JSON.stringify(root), 1); assert.equal(restored.elements[0].textSize, PageElement.DEFAULT_TEXT_SIZE);
  o.textSize = 0.3; await restored.importJson(JSON.stringify(root), 1); near(restored.elements[0].textSize, .3, 1e-6);
});
test('invalidGeometryDoesNotReplaceExistingNotes', () => {
  const store = new AnnotationStore(); store.elements.push(el({ text: 'keep' }));
  const root = JSON.parse(store.exportJson('x', 'note'));
  for (const [k, v] of [['right', 2], ['left', -.1], ['top', .5], ['bottom', 1.01], ['left', .8]]) {
    const r = JSON.parse(JSON.stringify(root)); r.elements[0][k] = v;
    throwsJson(() => store.importJson(JSON.stringify(r), 1)); assert.equal(store.elements[0].text, 'keep');
  }
  const r = JSON.parse(JSON.stringify(root)); delete r.elements[0].page; throwsJson(() => store.importJson(JSON.stringify(r), 1));
});
test('audioNotesSurviveBackupAndRejectUnsafeAssets', async () => {
  const store = new AnnotationStore();
  const clip = el({ kind: 'audio', asset: uuid() + '.m4a', text: '0:12', left: .04, top: .03, right: .42, bottom: .075 }); store.elements.push(clip);
  const restored = new AnnotationStore(); await restored.importJson(store.exportJson('x', 'note'), 1);
  assert.equal(restored.elements[0].kind, 'audio'); assert.equal(restored.elements[0].asset, clip.asset); assert.equal(restored.elements[0].text, '0:12');
  clip.asset = '../../evil.m4a'; throwsJson(() => restored.importJson(store.exportJson('x', 'note'), 1));
});
test('fittedHeightGrowsWithLinesAndSize (node fallback measure)', () => {
  const face = AnnotationPainter.typeface('sans', false, false);
  const one = AnnotationPainter.fitHeight('한 줄', .4, .027, 1.414, face);
  const three = AnnotationPainter.fitHeight('한 줄\n두 줄\n세 줄', .4, .027, 1.414, face);
  const large = AnnotationPainter.fitHeight('한 줄', .4, .06, 1.414, face);
  assert.ok(one > 0 && three > one * 2.5 && large > one * 2);
  const long = '긴 문장 '.repeat(40);
  assert.ok(AnnotationPainter.fitHeight(long, .3, .027, 1.414, face) > one * 3);
  // formula: size*(1.35*lines+.15)/(1000*aspect)
  near(one, 27 * (1.35 + .15) / 1414, 1e-9);
});
test('everyFontIdMapsToATypefaceAndStylesApply', () => {
  for (const f of PageElement.FONTS) assert.ok(AnnotationPainter.typeface(f, false, false));
  assert.equal(AnnotationPainter.typeface('serif', true, false).getStyle(), Typeface.BOLD);
  assert.equal(AnnotationPainter.typeface('serif', false, true).getStyle(), Typeface.ITALIC);
  assert.equal(AnnotationPainter.typeface('x', true, true).getStyle(), 3);
  assert.match(AnnotationPainter.typeface('sans', true, false).css(20), /^bold 20px "Segoe UI","Malgun Gothic","Noto Sans KR",sans-serif$/);
});

// ------------------------------------------------------------------ PageEditTest
function filled() {
  const store = new AnnotationStore();
  for (let page = 0; page < 3; page++) {
    const m = new Mark(); m.page = page; store.marks.push(m);
    const s = new InkStroke(); s.page = page; store.strokes.push(s);
    store.elements.push(el({ page, text: 'p' + page }));
    const o = new OutlineItem(); o.page = page; store.outlines.push(o);
    const t = new TranslationNote(); t.page = page; store.translations.push(t);
    const se = new StudyEntry(); se.page = page; store.studyEntries.push(se);
    store.bookmarks.add(page);
  }
  return store;
}
const marked = s => s.marks.map(m => m.page).sort();
test('deletingAPageDropsItsAnnotationsAndRenumbersTheRest', () => {
  const store = filled(); store.removePage(1);
  assert.deepEqual(marked(store), [0, 1]); assert.equal(store.strokes.length, 2); assert.equal(store.outlines.length, 2);
  assert.equal(store.translations.length, 2); assert.equal(store.studyEntries.length, 2);
  assert.deepEqual([...store.bookmarks].sort(), [0, 1]);
  assert.equal(store.elements[0].text, 'p0'); assert.equal(store.elements[0].page, 0); assert.equal(store.elements[1].text, 'p2'); assert.equal(store.elements[1].page, 1);
  store.removePage(0); assert.deepEqual(marked(store), [0]); assert.deepEqual([...store.bookmarks], [0]); assert.equal(store.elements[0].text, 'p2');
});
test('insertingAPageMovesLaterAnnotationsDown', () => {
  const store = filled(); store.insertPageAfter(0);
  assert.deepEqual(marked(store), [0, 2, 3]); assert.deepEqual([...store.bookmarks].sort(), [0, 2, 3]);
  store.insertPageAfter(3); assert.deepEqual(marked(store), [0, 2, 3]);
});
test('pageEditsSurviveBackupAndRestore', async () => {
  const store = filled(); store.removePage(2); const restored = new AnnotationStore();
  await restored.importJson(store.exportJson('x', 'n'), 2);
  assert.equal(restored.marks.length, 2); assert.deepEqual([...restored.bookmarks].sort(), [0, 1]);
  throwsJson(() => new AnnotationStore().importJson(store.exportJson('x', 'n'), 1));
});

// ------------------------------------------------------------------ Android byte format
test('exportJson matches org.json toString(2) byte for byte', () => {
  const s = new AnnotationStore();
  const m = new Mark(); m.page = 2; m.left = .1; m.top = .25; m.right = 1; m.bottom = 0.0005; m.color = 0x66FFEB3B; m.note = 'a/b "q"\n\t\\ 한 \u2028 \u0001 😀';
  s.marks.push(m); s.bookmarks.add(5); s.bookmarks.add(1);
  const o = new OutlineItem(); o.page = 1; o.x = .5; o.y = .5; o.title = '개요'; s.outlines.push(o);
  const st = new InkStroke(); st.page = 0; st.color = 0xFF1C1C1E | 0; st.width = .004; st.points.push(new InkPoint(.5, .5, .65)); s.strokes.push(st);
  const text = s.exportJson('content://x/doc 1.pdf', 'Doc.pdf');
  const expected = `{
  "format": "PDF Note annotations v2",
  "document": "Doc.pdf",
  "uri": "content:\\/\\/x\\/doc 1.pdf",
  "elements": [],
  "studyEntries": [],
  "marks": [
    {
      "paper": -3162,
      "fontSp": 13,
      "boxSize": 1,
      "boxW": 0,
      "boxH": 0,
      "rot": 0,
      "page": 2,
      "left": 0.10000000149011612,
      "top": 0.25,
      "right": 1,
      "bottom": 5.000000237487257E-4,
      "color": 1728047931,
      "note": "a\\/b \\"q\\"\\n\\t\\\\ 한 \\u2028 \\u0001 😀",
      "noteOnly": false,
      "visible": true,
      "minimized": false
    }
  ],
  "bookmarks": [
    1,
    5
  ],
  "outlines": [
    {
      "page": 1,
      "x": 0.5,
      "y": 0.5,
      "title": "개요"
    }
  ],
  "strokes": [
    {
      "page": 0,
      "color": -14935010,
      "width": 0.004000000189989805,
      "pen": 0,
      "points": [
        {
          "x": 0.5,
          "y": 0.5,
          "p": 0.6499999761581421
        }
      ]
    }
  ],
  "translations": []
}`;
  assert.equal(text, expected);
  assert.equal(JSON.parse(text).marks[0].note, m.note);
});
test('sidecar toJson is compact with the Android key order', () => {
  const s = new AnnotationStore(); s.bookmarks.add(3);
  assert.equal(s.toJson(), '{"elements":[],"studyEntries":[],"marks":[],"bookmarks":[3],"outlines":[],"strokes":[],"translations":[]}');
  assert.deepEqual(Object.keys(JSON.parse(s.toJson())), ['elements', 'studyEntries', 'marks', 'bookmarks', 'outlines', 'strokes', 'translations']);
  const e = el({ text: '/' }); assert.equal(stringify(e.toJson()), '{"rot":0,"page":0,"kind":"text","text":"\\/","asset":"","left":0.10000000149011612,"top":0.10000000149011612,"right":0.800000011920929,"bottom":0.30000001192092896,"textSize":0.027000000700354576,"color":-14935010,"font":"sans","bold":false,"italic":false,"align":0,"underline":false,"strike":false,"stretch":false}');
});
test('number formatting follows org.json / Double.toString', () => {
  assert.equal(stringify([0, 1, -1, 1.5, 1e-3, 9.99e-4, 1e7, 12345678.5, 2147483647, -0.0, 0.0022000000812113286]), '[0,1,-1,1.5,0.001,9.99E-4,10000000,1.23456785E7,2147483647,-0,0.0022000000812113286]');
  // (Android's older Double.toString may print ...285 for the same double; both parse identically)
  assert.throws(() => stringify({ a: NaN }), JSONException); assert.throws(() => stringify([Infinity]), JSONException);
  assert.equal(stringify({ a: null, b: undefined, c: 1 }), '{"c":1}');
});
test('reads an Android sidecar written by org.json (escapes, floats, sci notation)', () => {
  const android = '{"elements":[{"page":0,"kind":"text","text":"hello \\/ w\\u00f6rld","asset":"","left":0.10000000149011612,"top":0.10000000149011612,"right":0.800000011920929,"bottom":0.30000001192092896,"textSize":0.027000000700354576,"color":-14935010,"font":"sans","bold":false,"italic":false}],"studyEntries":[],"marks":[{"paper":-3162,"fontSp":13,"boxSize":1,"page":0,"left":5.0E-4,"top":0.1,"right":0.5,"bottom":0.2,"color":1728047931,"note":"","noteOnly":false,"visible":true,"minimized":false}],"bookmarks":[0,2],"outlines":[],"strokes":[{"page":0,"color":-16777216,"width":0.004,"points":[{"x":0.1,"y":0.2,"p":0.5},{"x":0.3,"y":0.4,"p":1}]}],"translations":[{"page":0,"left":0.5,"top":0.5,"right":0.7,"bottom":0.6,"source":"hi","translated":"안녕","visible":true,"minimized":false}]}';
  const s = AnnotationStore.fromJson(android, { strict: true });
  assert.equal(s.elements[0].text, 'hello / wörld'); near(s.marks[0].left, 5e-4, 1e-9); assert.equal(s.marks[0].color, 1728047931);
  assert.deepEqual([...s.bookmarks], [0, 2]); assert.equal(s.strokes[0].points.length, 2); assert.equal(s.translations[0].translated, '안녕');
  assert.equal(s.toJson().includes('5.000000237487257E-4'), true);
  // Java reads, widens and rewrites: stable after one round trip
  assert.equal(AnnotationStore.fromJson(s.toJson()).toJson(), s.toJson());
  // BOM tolerated
  assert.equal(AnnotationStore.fromJson('\uFEFF' + android).marks.length, 1);
});
test('open() skips a bad element but keeps everything else (deliberate fix of the Java quirk)', () => {
  const root = JSON.parse(filled().toJson()); root.elements[1].right = 5;
  const s = AnnotationStore.fromJson(JSON.stringify(root)); assert.equal(s.elements.length, 2); assert.equal(s.marks.length, 3);
  assert.throws(() => AnnotationStore.fromJson(JSON.stringify(root), { strict: true }), JSONException);
});
test('getInt/optInt coercions like org.json', () => {
  const m = Mark.fromJson({ page: '3', color: 4294967295, fontSp: 12.9, boxSize: '2' });
  assert.equal(m.page, 3); assert.equal(m.color, -1); assert.equal(m.fontSp, 12); assert.equal(m.boxSize, 2);
  throwsJson(() => StudyEntry.fromJson({ text: 'a' })); throwsJson(() => StudyEntry.fromJson({ page: 0 }));
  const e = StudyEntry.fromJson({ page: 0, text: 'a' }); assert.equal(e.x, .5); assert.equal(e.id.length, 36); assert.equal(e.comment, '');
  assert.equal(StudyEntry.fromJson({ page: 0, text: 'a', id: 'abc' }).id, 'abc');
  throwsJson(() => StudyEntry.fromJson({ page: -1, text: 'a' }), '잘못된 페이지 링크');
  assert.equal(OutlineItem.fromJson({}).title, '개요'); near(OutlineItem.fromJson({}).x, .5);
  assert.equal(InkStroke.fromJson({}).color, 0xFF1C1C1E | 0); near(InkStroke.fromJson({ points: [{ x: 1, y: 2 }] }).points[0].pressure, .5);
});

// ------------------------------------------------------------------ persistence
const countWrites = () => { const c = { n: 0 }; const orig = host._fake.call.bind(host._fake); host._fake.call = (m, a) => { if (m === 'fs.writeText' && /\.json/.test(a.path)) c.n++; return orig(m, a); }; c.restore = () => { host._fake.call = orig; }; return c; };
test('sidecar path = <data>\\annotations\\<sha1(lowercase key)>.json', async () => {
  const p = await AnnotationStore.sidecarPath('C:\\Users\\Dev\\Docs\\A.pdf');
  const { createHash } = await import('node:crypto');
  const h = createHash('sha1').update('c:\\users\\dev\\docs\\a.pdf').digest('hex');
  assert.equal(p, `C:\\Users\\dev\\AppData\\Local\\PDFNote\\annotations\\${h}.json`);
  assert.equal(await AnnotationStore.sidecarPath('c:/users/dev/docs/a.pdf'), p);
});
test('save() is debounced and coalesces rapid calls; flush() writes immediately', async () => {
  const key = U(), w = countWrites();
  try {
    const s = await new AnnotationStore().open(key);
    const ps = []; for (let i = 0; i < 6; i++) { s.marks.push(new Mark()); ps.push(s.save()); }
    assert.equal(w.n, 0);
    const r = await Promise.all(ps); assert.deepEqual(r, new Array(6).fill(true)); assert.equal(w.n, 1);
    const back = await AnnotationStore.load(key); assert.equal(back.marks.length, 6);
    s.save(); s.marks.push(new Mark()); await s.flush(); assert.equal((await AnnotationStore.load(key)).marks.length, 7);
    assert.equal(await host.exists((await AnnotationStore.sidecarPath(key)) + '.tmp'), false);
  } finally { w.restore(); }
});
test('open() of another document writes the pending data of the previous one first', async () => {
  const a = U(), b = U(); const s = await new AnnotationStore().open(a);
  s.bookmarks.add(4); s.save(); await s.open(b); assert.equal(s.bookmarks.size, 0);
  await AnnotationStore.flushAll(); assert.deepEqual([...(await AnnotationStore.load(a)).bookmarks], [4]);
});
test('rebind(), moveSidecar(), deleteSidecar(), modified()', async () => {
  const a = U(), b = U();
  assert.equal(await AnnotationStore.modified(a), 0);
  const s = await new AnnotationStore().open(a); s.bookmarks.add(2); await s.save();
  assert.ok((await AnnotationStore.modified(a)) > 0);
  assert.equal(await AnnotationStore.moveSidecar(a, b), true);
  assert.equal(await AnnotationStore.modified(a), 0); assert.deepEqual([...(await AnnotationStore.load(b)).bookmarks], [2]);
  assert.equal(await AnnotationStore.moveSidecar(a, b), false);                 // nothing to move
  await AnnotationStore.deleteSidecar(b); assert.equal((await AnnotationStore.load(b)).bookmarks.size, 0);
  const c = U(); s.rebind(c); await s.flush(); assert.deepEqual([...(await AnnotationStore.load(c)).bookmarks], [2]);
  assert.equal(s.key, c);
});
test('moveSidecar flushes a pending save of the open store first', async () => {
  const a = U(), b = U(); const s = await new AnnotationStore().open(a); s.bookmarks.add(9); s.save();
  await AnnotationStore.moveSidecar(a, b); assert.deepEqual([...(await AnnotationStore.load(b)).bookmarks], [9]);
});
test('corrupt sidecar opens empty; cloneAnnotations copies (page range checked)', async () => {
  const a = U(), b = U(); await host.mkdir('C:\\Users\\dev\\AppData\\Local\\PDFNote\\annotations');
  await host.writeText(await AnnotationStore.sidecarPath(a), '{not json'); assert.equal((await AnnotationStore.load(a)).marks.length, 0);
  const s = await new AnnotationStore().open(a); const m = new Mark(); m.page = 3; s.marks.push(m); s.elements.push(el({ page: 1, text: 'x' })); await s.save();
  const clone = await AnnotationStore.cloneAnnotations(a, b, 10); assert.equal(clone.marks.length, 1);
  assert.equal((await AnnotationStore.load(b)).elements.length, 1);
  await assert.rejects(AnnotationStore.cloneAnnotations(a, U(), 2), JSONException);
});
test('assets: names, save/read/delete, referencedAssets', async () => {
  const n = AnnotationStore.newAssetName('png'); assert.match(n, /^[a-f0-9-]{36}\.png$/); assert.ok(AnnotationStore.validAssetName(n));
  assert.ok(!AnnotationStore.validAssetName('../x.png')); await assert.rejects(AnnotationStore.assetPath('../x.png'));
  await AnnotationStore.saveAsset(n, new Uint8Array([1, 2, 3]));
  assert.ok(await AnnotationStore.hasAsset(n)); assert.deepEqual([...await AnnotationStore.readAsset(n)], [1, 2, 3]);
  assert.equal(await AnnotationStore.assetPath(n), 'C:\\Users\\dev\\AppData\\Local\\PDFNote\\assets\\' + n);
  await AnnotationStore.deleteAsset(n); assert.ok(!(await AnnotationStore.hasAsset(n)));
  const s = new AnnotationStore(); const mp4 = AnnotationStore.newAssetName('mp4'), th = AnnotationStore.newAssetName('png');
  s.elements.push(el({ kind: 'video', text: mp4, asset: th }), el({ kind: 'youtube', text: 'dQw4w9WgXcQ' }));
  assert.deepEqual([...s.referencedAssets()].sort(), [mp4, th].sort());
});

// ------------------------------------------------------------------ painter pure helpers
test('v1.27: element rot, stroke pen, memo boxW/boxH round-trip with Android key order and clamps', () => {
  const e = el({ kind: 'shape', text: Shapes.shapeSpec('rect', 0xFF007AFF | 0, 0, 3) }); e.rot = 37.5;
  assert.equal(stringify(e.toJson()).startsWith('{"rot":37.5,"page":0,"kind":"shape"'), true);
  assert.equal(PageElement.fromJson(JSON.parse(stringify(e.toJson()))).rot, 37.5);
  assert.equal(PageElement.fromJson({ page: 0, kind: 'text', text: 'x', left: .1, top: .1, right: .5, bottom: .2 }).rot, 0);   // v1.26 data
  const st = new InkStroke(); st.pen = 3; st.points.push(new InkPoint(.1, .2, .5));
  assert.equal(stringify(st.toJson()), '{"page":0,"color":0,"width":0,"pen":3,"points":[{"x":0.10000000149011612,"y":0.20000000298023224,"p":0.5}]}');
  assert.equal(InkStroke.fromJson(st.toJson()).pen, 3);
  assert.equal(InkStroke.fromJson({ pen: 9 }).pen, 4); assert.equal(InkStroke.fromJson({ pen: -2 }).pen, 0); assert.equal(InkStroke.fromJson({}).pen, 0);
  const m = new Mark(); m.boxW = 180.5; m.boxH = 90;
  assert.equal(stringify(m.toJson()).startsWith('{"paper":-3162,"fontSp":13,"boxSize":1,"boxW":180.5,"boxH":90,"rot":0,"page":0'), true);
  const back = Mark.fromJson(m.toJson()); assert.equal(back.boxW, 180.5); assert.equal(back.boxH, 90);
  const big = Mark.fromJson({ boxW: 5000, boxH: 5000 }); assert.equal(big.boxW, 800); assert.equal(big.boxH, 1200);
  const neg = Mark.fromJson({ boxW: -4, boxH: -4 }); assert.equal(neg.boxW, 0); assert.equal(neg.boxH, 0);
  assert.equal(Mark.fromJson({}).boxW, 0);
  // an Android v1.29 sidecar round-trips byte for byte
  const a = '{"elements":[{"rot":90,"page":0,"kind":"sticker","text":"\u2b50","asset":"","left":0.1,"top":0.1,"right":0.3,"bottom":0.2,"textSize":0.027,"color":-14935010,"font":"sans","bold":false,"italic":false,"align":0,"underline":false,"strike":false,"stretch":false}],"studyEntries":[],"marks":[{"paper":-3162,"fontSp":13,"boxSize":1,"boxW":200,"boxH":120,"rot":0,"page":0,"left":0.1,"top":0.1,"right":0.5,"bottom":0.2,"color":1,"note":"n","noteOnly":true,"visible":true,"minimized":false}],"bookmarks":[],"outlines":[],"strokes":[{"page":0,"color":-16777216,"width":0.004,"pen":2,"points":[{"x":0.1,"y":0.2,"p":0.5}]}],"translations":[]}';
  const s = AnnotationStore.fromJson(a, { strict: true });
  assert.equal(s.elements[0].rot, 90); assert.equal(s.marks[0].boxW, 200); assert.equal(s.strokes[0].pen, 2);
  assert.equal(AnnotationStore.fromJson(s.toJson()).toJson(), s.toJson());
});
test('v1.29: text formatting keys are the Android ones (align int, underline, strike, stretch), always written', () => {
  const e = el({ text: 'a', align: 1, underline: true, strike: true, stretch: true });
  const j = stringify(e.toJson());
  assert.ok(j.endsWith('"italic":false,"align":1,"underline":true,"strike":true,"stretch":true}'), j);
  const r = rt(e); assert.equal(r.align, 1); assert.equal(r.underline, true); assert.equal(r.strike, true); assert.equal(r.stretch, true);
  const old = PageElement.fromJson({ page: 0, kind: 'text', text: 'x', left: .1, top: .1, right: .5, bottom: .2 });
  assert.equal(old.align, 0); assert.equal(old.underline, false); assert.equal(old.strike, false); assert.equal(old.stretch, false);
  assert.equal(PageElement.fromJson({ page: 0, kind: 'text', text: 'x', left: .1, top: .1, right: .5, bottom: .2, align: 7 }).align, 2);   // clamp 0..2
  assert.equal(PageElement.fromJson({ page: 0, kind: 'text', text: 'x', left: .1, top: .1, right: .5, bottom: .2, align: -3 }).align, 0);
  assert.equal(Object.keys(JSON.parse(j)).join(), 'rot,page,kind,text,asset,left,top,right,bottom,textSize,color,font,bold,italic,align,underline,strike,stretch');
});
test('v1.29: Windows v3.0 keys still load (align names, list + checked -> plain-text markers)', () => {
  const base = { page: 0, kind: 'text', left: .1, top: .1, right: .5, bottom: .2 };
  assert.equal(PageElement.fromJson({ ...base, text: 'x', align: 'center' }).align, 1);
  assert.equal(PageElement.fromJson({ ...base, text: 'x', align: 'right' }).align, 2);
  assert.equal(PageElement.fromJson({ ...base, text: 'x', align: 'justify' }).align, 0);
  assert.equal(PageElement.fromJson({ ...base, text: 'a\nb', list: 'bullet' }).text, '\u2022 a\n\u2022 b');
  assert.equal(PageElement.fromJson({ ...base, text: 'a\nb\nc', list: 'number' }).text, '1. a\n2. b\n3. c');
  assert.equal(PageElement.fromJson({ ...base, text: 'a\nb\nc', list: 'check', checked: [true, false, 'true'] }).text, '\u2611 a\n\u2610 b\n\u2611 c');
  assert.equal(PageElement.fromJson({ ...base, text: 'a', list: 'roman' }).text, 'a');
  const back = rt(PageElement.fromJson({ ...base, text: 'a', list: 'bullet', checked: [true] }));
  assert.ok(!/"list"|"checked"/.test(stringify(back.toJson())));
});
test('v1.29: plain-text list markers (kind, length, next, toggleCheck)', () => {
  assert.deepEqual(['\u2022 a', '12. a', '\u2610 a', '\u2611 a', '1.a', 'x'].map(PageElement.markerKind), [1, 2, 3, 3, 0, 0]);
  assert.deepEqual(['\u2022 a', '12. a', '\u2610 a', 'x'].map(PageElement.markerLength), [2, 4, 2, 0]);
  assert.equal(PageElement.markerFor(2, 5), '5. '); assert.equal(PageElement.markerFor(3, 1), '\u2610 '); assert.equal(PageElement.markerFor(0, 1), '');
  const e = el({ text: '\u2610 a\n\u2611 b' });
  assert.equal(e.toggleCheck(0), true); assert.equal(e.text, '\u2611 a\n\u2611 b');
  assert.equal(e.toggleCheck(1), false); assert.equal(e.text, '\u2611 a\n\u2610 b'); assert.equal(e.toggleCheck(9), false);
});
test('v1.29: Mark.rot and TranslationNote boxW/boxH/rot keys and order', () => {
  const m = new Mark(); m.rot = 30; assert.ok(stringify(m.toJson()).includes('"boxH":0,"rot":30,"page":0'));
  assert.equal(Mark.fromJson(m.toJson()).rot, 30); assert.equal(Mark.fromJson({}).rot, 0);
  const n = new TranslationNote(); n.page = 1; n.boxW = 200; n.boxH = 80; n.rot = 90; n.source = 's'; n.translated = 't';
  assert.equal(stringify(n.toJson()), '{"boxW":200,"boxH":80,"rot":90,"page":1,"left":0,"top":0,"right":0,"bottom":0,"source":"s","translated":"t","visible":true,"minimized":false}');
  const back = TranslationNote.fromJson(n.toJson()); assert.equal(back.boxW, 200); assert.equal(back.boxH, 80); assert.equal(back.rot, 90);
  const old = TranslationNote.fromJson({ page: 0, source: 'a', translated: 'b' }); assert.equal(old.boxW, 0); assert.equal(old.rot, 0);
});
test('v1.29: store sidecar keeps text formatting and stretch; migrates v3 lists', async () => {
  const uri = U(); const store = await new AnnotationStore().open(uri);
  store.elements.push(el({ text: '1. one\n2. two', align: 2, underline: true, strike: true }), el({ kind: 'image', asset: AnnotationStore.newAssetName('png'), stretch: true }));
  await store.save(); await store.flush();
  const back = await AnnotationStore.load(uri);
  assert.deepEqual(back.elements.map(e => [e.align, e.underline, e.strike, e.stretch]), [[2, true, true, false], [0, false, false, true]]);
  const copy = new AnnotationStore(); await copy.importJson(store.exportJson(uri, 't'), 1);
  assert.equal(copy.elements[1].stretch, true); assert.equal(copy.elements[0].strike, true);
});
test('v1.29: painter.layoutText (shared by painter, fitHeight, editor; markers are plain text)', () => {
  const m = s => s.length * 10;                       // 10 px per character
  const plain = AnnotationPainter.layoutText(m, 'abc\n\nde', 200, 20);
  assert.deepEqual(plain.lines.map(l => [l.para, l.x, l.y]), [[0, 0, 20], [1, 0, 47], [2, 0, 74]]);   // empty paragraph keeps a line
  const wrap = AnnotationPainter.layoutText(m, 'a'.repeat(25), 100, 20);
  assert.deepEqual(wrap.lines.map(l => [l.text.length, l.first, l.x]), [[10, true, 0], [10, false, 0], [5, false, 0]]);
  const right = AnnotationPainter.layoutText(m, 'abc  ', 200, 20, { align: 2 });
  assert.equal(right.lines[0].x + right.lines[0].w, 200);                                            // trailing blanks ignored
  assert.equal(AnnotationPainter.layoutText(m, 'x', 200, 20, { align: 1 }).lines[0].x, 95);
  assert.equal(AnnotationPainter.layoutText(m, 'x', 200, 20, { align: 'center' }).lines[0].x, 95);  // v3 names still accepted
  assert.deepEqual([0, 1, 2, 'left', 'center', 'right', 'x', 9].map(AnnotationPainter.alignIndex), [0, 1, 2, 0, 1, 2, 0, 0]);
  assert.deepEqual(AnnotationPainter.textOpts(el({ align: 1, underline: true, strike: true })), { align: 1, underline: true, strike: true });
});
test('painter.adj lightens dark colours only on dark pages', () => {
  AnnotationPainter.dark = false; assert.equal(AnnotationPainter.adj(0xFF1C1C1E | 0), 0xFF1C1C1E | 0);
  AnnotationPainter.dark = true;
  const c = AnnotationPainter.adj(0xFF1C1C1E | 0) >>> 0;       // 28+trunc(227*.88)=227, 30+trunc(225*.88)=228
  assert.deepEqual([(c >>> 24), (c >>> 16) & 255, (c >>> 8) & 255, c & 255], [255, 227, 227, 228]);
  assert.equal((AnnotationPainter.adj(0xFF000000 | 0) >>> 16) & 255, 224);          // 0 + trunc(255*.88)
  assert.equal(AnnotationPainter.adj(0xFFFFFFFF | 0), 0xFFFFFFFF | 0); assert.equal(AnnotationPainter.adj(0x80101010 | 0) >>> 24, 0x80);
  AnnotationPainter.dark = false;
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e).toString().split('\n').slice(0, 6).join('\n     ')); }
}
await AnnotationStore.flushAll();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
