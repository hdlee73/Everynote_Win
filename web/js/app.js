// MainActivity port. The Java class is split in three mixin files (by source line range) that add methods to this class:
//   app-main1.js : MainActivity.java lines   1-660   (UI build, header/tabs/bars, dock, tools, menus, selection popup, translate/TTS, undo, bookmarks, page turning, OCR)
//   app-main2.js : MainActivity.java lines 660-1300  (lists/dialogs, study panel, side panel, page insert/delete, elements, drag/paste)
//   app-main3.js : MainActivity.java lines 1300-1933 (export/import, notebooks, office/HWP flows, help, lifecycle glue)
// All three keep the Java method and field names. State shared by every part lives on `this` (see initState()).
import { prefs } from './prefs.js';
import { installMain1, initMain1 } from './app-main1.js';
import { installMain2, initMain2 } from './app-main2.js';
import { installMain3, initMain3 } from './app-main3.js';
import { installSplit } from './app-split.js';

export class MainActivity {
  constructor() {
    this.initState();
    initMain1(this); initMain2(this); initMain3(this);
  }

  /** Fields declared at the top of MainActivity.java (types/defaults per spec/main1.md §6). Each mixin's initMainN adds its own extras. */
  initState() {
    this.recentPrefs = prefs;            // SharedPreferences("recent_documents")
    this.library = null;                 // LibraryRepository (js/library.js)
    this.libraryDialog = null;
    this.libraryFolder = null;           // folder path where imports go
    this.sessions = []; this.activeSession = null;   // DocumentSession[] (tabs)
    this.renderer = null;                // active session's PdfDoc (was PdfRenderer)
    this.documentUri = null;             // active document key (absolute path)
    this.documentTitle = 'PDF';
    this.currentPage = 0;
    this.store = null;                   // active AnnotationStore
    this.pageView = null; this.firstPageView = null; this.secondPageView = null;
    this.splitView = null; this.splitSession = null;   // split screen (app-split.js)
    this.twoPage = false;
    this.selectedColor = 0x66FFDE59;
    this.highlightFree = false; this.highlightThick = 0.022;   // 하이라이트 (text Mark tool): straight only, thickness adjustable
    this.highlighterMode = false; this.penStash = null; this.hlStraight = false;   // 형광펜 (ink highlighter): borrows the pen slots, see enterHighlighter
    this.highlightMode = false; this.memoMode = false; this.outlineMode = false; this.fullscreen = false;
    this.verticalPageSwipe = false; this.fingerInk = false; this.swipeEnabled = true;
    this.inkMode = 0; this.inkColor = 0xFF1C1C1E; this.inkWidth = 0.004;
    this.writeMode = false;
    this.importing = new Set(); this.appending = new Set(); this.restoringSessions = false;
    this.pageAnimating = false; this.sidebarVisible = false; this.panelTab = 1;
    this.studyVisible = false; this.basketOnly = false;
    this.searchHits = []; this.searchCurrent = -1; this.searchSession = 0; this.searchDone = 0; this.searchTotal = 0;
    this.searching = false; this.searchTruncated = false; this.searchPrecise = false; this.searchOwner = null;
    this.lassoShape = 0; this.showAllThumbnails = true; this.thumbInkOnly = false;
    this.placementKind = ''; this.placementAsset = '';
    this.ocrGeneration = 0; this.thumbnailGeneration = 0;
    this.baseTint = new Map();           // ImageButton element -> tint colour
    this.root = null;                    // root element (document.body wrapper)
  }

  /** Android onCreate(); called once from index.html after DOM is ready. */
  async onCreate() { /* implemented in app-main1.js (assigned onto the prototype) */ }
}
installMain1(MainActivity); installMain2(MainActivity); installMain3(MainActivity); installSplit(MainActivity);
