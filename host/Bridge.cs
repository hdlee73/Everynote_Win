using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;

namespace PdfNote;

/// <summary>Implements the JSON host protocol documented at the top of web/js/host.js (see also docs/api-host.md).</summary>
sealed class Bridge
{
    readonly MainWindow win;
    readonly Dictionary<string, WriteSession> writes = new();
    readonly Dictionary<string, CancellationTokenSource> conversions = new();
    readonly List<string> args = new();
    readonly object lk = new();
    bool pageReady;
    int tokenSeq;

    sealed class WriteSession { public FileStream Stream; public string Tmp, Final; }

    public Bridge(MainWindow win, IEnumerable<string> initialArgs)
    {
        this.win = win;
        foreach (var a in initialArgs) AddArg(a);
    }

    void AddArg(string p) { try { var f = PathPolicy.Full(p); PathPolicy.AllowRead(f); lock (lk) args.Add(f); } catch { } }

    /// <summary>File passed by a second instance (or shell). Delivered as an 'open.file' event once the page is up.</summary>
    public void OpenFile(string path)
    {
        string full;
        try { full = PathPolicy.Full(path); PathPolicy.AllowRead(full); } catch { return; }
        bool ready;
        lock (lk) { ready = pageReady; if (!ready) args.Add(full); }
        if (ready) win.PostEvent("open.file", new { path = full });
    }

    // ------------------------------------------------------------------------------------------------- dispatch
    public void OnMessage(string json)
    {
        JsonElement root; JsonElement id;
        try { using var d = JsonDocument.Parse(json); root = d.RootElement.Clone(); }
        catch (Exception e) { Log.Write("bad message: " + e.Message); return; }
        if (!root.TryGetProperty("id", out id)) return;
        var m = root.TryGetProperty("m", out var me) && me.ValueKind == JsonValueKind.String ? me.GetString() : "";
        var a = root.TryGetProperty("a", out var ae) && ae.ValueKind == JsonValueKind.Object ? ae : default;
        _ = Task.Run(async () =>
        {
            string reply;
            try
            {
                var r = await Invoke(m, a);
                reply = JsonSerializer.Serialize(new { id, ok = true, r });
            }
            catch (Exception ex)
            {
                var msg = Unwrap(ex);
                if (m != "fs.stat") Log.Write("host call " + m + " failed: " + msg);
                reply = JsonSerializer.Serialize(new { id, ok = false, e = msg });
            }
            win.PostRaw(reply);
        });
    }

    static string Unwrap(Exception e)
    {
        while (e is AggregateException ag && ag.InnerException != null) e = ag.InnerException;
        var m = e.Message;
        return string.IsNullOrWhiteSpace(m) ? e.GetType().Name : m;
    }

