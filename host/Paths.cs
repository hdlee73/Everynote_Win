using System.IO;
using System.Text;
using System.Text.Json;

namespace PdfNote;

/// <summary>Well-known folders. Everything the app writes lives under %LOCALAPPDATA%\PDFNote (or the library folder).</summary>
static class AppPaths
{
    public static readonly string Data = Env("PDFNOTE_DATA") ??
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PDFNote");
    public static readonly string WebView2Data = Path.Combine(Data, "WebView2");
    public static readonly string Temp = Path.Combine(Data, "tmp");
    public static readonly string LogFile = Path.Combine(Data, "log.txt");
    public static readonly string Documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
    public static readonly string Fonts = Environment.GetFolderPath(Environment.SpecialFolder.Fonts);
    public static readonly string SystemTemp = Path.GetTempPath().TrimEnd('\\');
    public static readonly string Library = ResolveLibrary();

    static string Env(string n) { var v = Environment.GetEnvironmentVariable(n); return string.IsNullOrWhiteSpace(v) ? null : v; }

    static string ResolveLibrary()
    {
        // order: env PDFNOTE_LIBRARY, <data>\config.json {"library": "..."}, Documents\PDF Note
        var v = Env("PDFNOTE_LIBRARY");
        if (v == null)
        {
            try
            {
                var cfg = Path.Combine(Data, "config.json");
                if (File.Exists(cfg))
                {
                    using var d = JsonDocument.Parse(File.ReadAllText(cfg));
                    if (d.RootElement.TryGetProperty("library", out var l) && l.ValueKind == JsonValueKind.String) v = l.GetString();
                }
            }
            catch { }
        }
        if (string.IsNullOrWhiteSpace(v)) v = Path.Combine(Documents, "PDF Note");
        return Path.GetFullPath(v).TrimEnd('\\');
    }

    public static void EnsureDirs()
    {
        foreach (var d in new[] { Data, WebView2Data, Temp, Library })
        {
            try { Directory.CreateDirectory(d); } catch (Exception e) { Log.Write("mkdir " + d + ": " + e.Message); }
        }
        // sweep stale temp files (older than 2 days)
        try
        {
            var cutoff = DateTime.UtcNow.AddDays(-2);
            foreach (var e in new DirectoryInfo(Temp).EnumerateFileSystemInfos())
                if (e.LastWriteTimeUtc < cutoff) { try { if (e is DirectoryInfo di) di.Delete(true); else e.Delete(); } catch { } }
        }
        catch { }
    }
}

static class Log
{
    static readonly object L = new();
    public static void Write(string msg)
    {
        try
        {
            lock (L)
            {
                Directory.CreateDirectory(AppPaths.Data);
                var fi = new FileInfo(AppPaths.LogFile);
                if (fi.Exists && fi.Length > 2 * 1024 * 1024)
                {
                    var old = AppPaths.LogFile + ".1";
                    try { File.Delete(old); File.Move(AppPaths.LogFile, old); } catch { }
                }
                File.AppendAllText(AppPaths.LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + msg + Environment.NewLine, new UTF8Encoding(false));
            }
        }
        catch { }
    }
}

/// <summary>
/// Security model for filesystem access from the page. The page can only be our embedded app (navigation is locked), but
/// we still scope everything: reads are limited to the library, %LOCALAPPDATA%\PDFNote, temp dirs, C:\Windows\Fonts and files the
/// user picked through the open dialog / command line / second instance. Writes are limited to library, data, temp and files
/// the user chose in the save dialog.
/// </summary>
static class PathPolicy
{
    static readonly object L = new();
    static readonly HashSet<string> chosenRead = new(StringComparer.OrdinalIgnoreCase);
    static readonly HashSet<string> chosenWrite = new(StringComparer.OrdinalIgnoreCase);
    static readonly string allowFile = Path.Combine(AppPaths.Data, "allowed.json");

    static readonly string[] ReadRoots = { AppPaths.Library, AppPaths.Data, AppPaths.SystemTemp, AppPaths.Fonts, @"C:\Windows\Fonts" };
    static readonly string[] WriteRoots = { AppPaths.Library, AppPaths.Data, AppPaths.SystemTemp };

    static PathPolicy()
    {
        try
        {
            if (File.Exists(allowFile))
            {
                using var d = JsonDocument.Parse(File.ReadAllText(allowFile));
                foreach (var e in d.RootElement.GetProperty("files").EnumerateArray()) chosenRead.Add(e.GetString());
            }
        }
        catch { }
    }

    public static string Full(string p)
    {
        if (string.IsNullOrWhiteSpace(p)) throw new ArgumentException("empty path");
        if (p.IndexOf('\0') >= 0) throw new ArgumentException("bad path");
        var f = Path.GetFullPath(p.Replace('/', '\\'));
        if (f.Length > 3) f = f.TrimEnd('\\');
        return f;
    }

    static bool Under(string full, string root)
    {
        if (string.IsNullOrEmpty(root)) return false;
        root = root.Length > 3 ? root.TrimEnd('\\') : root;
        if (full.Equals(root, StringComparison.OrdinalIgnoreCase)) return true;
        return full.StartsWith(root.EndsWith("\\") ? root : root + "\\", StringComparison.OrdinalIgnoreCase);
    }

    public static bool CanRead(string full)
    {
        foreach (var r in ReadRoots) if (Under(full, r)) return true;
        lock (L) return chosenRead.Contains(full) || chosenWrite.Contains(full);
    }

    public static bool CanWrite(string full)
    {
        foreach (var r in WriteRoots) if (Under(full, r)) return true;
        lock (L) return chosenWrite.Contains(full);
    }

    public static string ReadPath(string p)
    {
        var f = Full(p);
        if (!CanRead(f)) { Log.Write("denied read " + f); throw new UnauthorizedAccessException("접근할 수 없는 경로입니다: " + f); }
        return f;
    }

    public static string WritePath(string p)
    {
        var f = Full(p);
        if (!CanWrite(f)) { Log.Write("denied write " + f); throw new UnauthorizedAccessException("쓸 수 없는 경로입니다: " + f); }
        return f;
    }

    public static void AllowRead(string p)
    {
        try
        {
            var f = Full(p);
            lock (L)
            {
                if (!chosenRead.Add(f)) return;
                if (chosenRead.Count > 500) chosenRead.Remove(chosenRead.First());
                try
                {
                    Directory.CreateDirectory(AppPaths.Data);
                    File.WriteAllText(allowFile, JsonSerializer.Serialize(new { files = chosenRead.ToArray() }));
                }
                catch { }
            }
        }
        catch { }
    }

    public static void AllowWrite(string p)
    {
        try { var f = Full(p); lock (L) chosenWrite.Add(f); } catch { }
    }
}
