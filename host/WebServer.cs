using System.IO;
using System.Reflection;
using Microsoft.Web.WebView2.Core;

namespace PdfNote;

/// <summary>
/// Answers https://app.pdfnote.local/* from embedded resources (web/**) and https://file.pdfnote.local/f?p=... from disk
/// (allow-listed roots, Range support). Runs on the UI thread inside WebResourceRequested.
/// </summary>
sealed class WebServer
{
    public const string AppHost = "app.pdfnote.local";
    public const string FileHost = "file.pdfnote.local";
    public const string AppOrigin = "https://" + AppHost;

    readonly CoreWebView2Environment env;
    readonly Dictionary<string, string> resources = new(StringComparer.OrdinalIgnoreCase);
    readonly Assembly asm = typeof(WebServer).Assembly;

    public WebServer(CoreWebView2Environment env)
    {
        this.env = env;
        foreach (var n in asm.GetManifestResourceNames())
            if (n.StartsWith("web/", StringComparison.OrdinalIgnoreCase))
                resources[n.Replace('\\', '/').Substring(4)] = n;
        Log.Write("embedded web resources: " + resources.Count);
    }

    public static string FileUrl(string path) => "https://" + FileHost + "/f?p=" + Uri.EscapeDataString(path);

    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".htm"] = "text/html; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8", [".mjs"] = "text/javascript; charset=utf-8",
        [".css"] = "text/css; charset=utf-8", [".json"] = "application/json; charset=utf-8",
        [".map"] = "application/json", [".txt"] = "text/plain; charset=utf-8", [".md"] = "text/plain; charset=utf-8",
        [".xml"] = "application/xml", [".svg"] = "image/svg+xml", [".png"] = "image/png", [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg", [".gif"] = "image/gif", [".webp"] = "image/webp", [".ico"] = "image/x-icon",
        [".wasm"] = "application/wasm", [".woff"] = "font/woff", [".woff2"] = "font/woff2", [".ttf"] = "font/ttf",
        [".otf"] = "font/otf", [".ttc"] = "font/collection", [".pdf"] = "application/pdf",
        [".mp3"] = "audio/mpeg", [".wav"] = "audio/wav", [".webm"] = "audio/webm", [".m4a"] = "audio/mp4",
        [".ftl"] = "text/plain; charset=utf-8", [".bcmap"] = "application/octet-stream", [".pfb"] = "application/octet-stream",
    };

    static string MimeOf(string name) => Mime.TryGetValue(Path.GetExtension(name), out var m) ? m : "application/octet-stream";

    CoreWebView2WebResourceResponse Make(Stream s, int code, string reason, string headers)
        => env.CreateWebResourceResponse(s, code, reason, headers);

    CoreWebView2WebResourceResponse Text(int code, string reason, string body, string extra = "")
        => Make(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(body)), code, reason, "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\n" + extra);

    public void Handle(CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var uri = new Uri(e.Request.Uri);
            if (uri.Host.Equals(AppHost, StringComparison.OrdinalIgnoreCase)) e.Response = ServeApp(e.Request, uri);
            else if (uri.Host.Equals(FileHost, StringComparison.OrdinalIgnoreCase)) e.Response = ServeFile(e.Request, uri);
        }
        catch (Exception ex)
        {
            Log.Write("WebResourceRequested " + e.Request.Uri + ": " + ex);
            try { e.Response = Text(500, "Internal Server Error", ex.Message); } catch { }
        }
    }

    CoreWebView2WebResourceResponse ServeApp(CoreWebView2WebResourceRequest req, Uri uri)
    {
        var p = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (p.Length == 0 || p.EndsWith("/")) p += "index.html";
        if (p.Contains("..")) return Text(400, "Bad Request", "bad path");
        if (!resources.TryGetValue(p, out var name)) return Text(404, "Not Found", "not found: " + p);
        var s = asm.GetManifestResourceStream(name);
        if (s == null) return Text(404, "Not Found", "not found: " + p);
        var h = "Content-Type: " + MimeOf(p) + "\r\nCache-Control: no-store\r\nContent-Length: " + s.Length +
                "\r\nCross-Origin-Resource-Policy: same-origin\r\n";
        if (req.Method == "HEAD") { s.Dispose(); return Make(new MemoryStream(), 200, "OK", h); }
        return Make(s, 200, "OK", h);
    }

    static string Query(Uri uri, string key)
    {
        var q = uri.Query;
        if (q.StartsWith("?")) q = q.Substring(1);
        foreach (var part in q.Split('&'))
        {
            var i = part.IndexOf('=');
            if (i > 0 && part.Substring(0, i) == key) return Uri.UnescapeDataString(part.Substring(i + 1));
        }
        return null;
    }

    CoreWebView2WebResourceResponse ServeFile(CoreWebView2WebResourceRequest req, Uri uri)
    {
        var cors = "Access-Control-Allow-Origin: " + AppOrigin + "\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n" +
                   "Cross-Origin-Resource-Policy: cross-origin\r\nVary: Origin\r\n";
        if (req.Method == "OPTIONS")
            return Make(new MemoryStream(), 204, "No Content", cors + "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type\r\nAccess-Control-Max-Age: 600\r\n");
        // CORS: only our own origin may read file bytes
        string origin = null;
        try { if (req.Headers.Contains("Origin")) origin = req.Headers.GetHeader("Origin"); } catch { }
        if (!string.IsNullOrEmpty(origin) && !origin.Equals(AppOrigin, StringComparison.OrdinalIgnoreCase) && origin != "null")
            return Text(403, "Forbidden", "forbidden origin");

        var raw = Query(uri, "p");
        if (raw == null || uri.AbsolutePath != "/f") return Text(404, "Not Found", "not found", cors);
        string full;
        try { full = PathPolicy.ReadPath(raw); }
        catch (Exception ex) { return Text(403, "Forbidden", ex.Message, cors); }
        FileInfo fi;
        try { fi = new FileInfo(full); } catch { return Text(404, "Not Found", "not found", cors); }
        if (!fi.Exists) return Text(404, "Not Found", "not found", cors);

        long len = fi.Length, start = 0, end = len - 1;
        int code = 200; string reason = "OK";
        string range = null;
        try { if (req.Headers.Contains("Range")) range = req.Headers.GetHeader("Range"); } catch { }
        string extra = "";
        if (!string.IsNullOrEmpty(range) && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            var spec = range.Substring(6).Split(',')[0].Trim();
            var dash = spec.IndexOf('-');
            bool ok = dash >= 0;
            if (ok)
            {
                var a = spec.Substring(0, dash); var b = spec.Substring(dash + 1);
                if (a.Length == 0 && long.TryParse(b, out var suffix) && suffix > 0) { start = Math.Max(0, len - suffix); end = len - 1; }
                else if (long.TryParse(a, out var s0))
                {
                    start = s0; end = b.Length == 0 ? len - 1 : (long.TryParse(b, out var e0) ? Math.Min(e0, len - 1) : -1);
                    if (end < start) ok = false;
                }
                else ok = false;
            }
            if (!ok || start >= len)
                return Make(new MemoryStream(), 416, "Range Not Satisfiable", cors + "Content-Range: bytes */" + len + "\r\n");
            code = 206; reason = "Partial Content";
            extra = "Content-Range: bytes " + start + "-" + end + "/" + len + "\r\n";
        }
        long count = len == 0 ? 0 : end - start + 1;
        var h = cors + "Content-Type: " + MimeOf(full) + "\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nContent-Length: " + count + "\r\n" + extra;
        if (req.Method == "HEAD" || count == 0) return Make(new MemoryStream(), code, reason, h);
        var fs = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 65536, FileOptions.SequentialScan);
        return Make(new RangeStream(fs, start, count), code, reason, h);
    }
}

/// <summary>Read-only window onto a part of a seekable stream.</summary>
sealed class RangeStream : Stream
{
    readonly Stream inner; readonly long start, count; long pos;
    public RangeStream(Stream inner, long start, long count) { this.inner = inner; this.start = start; this.count = count; inner.Seek(start, SeekOrigin.Begin); }
    public override bool CanRead => true; public override bool CanSeek => true; public override bool CanWrite => false;
    public override long Length => count;
    public override long Position { get => pos; set => Seek(value, SeekOrigin.Begin); }
    public override int Read(byte[] buffer, int offset, int n)
    {
        long left = count - pos; if (left <= 0) return 0;
        int r = inner.Read(buffer, offset, (int)Math.Min(n, left)); pos += r; return r;
    }
    public override long Seek(long offset, SeekOrigin origin)
    {
        long p = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? pos + offset : count + offset;
        if (p < 0) p = 0; if (p > count) p = count;
        pos = p; inner.Seek(start + p, SeekOrigin.Begin); return pos;
    }
    public override void Flush() { }
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int n) => throw new NotSupportedException();
    protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
}
