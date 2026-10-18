// Everynote icon set: drawn for Everynote (24x24 viewBox, thin 1.6px line, round caps/joins, ink = currentColor).
// The <svg> wrapper (stroke, fill none, stroke-width) comes from util.js icon(); entries hold only the inner shapes.
// Shapes that need a fill say so themselves (fill='currentColor' stroke='none'). The tool_* glyphs are the coloured tool icons of the
// editor's right tool strip: their coloured part follows currentColor, the outline stays ink.
// Regenerate web/icons/*.svg after editing: node tools/export_icons.mjs  (shared glyphs: node tools/import_shared_icons.mjs first)
import { SHARED_ICONS } from './icons-shared.js';
const P = d => `<path d='${d}'/>`;
const DOT = (x, y, r = 1.35) => `<circle cx='${x}' cy='${y}' r='${r}' fill='currentColor' stroke='none'/>`;
const STAR = 'M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z';
const DOC = 'M14 3.5H7.2a1.9 1.9 0 0 0-1.9 1.9v13.2a1.9 1.9 0 0 0 1.9 1.9h9.6a1.9 1.9 0 0 0 1.9-1.9V8.2z M14 3.5v3.3a1.4 1.4 0 0 0 1.4 1.4h3.3';
const FOLDER = 'M3.5 7.2a1.9 1.9 0 0 1 1.9-1.9h3.9l2 2.1h7.3a1.9 1.9 0 0 1 1.9 1.9v8a1.9 1.9 0 0 1-1.9 1.9H5.4a1.9 1.9 0 0 1-1.9-1.9z';