    static string S(JsonElement a, string k, bool required = true)
    {
        if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String) return v.GetString();
        if (required) throw new ArgumentException("missing argument: " + k);
        return null;
    }
    static bool B(JsonElement a, string k) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.True;

    async Task<object> Invoke(string m, JsonElement a)
    {
        switch (m)
        {
            case "app.info": return Info();
            case "app.log": Log.Write("[js] " + S(a, "msg", false)); return true;

            case "fs.list": return FsList(PathPolicy.ReadPath(S(a, "path")));
            case "fs.stat": return FsStat(PathPolicy.ReadPath(S(a, "path")));
            case "fs.url":
                {
                    var p = PathPolicy.ReadPath(S(a, "path"));
                    if (!File.Exists(p)) throw new FileNotFoundException("not found: " + p);
                    return WebServer.FileUrl(p);
                }
            case "fs.readText": return File.ReadAllText(PathPolicy.ReadPath(S(a, "path")), new System.Text.UTF8Encoding(false));
            case "fs.writeText":
                {
                    var p = PathPolicy.WritePath(S(a, "path"));
                    AtomicWrite(p, tmp => File.WriteAllText(tmp, S(a, "text", false) ?? "", new System.Text.UTF8Encoding(false)));
                    return true;
                }
            case "fs.writeBegin":
                {
                    var p = PathPolicy.WritePath(S(a, "path"));
                    Directory.CreateDirectory(Path.GetDirectoryName(p));
                    var tok = "w" + Interlocked.Increment(ref tokenSeq);
                    var tmp = p + "." + tok + ".part";
                    var ws = new WriteSession { Tmp = tmp, Final = p, Stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 65536) };
                    lock (lk) writes[tok] = ws;
                    return tok;
                }
            case "fs.writeChunk":
                {
                    var ws = TakeWrite(S(a, "token"), false);
                    var bytes = Convert.FromBase64String(S(a, "b64"));
                    lock (ws) ws.Stream.Write(bytes, 0, bytes.Length);
                    return true;
                }
            case "fs.writeEnd":
                {
                    var ws = TakeWrite(S(a, "token"), true);
                    ws.Stream.Flush(); ws.Stream.Dispose();
                    File.Move(ws.Tmp, ws.Final, true);
                    return true;
                }
            case "fs.mkdir": Directory.CreateDirectory(PathPolicy.WritePath(S(a, "path"))); return true;
            case "fs.move": return FsMove(PathPolicy.WritePath(S(a, "from")), PathPolicy.WritePath(S(a, "to")));
            case "fs.copy": return FsCopy(PathPolicy.ReadPath(S(a, "from")), PathPolicy.WritePath(S(a, "to")));
            case "fs.delete": return FsDelete(PathPolicy.WritePath(S(a, "path")));

            case "dialog.open": return await win.Dispatcher.InvokeAsync(() => DialogOpen(a));
            case "dialog.save": return await win.Dispatcher.InvokeAsync(() => DialogSave(a));
            case "net.http": return await NetHttp(a);
            case "zip.create": return await Task.Run(() => ZipCreate(a));
            case "zip.entries": return await Task.Run(() => ZipEntries(PathPolicy.ReadPath(S(a, "path"))));
            case "zip.readText": return await Task.Run(() => ZipReadText(PathPolicy.ReadPath(S(a, "path")), S(a, "name")));
            case "zip.extract": return await Task.Run(() => ZipExtract(PathPolicy.ReadPath(S(a, "path")), S(a, "name"), PathPolicy.WritePath(S(a, "to"))));
            case "update.check": return await UpdateCheck();
            case "update.install": return await UpdateInstall(S(a, "url"));
            case "shell.open": ShellOpen(a); return true;
            case "shell.reveal": Reveal(PathPolicy.ReadPath(S(a, "path"))); return true;
            case "window.fullscreen": { var on = B(a, "on"); await win.Dispatcher.InvokeAsync(() => win.SetFullscreen(on)); return true; }
            case "power.keepAwake": KeepAwake(B(a, "on")); return true;

            case "office.engines": return await Task.Run(OfficeConverter.Engines);
            case "office.convert": return await OfficeConvert(a);
            case "office.cancel":
                {
                    var id = S(a, "id", false);
                    CancellationTokenSource c = null;
                    lock (lk) if (id != null) conversions.TryGetValue(id, out c);
                    try { c?.Cancel(); } catch { }
                    return true;
                }
            case "ocr.recognize": return await OcrService.RecognizeAsync(S(a, "png"), S(a, "lang", false));
            default: throw new NotSupportedException("unknown host method " + m);
        }
    }

    // ------------------------------------------------------------------------------------------------- app
    object Info()
    {
        List<string> list;
        lock (lk) { pageReady = true; list = args.ToList(); args.Clear(); }
        var ver = typeof(Bridge).Assembly.GetName().Version;
        var v = System.Reflection.CustomAttributeExtensions.GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>(typeof(Bridge).Assembly)?.InformationalVersion
                ?? (ver == null ? "2.0.0" : ver.ToString(3));
        var plus = v.IndexOf('+'); if (plus > 0) v = v.Substring(0, plus);
        return new { library = AppPaths.Library, data = AppPaths.Data, temp = AppPaths.Temp, documents = AppPaths.Documents, args = list, version = v, platform = "win", installed = IsInstalled(), arch = Arch };
    }

    // ------------------------------------------------------------------------------------------------- fs
    static long Ms(DateTime utc) => new DateTimeOffset(DateTime.SpecifyKind(utc, DateTimeKind.Utc)).ToUnixTimeMilliseconds();

    static object FsList(string dir)
    {
        var di = new DirectoryInfo(dir);
        if (!di.Exists) throw new DirectoryNotFoundException("not found: " + dir);
        var res = new List<object>();
        foreach (var e in di.EnumerateFileSystemInfos())
        {
            try
            {
                bool isDir = (e.Attributes & FileAttributes.Directory) != 0;
                res.Add(new { name = e.Name, path = e.FullName, isDir, size = isDir ? 0L : ((FileInfo)e).Length, mtime = Ms(e.LastWriteTimeUtc) });
            }
            catch { }
        }
        return res;
    }

    static object FsStat(string p)
    {
        if (Directory.Exists(p)) return new { exists = true, isDir = true, size = 0L, mtime = Ms(Directory.GetLastWriteTimeUtc(p)) };
        if (File.Exists(p)) { var f = new FileInfo(p); return new { exists = true, isDir = false, size = f.Length, mtime = Ms(f.LastWriteTimeUtc) }; }
        return new { exists = false, isDir = false, size = 0L, mtime = 0L };
    }

    static void AtomicWrite(string final, Action<string> write)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(final));
        var tmp = final + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".part";
        try { write(tmp); File.Move(tmp, final, true); }
        finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
    }

    WriteSession TakeWrite(string tok, bool remove)
    {
        lock (lk)
        {
            if (!writes.TryGetValue(tok, out var ws)) throw new InvalidOperationException("unknown write token");
            if (remove) writes.Remove(tok);
            return ws;
        }
    }

    static object FsMove(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to));
        if (File.Exists(from)) { File.Move(from, to, true); return true; }
        if (Directory.Exists(from))
        {
            if (string.Equals(from, to, StringComparison.OrdinalIgnoreCase)) { if (from != to) { var t = to + ".tmp-" + Guid.NewGuid().ToString("N").Substring(0, 6); Directory.Move(from, t); Directory.Move(t, to); } return true; }
            if (Path.GetPathRoot(from).Equals(Path.GetPathRoot(to), StringComparison.OrdinalIgnoreCase)) Directory.Move(from, to);
            else { CopyDir(from, to); Directory.Delete(from, true); }
            return true;
        }
        throw new FileNotFoundException("not found: " + from);
    }

    // ---- same-network device sync: plain-http requests to a private IPv4 address only (https pages cannot fetch http directly)
    static readonly System.Net.Http.HttpClient lan = new(new System.Net.Http.HttpClientHandler { AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromMinutes(10) };
    static bool IsPrivateHost(string host)
    {
        if (!System.Net.IPAddress.TryParse(host, out var ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return false;
        var b = ip.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }
    static async Task<object> NetHttp(JsonElement a)
    {
        var uri = new Uri(S(a, "url"));
        if (uri.Scheme != "http" || !IsPrivateHost(uri.Host)) throw new ArgumentException("같은 네트워크(사설 주소)의 기기만 연결할 수 있습니다");
        var method = new System.Net.Http.HttpMethod((S(a, "method", false) ?? "GET").ToUpperInvariant());
        using var req = new System.Net.Http.HttpRequestMessage(method, uri);
        if (a.TryGetProperty("headers", out var hs) && hs.ValueKind == JsonValueKind.Object)
            foreach (var h in hs.EnumerateObject()) if (h.Value.ValueKind == JsonValueKind.String && !req.Headers.TryAddWithoutValidation(h.Name, h.Value.GetString())) { }
        FileStream upload = null;
        try
        {
            var readPath = S(a, "readPath", false);
            if (readPath != null) { upload = File.OpenRead(PathPolicy.ReadPath(readPath)); req.Content = new System.Net.Http.StreamContent(upload); }
            else if (S(a, "text", false) is string text) req.Content = new System.Net.Http.StringContent(text, new System.Text.UTF8Encoding(false), "application/json");
            var savePath = S(a, "savePath", false);
            using var res = await lan.SendAsync(req, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);
            if (savePath != null && res.IsSuccessStatusCode)
            {
                var dest = PathPolicy.WritePath(savePath);
                Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dest));
                var tmp = dest + ".part";
                await using (var fs = File.Create(tmp)) await res.Content.CopyToAsync(fs);
                File.Move(tmp, dest, true);
                return new { status = (int)res.StatusCode, text = "" };
            }
            var body = method == System.Net.Http.HttpMethod.Head ? "" : await res.Content.ReadAsStringAsync();
            return new { status = (int)res.StatusCode, text = body.Length > 20 * 1024 * 1024 ? "" : body };
        }
        catch (TaskCanceledException) { throw new IOException("기기가 응답하지 않습니다"); }
        catch (System.Net.Http.HttpRequestException e) { throw new IOException("기기에 연결할 수 없습니다 (" + (e.InnerException?.Message ?? e.Message) + ")"); }
        finally { upload?.Dispose(); }
    }

    // ---- whole-library backup: plain ZIP (same layout as the Android app's backup file)
    static object ZipCreate(JsonElement a)
    {
        var path = PathPolicy.WritePath(S(a, "path"));
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        var tmp = path + ".part"; int count = 0;
        try
        {
            using (var fs = File.Create(tmp))
            using (var z = new System.IO.Compression.ZipArchive(fs, System.IO.Compression.ZipArchiveMode.Create))
            {
                foreach (var e in a.GetProperty("entries").EnumerateArray())
                {
                    var name = e.GetProperty("name").GetString();
                    if (string.IsNullOrEmpty(name) || name.StartsWith("/") || name.Contains("..") || name.Contains('\\')) throw new ArgumentException("bad entry name");
                    var entry = z.CreateEntry(name, System.IO.Compression.CompressionLevel.Fastest);
                    using var es = entry.Open();
                    if (e.TryGetProperty("file", out var f) && f.ValueKind == JsonValueKind.String) { using var src = File.OpenRead(PathPolicy.ReadPath(f.GetString())); src.CopyTo(es); }
                    else { var bytes = new System.Text.UTF8Encoding(false).GetBytes(e.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : ""); es.Write(bytes, 0, bytes.Length); }
                    count++;
                }
            }
            File.Move(tmp, path, true);
        }
        finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
        return new { count };
    }
    static object ZipEntries(string path)
    {
        using var z = System.IO.Compression.ZipFile.OpenRead(path);
        return z.Entries.Where(e => !e.FullName.EndsWith("/")).Select(e => new { name = e.FullName, size = e.Length }).ToList();
    }
    static object ZipReadText(string path, string name)
    {
        using var z = System.IO.Compression.ZipFile.OpenRead(path);
        var e = z.GetEntry(name) ?? throw new FileNotFoundException("not in zip: " + name);
        if (e.Length > 128L * 1024 * 1024) throw new IOException("항목이 너무 큽니다");
        using var r = new StreamReader(e.Open(), new System.Text.UTF8Encoding(false));
        return r.ReadToEnd();
    }
    static object ZipExtract(string path, string name, string to)
    {
        using var z = System.IO.Compression.ZipFile.OpenRead(path);
        var e = z.GetEntry(name) ?? throw new FileNotFoundException("not in zip: " + name);
        Directory.CreateDirectory(Path.GetDirectoryName(to));
        var tmp = to + ".part";
        try { using (var src = e.Open()) using (var dst = File.Create(tmp)) src.CopyTo(dst); File.Move(tmp, to, true); }
        finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
        return true;
    }

    // ---- update check (GitHub releases of this project only)
    const string ReleaseApi = "https://api.github.com/repos/hdlee73/PDF-Note-Windows/releases/latest";
    const string DownloadPrefix = "https://github.com/hdlee73/PDF-Note-Windows/releases/download/";
    static readonly System.Net.Http.HttpClient web = new() { Timeout = TimeSpan.FromMinutes(15) };
    static string Arch => RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "arm64" : "x64";
    static bool IsInstalled() => File.Exists(Path.Combine(AppContext.BaseDirectory, "unins000.exe"));
    static async Task<object> UpdateCheck()
    {
        using var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get, ReleaseApi);
        req.Headers.TryAddWithoutValidation("User-Agent", "Everynote");
        req.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
        try
        {
            using var res = await web.SendAsync(req);
            if (!res.IsSuccessStatusCode) throw new IOException("업데이트 서버 응답 " + (int)res.StatusCode);
            using var d = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            var root = d.RootElement;
            var tag = root.GetProperty("tag_name").GetString() ?? "";
            string setup = null, exe = null;
            if (root.TryGetProperty("assets", out var assets))
                foreach (var asset in assets.EnumerateArray())
                {
                    var n = asset.GetProperty("name").GetString() ?? ""; var u = asset.GetProperty("browser_download_url").GetString();
                    if (n.EndsWith("-" + Arch + ".exe", StringComparison.OrdinalIgnoreCase) && n.Contains("Setup", StringComparison.OrdinalIgnoreCase)) setup = u;
                    else if (n.EndsWith("-win-" + Arch + ".exe", StringComparison.OrdinalIgnoreCase)) exe = u;
                }
            return new
            {
                version = tag.TrimStart('v', 'V'),
                page = root.TryGetProperty("html_url", out var h) ? h.GetString() : "",
                notes = root.TryGetProperty("body", out var b) && b.ValueKind == JsonValueKind.String ? b.GetString() : "",
                setupUrl = setup, exeUrl = exe, installed = IsInstalled(), arch = Arch,
            };
        }
        catch (System.Net.Http.HttpRequestException e) { throw new IOException("업데이트 서버에 연결할 수 없습니다 (" + (e.InnerException?.Message ?? e.Message) + ")"); }
        catch (TaskCanceledException) { throw new IOException("업데이트 서버가 응답하지 않습니다"); }
    }
    /// <summary>Downloads the Setup of a release of this project and starts it in update mode (it closes this app, keeps all documents and settings).</summary>
    async Task<object> UpdateInstall(string url)
    {
        if (!url.StartsWith(DownloadPrefix, StringComparison.Ordinal) || !url.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("허용되지 않는 주소입니다");
        Directory.CreateDirectory(AppPaths.Temp);
        var dest = Path.Combine(AppPaths.Temp, Path.GetFileName(new Uri(url).LocalPath));
        var tmp = dest + ".part";
        using (var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get, url))
        {
            req.Headers.TryAddWithoutValidation("User-Agent", "Everynote");
            using var res = await web.SendAsync(req, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);
            if (!res.IsSuccessStatusCode) throw new IOException("내려받지 못했습니다 (" + (int)res.StatusCode + ")");
            await using var fs = File.Create(tmp); await res.Content.CopyToAsync(fs);
        }
        File.Move(tmp, dest, true);
        Process.Start(new ProcessStartInfo(dest, "/UPDATE") { UseShellExecute = true });
        return true;
    }

    static object FsCopy(string from, string to)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(to));
        if (File.Exists(from)) { File.Copy(from, to, true); return true; }
        if (Directory.Exists(from)) { CopyDir(from, to); return true; }
        throw new FileNotFoundException("not found: " + from);
    }

    static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)), true);
        foreach (var d in Directory.GetDirectories(from)) CopyDir(d, Path.Combine(to, Path.GetFileName(d)));
    }

    static object FsDelete(string p)
    {
        // never delete a root of the policy itself
        if (p.Equals(AppPaths.Library, StringComparison.OrdinalIgnoreCase) || p.Equals(AppPaths.Data, StringComparison.OrdinalIgnoreCase) || p.Length <= 3)
            throw new UnauthorizedAccessException("삭제할 수 없는 경로입니다");
        if (File.Exists(p)) { File.SetAttributes(p, FileAttributes.Normal); File.Delete(p); }
        else if (Directory.Exists(p)) DeleteDir(p);
        return true;
    }

    static void DeleteDir(string p)
    {
        foreach (var f in Directory.EnumerateFiles(p, "*", SearchOption.AllDirectories)) { try { File.SetAttributes(f, FileAttributes.Normal); } catch { } }
        Directory.Delete(p, true);
    }

    // ------------------------------------------------------------------------------------------------- dialogs / shell
    static string Filter(JsonElement a)
    {
        var parts = new List<string>();
        if (a.ValueKind == JsonValueKind.Object && a.TryGetProperty("filters", out var fs) && fs.ValueKind == JsonValueKind.Array)
        {
            foreach (var f in fs.EnumerateArray())
            {
                var name = f.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : "Files";
                var exts = new List<string>();
                if (f.TryGetProperty("exts", out var ex) && ex.ValueKind == JsonValueKind.Array)
                    foreach (var e in ex.EnumerateArray()) { var s = (e.GetString() ?? "").Trim().TrimStart('*', '.'); if (s.Length > 0) exts.Add("*." + s); }
                if (exts.Count == 0) continue;
                var pat = string.Join(";", exts);
                parts.Add(name.Replace("|", "/") + " (" + pat + ")|" + pat);
            }
        }
        parts.Add("모든 파일 (*.*)|*.*");
        return string.Join("|", parts);
    }

    object DialogOpen(JsonElement a)
    {
        var d = new OpenFileDialog { Title = S(a, "title", false) ?? "열기", Filter = Filter(a), Multiselect = B(a, "multi"), CheckFileExists = true, CheckPathExists = true };
        if (d.ShowDialog(win) != true) return new string[0];
        foreach (var f in d.FileNames) PathPolicy.AllowRead(f);
        return d.FileNames;
    }

    object DialogSave(JsonElement a)
    {
        var name = S(a, "name", false) ?? "";
        var d = new SaveFileDialog { Title = S(a, "title", false) ?? "저장", Filter = Filter(a), FileName = name, OverwritePrompt = true, AddExtension = true };
        var ext = Path.GetExtension(name);
        if (!string.IsNullOrEmpty(ext)) d.DefaultExt = ext.TrimStart('.');
        if (d.ShowDialog(win) != true) return null;
        PathPolicy.AllowWrite(d.FileName);
        return d.FileName;
    }

    static readonly HashSet<string> Dangerous = new(StringComparer.OrdinalIgnoreCase)
    { ".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".msp", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".hta", ".lnk", ".url", ".reg", ".dll", ".cpl", ".jar", ".appx", ".msix", ".application", ".gadget", ".inf", ".pif" };

    void ShellOpen(JsonElement a)
    {
        var url = S(a, "url", false);
        if (!string.IsNullOrEmpty(url))
        {
            if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "mailto"))
                throw new ArgumentException("허용되지 않는 주소입니다");
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
            return;
        }
        var p = PathPolicy.ReadPath(S(a, "path"));
        if (Dangerous.Contains(Path.GetExtension(p))) throw new UnauthorizedAccessException("이 형식의 파일은 열 수 없습니다");
        if (!File.Exists(p) && !Directory.Exists(p)) throw new FileNotFoundException("not found: " + p);
        Process.Start(new ProcessStartInfo(p) { UseShellExecute = true });
    }

    static void Reveal(string p)
    {
        if (File.Exists(p)) Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, Arguments = "/select,\"" + p + "\"" });
        else if (Directory.Exists(p)) Process.Start(new ProcessStartInfo("explorer.exe") { UseShellExecute = false, Arguments = "\"" + p + "\"" });
        else throw new FileNotFoundException("not found: " + p);
    }

    // ------------------------------------------------------------------------------------------------- power
    [DllImport("kernel32.dll")] static extern uint SetThreadExecutionState(uint f);
    const uint ES_CONTINUOUS = 0x80000000, ES_SYSTEM_REQUIRED = 1, ES_DISPLAY_REQUIRED = 2;

    void KeepAwake(bool on)
    {
        // SetThreadExecutionState is per thread: always call it from the UI thread so on/off pair up
        win.Dispatcher.Invoke(() => SetThreadExecutionState(on ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED : ES_CONTINUOUS));
    }

    // ------------------------------------------------------------------------------------------------- office
    async Task<object> OfficeConvert(JsonElement a)
    {
        var id = S(a, "id"); var path = S(a, "path"); var kind = S(a, "kind", false);
        var cts = new CancellationTokenSource();
        lock (lk) conversions[id] = cts;
        try
        {
            var pdf = await OfficeConverter.ConvertAsync(id, path, kind, text => win.PostEvent("office.progress", new { id, text }), cts.Token);
            return new { pdf };
        }
        catch (OperationCanceledException) { throw new Exception(cts.IsCancellationRequested ? "변환이 중단되었습니다" : "변환 시간이 초과되었습니다"); }
        finally { lock (lk) conversions.Remove(id); cts.Dispose(); }
    }

    public void Shutdown()
    {
        lock (lk)
        {
            foreach (var c in conversions.Values) { try { c.Cancel(); } catch { } }
            foreach (var w in writes.Values) { try { w.Stream.Dispose(); File.Delete(w.Tmp); } catch { } }
            writes.Clear();
        }
    }
}
