using System.IO;
using System.Security.Cryptography;
using System.Text.Json;

namespace PdfNote;

/// <summary>Local persistence: settings, recents, annotation sidecars. Everything stays on the device.</summary>
public static class Store
{
    static readonly JsonSerializerOptions Opt = new() { WriteIndented = false, PropertyNameCaseInsensitive = true };
    public static AppSettings Settings { get; private set; } = new();

    static string EnsureDir(string p) { Directory.CreateDirectory(p); return p; }

    public static string Root => EnsureDir(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PDFNote"));
    static string AnnoDir => EnsureDir(Path.Combine(Root, "annotations"));
    public static string ThumbDir => EnsureDir(Path.Combine(Root, "thumbs"));
    public static string LibraryDir => EnsureDir(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "PDF Note"));

    public static void Log(string msg)
    {
        try { File.AppendAllText(Path.Combine(Root, "log.txt"), $"[{DateTime.Now:s}] {msg}\n"); } catch { }
    }

    static void AtomicWrite(string path, string text)
    {
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, path, true);
    }

    /// <summary>Content fingerprint so annotations survive renaming/moving a file.</summary>
    public static string Fingerprint(string path)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            long len = fs.Length;
            int n = (int)Math.Min(65536, len);
            var head = new byte[n];
            fs.ReadExactly(head, 0, n);
            byte[] tail = Array.Empty<byte>();
            if (len > 131072)
            {
                fs.Seek(-65536, SeekOrigin.End);
                tail = new byte[65536];
                fs.ReadExactly(tail, 0, 65536);
            }
            using var sha = SHA1.Create();
            sha.TransformBlock(BitConverter.GetBytes(len), 0, 8, null, 0);
            sha.TransformBlock(head, 0, head.Length, null, 0);
            sha.TransformFinalBlock(tail, 0, tail.Length);
            return Convert.ToHexString(sha.Hash!).Substring(0, 24).ToLowerInvariant();
        }
        catch
        {
            return Convert.ToHexString(SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant())))
                .Substring(0, 24).ToLowerInvariant();
        }
    }

    public static DocAnnotations LoadAnnotations(string key)
    {
        try
        {
            var f = Path.Combine(AnnoDir, key + ".json");
            if (File.Exists(f))
                return JsonSerializer.Deserialize<DocAnnotations>(File.ReadAllText(f), Opt) ?? new DocAnnotations();
        }
        catch (Exception ex) { Log("LoadAnnotations: " + ex); }
        return new DocAnnotations();
    }

    public static void SaveAnnotations(string key, DocAnnotations a)
    {
        try { AtomicWrite(Path.Combine(AnnoDir, key + ".json"), JsonSerializer.Serialize(a, Opt)); }
        catch (Exception ex) { Log("SaveAnnotations: " + ex); }
    }

    public static string SerializeAnnotations(DocAnnotations a) =>
        JsonSerializer.Serialize(a, new JsonSerializerOptions { WriteIndented = true });

    public static DocAnnotations DeserializeAnnotations(string json) =>
        JsonSerializer.Deserialize<DocAnnotations>(json, Opt);

    public static void LoadSettings()
    {
        try
        {
            var f = Path.Combine(Root, "settings.json");
            if (File.Exists(f))
                Settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(f), Opt) ?? new AppSettings();
        }
        catch (Exception ex) { Log("LoadSettings: " + ex); }
    }

    public static void SaveSettings()
    {
        try { AtomicWrite(Path.Combine(Root, "settings.json"), JsonSerializer.Serialize(Settings, Opt)); }
        catch (Exception ex) { Log("SaveSettings: " + ex); }
    }

    public static void AddRecent(string path, string title, bool isNotebook)
    {
        var r = Settings.Recents;
        r.RemoveAll(x => string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase));
        r.Insert(0, new RecentItem { Path = path, Title = title, IsNotebook = isNotebook, LastOpened = DateTime.Now });
        if (r.Count > 30) r.RemoveRange(30, r.Count - 30);
        SaveSettings();
    }

    public static void RemoveRecent(string path)
    {
        Settings.Recents.RemoveAll(x => string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase));
        SaveSettings();
    }
}