export const ICONS = {
  // ---- navigation / chrome
  ic_back: P('M15.5 4.5L8 12l7.5 7.5'),
  ic_chevron_left: P('M14.5 6L8.5 12l6 6'),
  ic_chevron_right: P('M9.5 6l6 6-6 6'),
  ic_chevron_up: P('M6 14.5l6-6 6 6'),
  ic_chevron_down: P('M6 9.5l6 6 6-6'),
  ic_close: P('M6 6l12 12M18 6L6 18'),
  ic_menu: P('M4 6.5h16M4 12h16M4 17.5h16'),
  ic_more_vert: DOT(12, 5.5) + DOT(12, 12) + DOT(12, 18.5),
  ic_grip: DOT(9, 6, 1.15) + DOT(15, 6, 1.15) + DOT(9, 12, 1.15) + DOT(15, 12, 1.15) + DOT(9, 18, 1.15) + DOT(15, 18, 1.15),
  ic_grip_h: DOT(6, 9, 1.15) + DOT(12, 9, 1.15) + DOT(18, 9, 1.15) + DOT(6, 15, 1.15) + DOT(12, 15, 1.15) + DOT(18, 15, 1.15),
  ic_plus: P('M12 5v14M5 12h14'),
  ic_minus: P('M5 12h14'),
  ic_check: P('M5 12.5l4.5 4.5L19 7.5'),
  ic_check_bold: `<path d='M5.5 12.8L10 17.2l8.6-9.8' stroke-width='2.6'/>`,
  ic_check_circle: `<circle cx='12' cy='12' r='8.3'/>` + P('M8.2 12.3l2.6 2.6 5-5.3'),
  ic_search: `<circle cx='10.6' cy='10.6' r='6'/>` + P('M15.1 15.1l4.6 4.6'),
  ic_zoom: `<circle cx='10.6' cy='10.6' r='6'/>` + P('M15.1 15.1l4.6 4.6M8.2 10.6h4.8M10.6 8.2V13'),
  ic_settings: `<circle cx='12' cy='12' r='2.9'/>` + P('M10.4 3.6h3.2l.5 2.3 1.6.9 2.2-.8 1.6 2.8-1.7 1.5v1.8l1.7 1.5-1.6 2.8-2.2-.8-1.6.9-.5 2.3h-3.2l-.5-2.3-1.6-.9-2.2.8-1.6-2.8 1.7-1.5v-1.8L4.5 8.8l1.6-2.8 2.2.8 1.6-.9z'),
  ic_sort: P('M4.5 7h9M4.5 12h6.5M4.5 17h4M17.5 5.5v13M14.8 15.8l2.7 2.7 2.7-2.7'),
  ic_arrow_down: P('M12 5v14M6.5 13.5L12 19l5.5-5.5'),
  ic_arrow_up: P('M12 19V5M6.5 10.5L12 5l5.5 5.5'),
  ic_grid: `<rect x='4' y='4' width='6.5' height='6.5' rx='1.4'/><rect x='13.5' y='4' width='6.5' height='6.5' rx='1.4'/><rect x='4' y='13.5' width='6.5' height='6.5' rx='1.4'/><rect x='13.5' y='13.5' width='6.5' height='6.5' rx='1.4'/>`,
  ic_list_view: `<rect x='4' y='5' width='4' height='4' rx='1'/><rect x='4' y='15' width='4' height='4' rx='1'/>` + P('M11 7h9M11 17h9'),
  ic_fullscreen: P('M13.8 4.5h5.7v5.7M19.5 4.5l-6 6M10.2 19.5H4.5v-5.7M4.5 19.5l6-6'),
  ic_fullscreen_exit: P('M19.5 4.5l-5.6 5.6M13.9 5.6v4.5h4.5M4.5 19.5l5.6-5.6M10.1 18.4v-4.5H5.6'),
  ic_float: `<rect x='3.5' y='5' width='17' height='14' rx='2.2'/><rect x='11' y='11' width='7' height='5.5' rx='1.2'/>`,
  ic_sidebar: `<rect x='3.5' y='4.5' width='17' height='15' rx='2.2'/>` + P('M9 4.5v15M5.8 8h1M5.8 11h1'),
  ic_collapse: P('M9.5 6l6 6-6 6'),
  ic_expand: P('M14.5 6l-6 6 6 6'),

  // ---- library
  ic_notebook: `<rect x='5' y='3.5' width='14' height='17' rx='2.3'/>` + P('M8.8 3.5v17M11.8 8h4.2'),
  ic_document_tab: `<rect x='5' y='3.5' width='14' height='17' rx='2.3'/>` + P('M8.8 3.5v17M11.8 8h4.2'),
  ic_notes_all: `<rect x='7' y='3.5' width='12.5' height='15' rx='2'/>` + P('M4.5 7v11.3a2.2 2.2 0 0 0 2.2 2.2h9'),
  ic_star_outline: P(STAR),
  ic_star: `<path d='${STAR}' fill='currentColor'/>`,
  ic_delete: P('M4.5 6.5h15M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.6 6.5l.8 12.1a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l.8-12.1M10.2 10.5v5.8M13.8 10.5v5.8'),
  ic_restore: P('M4.8 12a7.2 7.2 0 1 0 2.1-5.1L4.6 9.2M4.6 4.8v4.4H9M12 8.5V12l2.6 1.6'),
  ic_folder_open: P(FOLDER),
  ic_folder_check: P(FOLDER) + P('M9.2 13l2 2 3.8-4'),
  ic_folder_add: P(FOLDER) + P('M12 10.3v5.4M9.3 13h5.4'),
  ic_clock: `<circle cx='12' cy='12' r='8.3'/>` + P('M12 7.4V12l3 1.8'),
  ic_compose: P('M11 4.6H6.6a2 2 0 0 0-2 2v10.8a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V13') + P('M17.4 3.9a1.7 1.7 0 0 1 2.4 2.4l-7.5 7.5-3.2.8.8-3.2z'),
  ic_pdf_import: P(DOC) + P('M12 10v6.5M9.2 13.8L12 16.6l2.8-2.8'),
  ic_import: P('M12 4v10.5M7.8 10.3L12 14.5l4.2-4.2M4.5 15.5v2.6a1.9 1.9 0 0 0 1.9 1.9h11.2a1.9 1.9 0 0 0 1.9-1.9v-2.6'),
  ic_export: P('M19.5 13.5v4.1a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9V6.4a1.9 1.9 0 0 1 1.9-1.9h4.1M14 4.5h5.5V10M19.5 4.5L11 13'),
  ic_save_file: P('M19.5 13.5v4.1a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9V6.4a1.9 1.9 0 0 1 1.9-1.9h4.1M14 4.5h5.5V10M19.5 4.5L11 13'),
  ic_move: P(FOLDER) + P('M9 13.3h6M12.8 11l2.3 2.3-2.3 2.3'),
  ic_rename: P('M14.6 5.3l3.1 3.1L9 17.1l-3.8.7.7-3.8z M12.6 7.3l3.1 3.1M4.5 20.5h15'),
  ic_copy: `<rect x='8.5' y='8.5' width='11' height='11' rx='2'/>` + P('M15.5 8.5V6.4a1.9 1.9 0 0 0-1.9-1.9H6.4a1.9 1.9 0 0 0-1.9 1.9v7.2a1.9 1.9 0 0 0 1.9 1.9h2.1'),
  ic_duplicate: `<rect x='8.5' y='8.5' width='11' height='11' rx='2'/>` + P('M15.5 8.5V6.4a1.9 1.9 0 0 0-1.9-1.9H6.4a1.9 1.9 0 0 0-1.9 1.9v7.2a1.9 1.9 0 0 0 1.9 1.9h2.1M14 11.5v5M11.5 14h5'),
  ic_cut: `<circle cx='6.6' cy='17.4' r='2.5'/><circle cx='17.4' cy='17.4' r='2.5'/>` + P('M8.4 15.6L17 4.5M15.6 15.6L7 4.5'),
  ic_paste: `<rect x='5' y='5' width='14' height='15.5' rx='2'/>` + P('M9 5V4.2a.8.8 0 0 1 .8-.7h4.4a.8.8 0 0 1 .8.7V5a1.4 1.4 0 0 1-1.4 1.4h-3.2A1.4 1.4 0 0 1 9 5zM8.5 11h7M8.5 14.5h5'),
  ic_share: `<circle cx='17.3' cy='5.6' r='2.1'/><circle cx='6.7' cy='12' r='2.1'/><circle cx='17.3' cy='18.4' r='2.1'/>` + P('M8.6 10.9l6.8-4.1M8.6 13.1l6.8 4.1'),
  ic_print: P('M7.2 9V4.5h9.6V9M7.2 16.5H5.4a1.9 1.9 0 0 1-1.9-1.9v-3.7A1.9 1.9 0 0 1 5.4 9h13.2a1.9 1.9 0 0 1 1.9 1.9v3.7a1.9 1.9 0 0 1-1.9 1.9h-1.8') + `<rect x='7.2' y='13.5' width='9.6' height='6' rx='1'/>`,
  ic_backup: P('M7 18.5h-.5a4 4 0 0 1-.6-8 6 6 0 0 1 11.6-1.2A4.4 4.4 0 0 1 17.5 18.5H17M12 11.5v8M9.2 14.2L12 11.4l2.8 2.8'),
  ic_sync: P('M19.3 9.5A7.6 7.6 0 0 0 5.6 7.6M4.7 14.5a7.6 7.6 0 0 0 13.7 1.9M5.4 3.9v3.9h3.9M18.6 20.1v-3.9h-3.9'),
  ic_wifi_off: P('M3.6 9.4a12.6 12.6 0 0 1 3.9-2.5M10.5 6a12.6 12.6 0 0 1 9.9 3.4M6.6 12.9a8 8 0 0 1 3-1.8M17.4 12.9a8 8 0 0 0-1.5-1.1M9.5 16.3a3.9 3.9 0 0 1 5 0M4 4l16 16') + DOT(12, 19.6, 1.1),
  ic_original: P(DOC) + P('M8.5 12.5h7M8.5 16h4.5'),
  ic_page: P(DOC) + P('M8.5 12.5h7M8.5 16h7'),
  ic_page_manage: `<rect x='5' y='3.5' width='14' height='17' rx='2.2'/>` + P('M8.5 8h7M8.5 12h7M8.5 16h4'),
  ic_page_add: P(DOC) + P('M12 11v6M9 14h6'),
  ic_note_add: P(DOC) + P('M12 11v6M9 14h6'),
  ic_pdf: P(DOC) + P('M8 16.8v-4h1.3a1.2 1.2 0 0 1 0 2.4H8M11.6 12.8v4h1a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5zM16.4 12.8h-1.6v4M14.8 14.8h1.3'),
  ic_word: P(DOC) + P('M8 12.5l1.2 4.5 1.4-3.6 1.4 3.6 1.2-4.5'),
  ic_office: P(DOC) + P('M8.5 12.5h7v4.5h-7zM12 12.5V17M8.5 14.75h7'),
  ic_ocr: P('M4 8V5.8A1.8 1.8 0 0 1 5.8 4H8M16 4h2.2A1.8 1.8 0 0 1 20 5.8V8M20 16v2.2a1.8 1.8 0 0 1-1.8 1.8H16M8 20H5.8A1.8 1.8 0 0 1 4 18.2V16M8.5 15.5l2-7 2 7M9.1 13.3h2.8M14.5 8.5v7h1.6a1.7 1.7 0 0 0 0-3.5h-1.6m0 0h1.2a1.7 1.7 0 0 0 0-3.5h-1.2'),
  ic_scan: P('M4 8V5.8A1.8 1.8 0 0 1 5.8 4H8M16 4h2.2A1.8 1.8 0 0 1 20 5.8V8M20 16v2.2a1.8 1.8 0 0 1-1.8 1.8H16M8 20H5.8A1.8 1.8 0 0 1 4 18.2V16M4 12h16'),

  // ---- editor top bar
  ic_book: P('M12 6.6C10 5.2 7.1 4.7 3.8 5.1v13.2c3.3-.4 6.2.1 8.2 1.5 2-1.4 4.9-1.9 8.2-1.5V5.1c-3.3-.4-6.2.1-8.2 1.5zM12 6.6v13.2'),
  ic_note_style: `<rect x='4.5' y='3.5' width='12' height='16' rx='2'/>` + P('M7.5 7.5h6M7.5 10.5h3.5M19.8 9.8l-5.6 5.6-.7 2.5 2.5-.7 5.6-5.6a1.27 1.27 0 0 0-1.8-1.8z'),
  ic_insert: P('M12 5v14M5 12h14'),
  ic_eye: P('M2.8 12c2-3.9 5.3-6 9.2-6s7.2 2.1 9.2 6c-2 3.9-5.3 6-9.2 6s-7.2-2.1-9.2-6z') + `<circle cx='12' cy='12' r='2.8'/>`,
  ic_thumbnails: `<rect x='4' y='4' width='6.5' height='7.5' rx='1.4'/><rect x='13.5' y='4' width='6.5' height='7.5' rx='1.4'/><rect x='4' y='14.5' width='6.5' height='5.5' rx='1.4'/><rect x='13.5' y='14.5' width='6.5' height='5.5' rx='1.4'/>`,
  ic_outline: P('M5 6.5h14M8.5 12h10.5M8.5 17.5h10.5') + DOT(5, 12, 1.05) + DOT(5, 17.5, 1.05),
  ic_dual: `<rect x='3.5' y='4.5' width='17' height='15' rx='2.2'/>` + P('M12 4.5v15M6.3 9h3M14.7 9h3M6.3 12h3M14.7 12h3'),
  ic_swipe: P('M7.5 8.5L4 12l3.5 3.5M16.5 8.5L20 12l-3.5 3.5M4 12h16'),
  ic_magic: P('M4.5 19.5L15 9M13.2 7.2l3.6 3.6M18 3.5v3M16.5 5h3M8 3.8v2.4M6.8 5h2.4M19.5 13v2.4M18.3 14.2h2.4'),
  ic_crop: P('M7 3.5V17h13.5M3.5 7H17v13.5'),
  ic_curve: P('M4 17c3.5-10 6.5-10 8-5s4.5 5 8-5'),
  ic_flag: P('M5.5 20.5V4.5M5.5 5h11.3l-2.3 4 2.3 4H5.5'),
  ic_link: P('M10 14a4 4 0 0 0 5.7 0l2.9-2.9a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-2.9 2.9a4 4 0 0 0 5.7 5.7l1-1'),
  ic_select_text: P('M9.5 4.5h5M12 4.5v15M9.5 19.5h5M5 8.5L3 12l2 3.5M19 8.5l2 3.5-2 3.5'),
  ic_study: P('M2.8 9.2L12 5l9.2 4.2L12 13.4zM6.5 11v4.4c1.4 1.4 3.3 2.1 5.5 2.1s4.1-.7 5.5-2.1V11M21.2 9.2v4.6'),
  ic_basket: P('M3.5 9.5h17l-1.6 9a1.9 1.9 0 0 1-1.9 1.5H7a1.9 1.9 0 0 1-1.9-1.5zM8 9.5l3-5M16 9.5l-3-5M9.5 13v3.5M14.5 13v3.5'),
  ic_translate: P('M3.8 6h8.4M8 4.3V6M6 6c.6 3 2.5 5.1 5.2 6.1M10.4 6c-.7 3.3-2.8 5.7-6 6.6M12.8 20l3.6-8.6L20 20M14 17.2h4.8'),
  ic_dictionary: P('M5.5 5.3a1.8 1.8 0 0 1 1.8-1.8h11.2v14H7.3a1.8 1.8 0 0 0-1.8 1.8zM5.5 18.7a1.8 1.8 0 0 0 1.8 1.8h11.2v-3M9.5 12.5l2-5.5 2 5.5M10.1 11h2.8'),
  ic_speaker: P('M4.5 9.5h3.2l4.3-3.8v12.6l-4.3-3.8H4.5zM15.3 9a4.2 4.2 0 0 1 0 6M17.8 6.5a7.7 7.7 0 0 1 0 11'),
  ic_mic: `<rect x='9' y='3.5' width='6' height='10.5' rx='3'/>` + P('M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6'),
  ic_video: `<rect x='3.5' y='6' width='12.5' height='12' rx='2.2'/>` + P('M16 10.4l4.5-2.6v8.4L16 13.6'),
  ic_youtube: `<rect x='3' y='5.5' width='18' height='13' rx='3.6'/>` + P('M10.3 9.4v5.2l4.5-2.6z'),
  ic_image: `<rect x='3.5' y='4.5' width='17' height='15' rx='2.2'/><circle cx='9' cy='9.6' r='1.6'/>` + P('M3.8 17.2l4.9-4.6 3.3 3.1 3-2.8 5.2 4.6'),
  ic_sticker: P('M14.5 20.5H6.4a1.9 1.9 0 0 1-1.9-1.9V5.4a1.9 1.9 0 0 1 1.9-1.9h12.2a1.9 1.9 0 0 1 1.9 1.9v9.1zM14.5 20.5v-4.1a1.9 1.9 0 0 1 1.9-1.9h4.1M9 9.5h.01M15 9.5h.01M8.8 13c1.6 1.4 3.4 1.6 5 .6'),
  ic_memo: P('M5.4 3.5h13.2a1.9 1.9 0 0 1 1.9 1.9v9.6l-5.5 5.5H5.4a1.9 1.9 0 0 1-1.9-1.9V5.4a1.9 1.9 0 0 1 1.9-1.9zM20.5 15h-3.6a1.9 1.9 0 0 0-1.9 1.9v3.6M7.5 8.5h9M7.5 12h6'),
  ic_table: `<rect x='3.5' y='4.5' width='17' height='15' rx='2'/>` + P('M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10M15 9.5v10'),
  ic_rect: `<rect x='4.5' y='5.5' width='15' height='13' rx='2'/>`,
  ic_circle: `<circle cx='12' cy='12' r='7.8'/>`,
  ic_shapes: `<circle cx='8.8' cy='8.8' r='5'/>` + P('M15.3 11.2l5 8.3H10.3z'),
  ic_line: P('M5 19L19 5') + DOT(5, 19, 1.6) + DOT(19, 5, 1.6),
  ic_palette: P('M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6s.8-1.6 1.8-1.6h2.4a3.5 3.5 0 0 0 3.5-3.5c0-4.3-3.8-7.6-8.5-7.6z') + DOT(7.6, 11, 1.1) + DOT(10, 7.4, 1.1) + DOT(14.5, 7.6, 1.1),
  ic_eyedropper: P('M14.4 6.2l3.4 3.4M16.6 4a2.3 2.3 0 0 1 3.3 3.3l-2.4 2.4-3.3-3.3zM14.2 6.4L6.3 14.3a2 2 0 0 0-.5.9l-.8 3.8 3.8-.8a2 2 0 0 0 .9-.5l7.9-7.9'),
  ic_sliders: P('M4.5 7h9M17.5 7h2M4.5 17h2M10.5 17h9') + `<circle cx='15.5' cy='7' r='2'/><circle cx='8.5' cy='17' r='2'/>`,
  ic_opacity: P('M12 3.6C8.5 8 6.1 11 6.1 14.5a5.9 5.9 0 0 0 11.8 0C17.9 11 15.5 8 12 3.6z') + `<path d='M12 20.4a5.9 5.9 0 0 0 5.9-5.9H12z' fill='currentColor' stroke='none'/>`,
  ic_touch: P('M9.5 12V5.6a1.6 1.6 0 0 1 3.2 0V11M12.7 10.6a1.6 1.6 0 0 1 3.2.2M15.9 11.2a1.6 1.6 0 0 1 3.1.6v3.2a6 6 0 0 1-6 6h-1.2a5 5 0 0 1-4-2L5.6 14.6a1.5 1.5 0 0 1 2.3-1.9l1.6 1.6'),
  ic_keyboard: `<rect x='3' y='6' width='18' height='12' rx='2.4'/>` + P('M7 14.6h10') + DOT(7, 9.6, .95) + DOT(10.3, 9.6, .95) + DOT(13.7, 9.6, .95) + DOT(17, 9.6, .95) + DOT(8.6, 12.1, .95) + DOT(12, 12.1, .95) + DOT(15.4, 12.1, .95),
  ic_text: P('M5.5 6.5V5h13v1.5M12 5v14M9.5 19h5'),
  ic_text_mark: P('M7 15.5l4-10.5h2l4 10.5M8.4 12h7.2') + `<rect x='4' y='17.5' width='16' height='3' rx='1' fill='currentColor' stroke='none' opacity='.45'/>`,
  ic_hw_text: P('M4 17.5c1.5-3 2.6-3.3 3.2-1.7.5 1.3 1.1 1.4 2 0M13.5 6.5h7M17 6.5V17M14 20.5h6'),
  ic_hw_align: P('M4 6.5c1.5-1.5 2.6-1.5 3.6 0s2.1 1.5 3.4 0M4 12c1.5-1.5 2.6-1.5 3.6 0M4 17.5h7M14.5 12h6M17.8 8.8L21 12l-3.2 3.2'),
  ic_text_style: P('M6 19.5L11 5h2l5 14.5M7.8 14.5h8.4M9.4 10h5.2'),
  ic_size: P('M3.5 18.5l3.2-9 3.2 9M4.6 15.6h4.2M13 18.5l2.6-7.5 2.6 7.5M13.9 16.2h3.4M19.8 4.5v5M18.3 6l1.5-1.5L21.3 6M18.3 8l1.5 1.5L21.3 8'),
  ic_lasso: `<path d='M6 15.5C3.5 12.2 6 5.8 12.4 5.4c5.4-.3 8.3 3.2 6.7 6.4-1.5 3-6.3 4.2-10.2 3.4' stroke-dasharray='2.3 2.4'/>` + P('M7.6 14.8c-1.5.9-1.9 2.5-1 3.6.8 1 2.4 1 3.2 2.1'),

  // ---- tools (mono; the strip uses the coloured tool_* glyphs)
  ic_ink: P('M15.3 4.6a1.9 1.9 0 0 1 2.7 0l1.4 1.4a1.9 1.9 0 0 1 0 2.7L9.3 18.8l-4.6.9.9-4.6zM13.4 6.5l4.1 4.1'),
  ic_highlight: P('M14.7 4.2l5.1 5.1-7.6 7.6-5.1-5.1zM7.1 11.8l-1.6 4.9 1.8 1.8 4.9-1.6M5.5 18.5l-1.7 1.7h3.6'),
  ic_eraser: P('M8.3 19.5L4.7 15.9a1.6 1.6 0 0 1 0-2.3l8.6-8.6a1.6 1.6 0 0 1 2.3 0l3.6 3.6a1.6 1.6 0 0 1 0 2.3L11 19.5zM8.3 19.5h11.2M8.5 9.8l5.7 5.7'),
  ic_tape: `<circle cx='10' cy='11' r='6.6'/><circle cx='10' cy='11' r='2.4'/>` + P('M10 17.6h10.5v-3'),
  ic_undo: P('M8.6 5.2L4.8 9l3.8 3.8M4.8 9h9.7a4.8 4.8 0 0 1 0 9.6h-3.3'),
  ic_redo: P('M15.4 5.2L19.2 9l-3.8 3.8M19.2 9H9.5a4.8 4.8 0 0 0 0 9.6h3.3'),
  ic_pen_ball: P('M15.3 4.6a1.9 1.9 0 0 1 2.7 0l1.4 1.4a1.9 1.9 0 0 1 0 2.7L9.3 18.8l-4.6.9.9-4.6zM13.4 6.5l4.1 4.1'),
  ic_pen_pencil: P('M16 3.8l4.2 4.2L8.8 19.4H4.6v-4.2zM13.6 6.2l4.2 4.2M4.6 15.2l4.2 4.2'),
  ic_pen_fountain: P('M12 2.8l5.2 7.7L12 21.2l-5.2-10.7zM12 2.8v6') + `<circle cx='12' cy='10.4' r='1.4'/>`,
  ic_pen_brush: P('M20.5 3.5l-8 8M12.5 11.5c-3-.6-5.8 1.4-5.8 4.4 0 1.6-.8 2.8-2.2 3.6 4.8 1.2 9.6-.5 9.6-5 0-1.2-.5-2.3-1.6-3z'),
  ic_pen_marker: P('M14.5 3.8l5.7 5.7L13 16.7 7.3 11zM7.3 11L4 20l9-3.3M9.5 13.2l2 2'),
  ic_width_1: `<path d='M4 12h16' stroke-width='1.2'/>`,
  ic_width_2: `<path d='M4 12h16' stroke-width='2.6'/>`,
  ic_width_3: `<path d='M4 12h16' stroke-width='4.2'/>`,
  ic_width_4: `<path d='M4 12h16' stroke-width='6.2'/>`,

  // coloured strip tools: currentColor = the tool's colour
  tool_pen: `<path d='M15.4 4.4a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L9.4 18.8l-5 1 1-5z' fill='currentColor' stroke='none'/>`
    + `<path d='M15.4 4.4a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L9.4 18.8l-5 1 1-5z' stroke='#010102' stroke-width='1.3'/>`
    + `<path d='M13.4 6.4l4.2 4.2M5.4 14.8l3.8 3.8' stroke='#FFFFFF' stroke-width='1.2' opacity='.85'/>`,
  tool_highlighter: `<path d='M14.8 3.9l5.3 5.3-7.4 7.4-5.3-5.3z' fill='currentColor' stroke='none'/>`
    + P('M14.8 3.9l5.3 5.3-7.4 7.4-5.3-5.3zM7.4 11.3L6 16.2l1.8 1.8 4.9-1.4M6 18l-1.9 1.9h3.6').replace('/>', ` stroke='#010102' stroke-width='1.3'/>`),
  tool_eraser: `<path d='M8.3 19.4L4.6 15.7a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l3.7 3.7a1.6 1.6 0 0 1 0 2.3L11 19.4z' fill='currentColor' stroke='none' opacity='.55'/>`
    + `<path d='M8.3 19.4L4.6 15.7a1.6 1.6 0 0 1 0-2.3l8.7-8.7a1.6 1.6 0 0 1 2.3 0l3.7 3.7a1.6 1.6 0 0 1 0 2.3L11 19.4zM8.3 19.4h11.2M8.4 9.6l5.9 5.9' stroke='#010102' stroke-width='1.3'/>`,
  tool_tape: `<circle cx='10' cy='11' r='6.6' fill='currentColor' stroke='none' opacity='.7'/><circle cx='10' cy='11' r='2.4' fill='#FFFFFF' stroke='none'/>`
    + `<path d='M10 17.6h10.5v-3' stroke='currentColor' stroke-width='3'/>` + `<circle cx='10' cy='11' r='6.6' stroke='#010102' stroke-width='1.3'/><circle cx='10' cy='11' r='2.4' stroke='#010102' stroke-width='1.3'/>`,

  // ---- text formatting
  ic_bold: P('M7 4.5h5.5a3.5 3.5 0 0 1 0 7H7zM7 11.5h6.5a3.5 3.5 0 0 1 0 7H7z'),
  ic_italic: P('M10 4.5h8M6 19.5h8M14.6 4.5L9.4 19.5'),
  ic_underline: P('M7 4.5v7a5 5 0 0 0 10 0v-7M5 20h14'),
  ic_strike: P('M4 12h16M16.5 7.5A4.5 3.2 0 0 0 12 5c-2.8 0-4.5 1.3-4.5 3 0 1.4 1 2.2 2.8 3M8 16.5a4.8 3.2 0 0 0 4 2c2.8 0 4.5-1.3 4.5-3'),
  ic_align_left: P('M4 6h16M4 10h10M4 14h16M4 18h10'),
  ic_align_center: P('M4 6h16M7 10h10M4 14h16M7 18h10'),
  ic_align_right: P('M4 6h16M10 10h10M4 14h16M10 18h10'),
  ic_list_bullet: P('M10 6.5h10M10 12h10M10 17.5h10') + DOT(5, 6.5, 1.3) + DOT(5, 12, 1.3) + DOT(5, 17.5, 1.3),
  ic_list_number: P('M11 6.5h9M11 12h9M11 17.5h9') + `<path d='M4 4.9l1.4-.9v4.6M3.9 10.6a1.5 1.5 0 0 1 2.9.5c0 .9-1.6 1.6-2.9 2.9h3M3.9 16.1h2.6l-1.3 1.5a1.4 1.4 0 1 1-1.4 1.9' stroke-width='1.3'/>`,
  ic_list_check: `<rect x='3.5' y='4.5' width='5' height='5' rx='1'/><rect x='3.5' y='14.5' width='5' height='5' rx='1'/>` + P('M4.9 7.1l1.1 1.1 1.7-2.2M12 7h8M12 17h8'),
};
// The glyphs shared with the Android app win, so both apps look alike; the ones above fill the web-only names.
Object.assign(ICONS, SHARED_ICONS);

// Library folder colours as line-icon tints (the stored folder colours stay the same values; this is only how they are drawn).
export const FOLDER_TINTS = { 0xFF8FA8F0: '#5485EE', 0xFFF4B67E: '#FF7043', 0xFF7FCFB2: '#009E7C', 0xFFB9A0F2: '#BB5FCB', 0xFFF2A3BA: '#FF4133', 0xFFA6B2C6: '#797979' };
export function folderTint(color) { return FOLDER_TINTS[(color >>> 0)] || FOLDER_TINTS[color] || '#797979'; }
