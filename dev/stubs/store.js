// TEMPORARY stub of js/store.js (Java API names) used by dev/pageview-test.* only while the real store.js is missing.
export class Mark { constructor() { this.page = 0; this.left = NaN; this.top = NaN; this.right = NaN; this.bottom = NaN; this.color = 0x66FFEB3B | 0; this.note = ''; this.noteOnly = false; this.visible = true; this.minimized = false; this.paper = 0xFFFFF3A6 | 0; this.fontSp = 13; this.boxSize = 1; } }
export class InkPoint { constructor(x, y, pressure) { this.x = x; this.y = y; this.pressure = pressure; } }
export class InkStroke { constructor() { this.page = 0; this.color = 0xFF1C1C1E | 0; this.width = 0.004; this.points = []; } }
export class TranslationNote { constructor() { this.page = 0; this.left = 0; this.top = 0; this.right = 0; this.bottom = 0; this.source = ''; this.translated = ''; this.visible = true; this.minimized = false; } }
export class PageElement { constructor() { this.page = 0; this.kind = 'text'; this.text = ''; this.asset = ''; this.left = .1; this.top = .1; this.right = .8; this.bottom = .3; this.textSize = .027; this.color = 0xFF1C1C1E | 0; this.font = 'sans'; this.bold = false; this.italic = false; } }
export class AnnotationStore {
  constructor() { this.marks = []; this.strokes = []; this.translations = []; this.elements = []; this.outlines = []; this.bookmarks = new Set(); this.studyEntries = []; }
  static async assetUrl() { return null; }
}
