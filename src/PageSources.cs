using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using Windows.Storage.Streams;
using Pig = UglyToad.PdfPig;
using WinImaging = Windows.Graphics.Imaging;
using WinPdf = Windows.Data.Pdf;

namespace PdfNote;

/// <summary>A paged document: a real PDF or a blank notebook.</summary>
public interface IPageSource : IDisposable
{
    int PageCount { get; }
    string Key { get; }
    string Title { get; }
    bool IsNotebook { get; }
    (double w, double h) GetPageSize(int index);
    Task<BitmapSource> RenderAsync(int index, int pixelWidth);
    Task<List<WordBox>> GetWordsAsync(int index, bool allowOcr);
    Task<List<OutlineEntry>> GetOutlineAsync();
}

public sealed class PdfPageSource : IPageSource
{
    readonly WinPdf.PdfDocument _doc;
    readonly string _path;
    Pig.PdfDocument _pig;
    readonly object _lock = new();
    readonly Dictionary<int, (double, double)> _sizes = new();

    PdfPageSource(WinPdf.PdfDocument doc, string path)
    {
        _doc = doc;
        _path = path;
        Key = Store.Fingerprint(path);
    }

    public static async Task<PdfPageSource> OpenAsync(string path)
    {
        var file = await StorageFile.GetFileFromPathAsync(path);
        var doc = await WinPdf.PdfDocument.LoadFromFileAsync(file);
        return new PdfPageSource(doc, path);
    }

    public int PageCount => (int)_doc.PageCount;
    public string Key { get; }
    public string Title => Path.GetFileNameWithoutExtension(_path);
    public bool IsNotebook => false;

    public (double w, double h) GetPageSize(int index)
    {
        lock (_sizes)
        {
            if (_sizes.TryGetValue(index, out var s)) return s;
        }
        using var p = _doc.GetPage((uint)index);
        var r = (p.Size.Width, p.Size.Height);
        lock (_sizes) _sizes[index] = r;
        return r;
    }

    static async Task<byte[]> ToBytes(InMemoryRandomAccessStream ms)
    {
        var size = (uint)ms.Size;
        using var reader = new DataReader(ms.GetInputStreamAt(0));
        await reader.LoadAsync(size);
        var bytes = new byte[size];
        reader.ReadBytes(bytes);
        return bytes;
    }

    async Task<byte[]> RenderPngAsync(int index, int pixelWidth)
    {
        using var page = _doc.GetPage((uint)index);
        double ratio = page.Size.Height / page.Size.Width;
        var opts = new WinPdf.PdfPageRenderOptions
        {
            DestinationWidth = (uint)pixelWidth,
            DestinationHeight = (uint)Math.Max(1, Math.Round(pixelWidth * ratio)),
            BackgroundColor = Windows.UI.Color.FromArgb(255, 255, 255, 255)
        };
        using var ms = new InMemoryRandomAccessStream();
        await page.RenderToStreamAsync(ms, opts);
        return await ToBytes(ms);
    }

    public async Task<BitmapSource> RenderAsync(int index, int pixelWidth)
    {
        var bytes = await Task.Run(() => RenderPngAsync(index, pixelWidth));
        var bmp = new BitmapImage();
        bmp.BeginInit();
        bmp.CacheOption = BitmapCacheOption.OnLoad;
        bmp.StreamSource = new MemoryStream(bytes);
        bmp.EndInit();
        bmp.Freeze();
        return bmp;
    }

    // ---- text layer (PdfPig) with OCR fallback for scanned pages ----

    void EnsurePig()
    {
        _pig ??= Pig.PdfDocument.Open(_path, new Pig.ParsingOptions { UseLenientParsing = true });
    }

    List<WordBox> ExtractText(int index)
    {
        lock (_lock)
        {
            try
            {
                EnsurePig();
                var page = _pig.GetPage(index + 1);
                // Rotated pages: PdfPig coordinates would not match the rendered bitmap -> use OCR instead.
                var rotDigits = new string(page.Rotation.ToString().Where(char.IsDigit).ToArray());
                if (rotDigits.Length > 0 && int.Parse(rotDigits) % 360 != 0) return new List<WordBox>();

                var cb = page.CropBox.Bounds;
                double w = cb.Width, h = cb.Height;
                if (w <= 0 || h <= 0) return new List<WordBox>();
                var list = new List<WordBox>();
                foreach (var wd in page.GetWords())
                {
                    if (string.IsNullOrWhiteSpace(wd.Text)) continue;
                    var b = wd.BoundingBox;
                    double x = (b.Left - cb.Left) / w;
                    double y = 1 - (b.Top - cb.Bottom) / h;
                    list.Add(new WordBox(wd.Text, x, y, b.Width / w, b.Height / h));
                }
                return list;
            }
            catch (Exception ex)
            {
                Store.Log("ExtractText p" + index + ": " + ex.Message);
                return new List<WordBox>();
            }
        }
    }

