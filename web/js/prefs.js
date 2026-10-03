// SharedPreferences("recent_documents") equivalent, synchronous, backed by localStorage.
const NS = 'pdfnote.';
function get(k) { try { return localStorage.getItem(NS + k); } catch { return null; } }
function put(k, v) { try { localStorage.setItem(NS + k, String(v)); } catch { /* ignore */ } }
export const prefs = {
  getBoolean(k, d) { const v = get(k); return v == null ? d : v === 'true'; },
  getInt(k, d) { const v = get(k); return v == null ? d : (parseInt(v, 10) || 0); },
  getFloat(k, d) { const v = get(k); return v == null ? d : (parseFloat(v) || 0); },
  getString(k, d) { const v = get(k); return v == null ? d : v; },
  putBoolean(k, v) { put(k, !!v); },
  putInt(k, v) { put(k, v | 0); },
  putFloat(k, v) { put(k, v); },
  putString(k, v) { if (v == null) this.remove(k); else put(k, v); },
  remove(k) { try { localStorage.removeItem(NS + k); } catch { /* ignore */ } },
  contains(k) { return get(k) != null; },
};