    async Task<List<WordBox>> OcrWordsAsync(int index)
    {
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine == null) return new List<WordBox>();
        int pw = (int)Math.Min(OcrEngine.MaxImageDimension, 2000);
        var bytes = await RenderPngAsync(index, pw);
        using var ms = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(ms.GetOutputStreamAt(0)))
        {
            writer.WriteBytes(bytes);
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }
        ms.Seek(0);
        var decoder = await WinImaging.BitmapDecoder.CreateAsync(ms);
        using var sb = await decoder.GetSoftwareBitmapAsync(
            WinImaging.BitmapPixelFormat.Bgra8, WinImaging.BitmapAlphaMode.Premultiplied);
        var res = await engine.RecognizeAsync(sb);
        double iw = sb.PixelWidth, ih = sb.PixelHeight;
        var list = new List<WordBox>();
        foreach (var line in res.Lines)
            foreach (var w in line.Words)
            {
                var r = w.BoundingRect;
                list.Add(new WordBox(w.Text, r.X / iw, r.Y / ih, r.Width / iw, r.Height / ih));
            }
        return list;
    }

    public async Task<List<WordBox>> GetWordsAsync(int index, bool allowOcr)
    {
        var words = await Task.Run(() => ExtractText(index));
        if (words.Count == 0 && allowOcr)
        {
            try { words = await OcrWordsAsync(index); }
            catch (Exception ex) { Store.Log("OCR p" + index + ": " + ex.Message); words = new List<WordBox>(); }
        }
        return words;
    }

    public Task<List<OutlineEntry>> GetOutlineAsync() => Task.Run(() =>
    {
        var list = new List<OutlineEntry>();
        lock (_lock)
        {
            try
            {
                EnsurePig();
                if (_pig.TryGetBookmarks(out var bm))
                {
                    void Walk(IEnumerable<Pig.Outline.BookmarkNode> nodes, int level)
                    {
                        foreach (var n in nodes)
                        {
                            int pg = -1;
                            if (n is Pig.Outline.DocumentBookmarkNode d) pg = d.PageNumber - 1;
                            list.Add(new OutlineEntry { Title = n.Title, Page = pg, Level = level });
                            Walk(n.Children, level + 1);
                        }
                    }
                    Walk(bm.Roots, 0);
                }
            }
            catch (Exception ex) { Store.Log("Outline: " + ex.Message); }
        }
        return list;
    });

    public void Dispose()
    {
        lock (_lock) { _pig?.Dispose(); _pig = null; }
    }
}

/// <summary>Blank / lined / grid notebook with an unlimited number of pages (A4).</summary>
public sealed class NotebookSource : IPageSource
{
    public const double W = 794, H = 1123;
    readonly string _file;
    public NotebookMeta Meta { get; }

    public NotebookSource(string file, NotebookMeta meta) { _file = file; Meta = meta; }

    public static NotebookSource Open(string file)
    {
        var meta = JsonSerializer.Deserialize<NotebookMeta>(File.ReadAllText(file),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (meta == null || string.IsNullOrEmpty(meta.Id)) throw new InvalidDataException("잘못된 노트 파일입니다.");
        if (meta.Pages < 1) meta.Pages = 1;
        return new NotebookSource(file, meta);
    }

    public static NotebookSource Create(string folder, NotebookMeta meta)
    {
        Directory.CreateDirectory(folder);
        string safe = string.Concat(meta.Title.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c)).Trim();
        if (safe.Length == 0) safe = "노트";
        string file = Path.Combine(folder, safe + ".pnote");
        int n = 2;
        while (File.Exists(file)) file = Path.Combine(folder, $"{safe} ({n++}).pnote");
        var nb = new NotebookSource(file, meta);
        nb.Save();
        return nb;
    }

    public string FilePath => _file;
    public void Save() => File.WriteAllText(_file, JsonSerializer.Serialize(Meta));
    public void AddPage() { Meta.Pages++; Save(); }

    public int PageCount => Meta.Pages;
    public string Key => Meta.Id;
    public string Title => Meta.Title;
    public bool IsNotebook => true;
    public (double w, double h) GetPageSize(int index) => (W, H);

    public Task<BitmapSource> RenderAsync(int index, int pixelWidth)
    {
        double s = pixelWidth / W;
        int ph = (int)Math.Round(H * s);
        var bg = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(Meta.Color);
        var dv = new DrawingVisual();
        using (var dc = dv.RenderOpen())
        {
            dc.PushTransform(new ScaleTransform(s, s));
            dc.DrawRectangle(new SolidColorBrush(bg), null, new Rect(0, 0, W, H));
            var pen = new Pen(new SolidColorBrush(System.Windows.Media.Color.FromArgb(110, 110, 130, 160)), 0.8);
            if (Meta.Paper == "lined")
            {
                for (double y = 84; y < H - 30; y += 30)
                    dc.DrawLine(pen, new System.Windows.Point(36, y), new System.Windows.Point(W - 36, y));
            }
            else if (Meta.Paper == "grid")
            {
                for (double x = 28; x < W; x += 28)
                    dc.DrawLine(pen, new System.Windows.Point(x, 0), new System.Windows.Point(x, H));
                for (double y = 28; y < H; y += 28)
                    dc.DrawLine(pen, new System.Windows.Point(0, y), new System.Windows.Point(W, y));
            }
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(pixelWidth, ph, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(dv);
        rtb.Freeze();
        return Task.FromResult<BitmapSource>(rtb);
    }

    public Task<List<WordBox>> GetWordsAsync(int index, bool allowOcr) => Task.FromResult(new List<WordBox>());
    public Task<List<OutlineEntry>> GetOutlineAsync() => Task.FromResult(new List<OutlineEntry>());
    public void Dispose() { }
}
