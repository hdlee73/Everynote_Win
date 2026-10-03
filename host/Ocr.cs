using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace PdfNote;

/// <summary>ocr.recognize: Windows.Media.Ocr on a PNG. Returns pixel boxes of the (original) image with a line index per word.</summary>
static class OcrService
{
    sealed record Result(List<object> Words, int Chars);

    static OcrEngine Pick(string lang)
    {
        if (!string.IsNullOrWhiteSpace(lang) && !lang.Equals("auto", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var l = new Language(lang.Trim());
                if (OcrEngine.IsLanguageSupported(l)) { var e = OcrEngine.TryCreateFromLanguage(l); if (e != null) return e; }
            }
            catch { }
        }
        return null;
    }

    static IEnumerable<OcrEngine> Engines(string lang)
    {
        var explicitEngine = Pick(lang);
        if (explicitEngine != null) { yield return explicitEngine; yield break; }
        var seen = new HashSet<string>();
        OcrEngine profile = null;
        try { profile = OcrEngine.TryCreateFromUserProfileLanguages(); } catch { }
        if (profile != null) { seen.Add(profile.RecognizerLanguage.LanguageTag.ToLowerInvariant()); yield return profile; }
        OcrEngine ko = null;
        try
        {
            var kl = OcrEngine.AvailableRecognizerLanguages.FirstOrDefault(x => x.LanguageTag.StartsWith("ko", StringComparison.OrdinalIgnoreCase));
            if (kl != null && !seen.Contains(kl.LanguageTag.ToLowerInvariant())) ko = OcrEngine.TryCreateFromLanguage(kl);
        }
        catch { }
        if (ko != null) yield return ko;
    }

    public static async Task<object> RecognizeAsync(string b64, string lang)
    {
        var bytes = Convert.FromBase64String(b64 ?? "");
        var engines = Engines(lang).ToList();
        if (engines.Count == 0) throw new InvalidOperationException("OCR 언어 팩이 설치되어 있지 않습니다. Windows 설정에서 언어를 추가하세요");

        using var ms = new InMemoryRandomAccessStream();
        using (var writer = new DataWriter(ms))
        {
            writer.WriteBytes(bytes);
            await writer.StoreAsync();
            await writer.FlushAsync();
            writer.DetachStream();
        }
        ms.Seek(0);
        var decoder = await BitmapDecoder.CreateAsync(ms);
        int ow = (int)decoder.PixelWidth, oh = (int)decoder.PixelHeight;
        int max = (int)OcrEngine.MaxImageDimension;
        double scale = 1;
        BitmapTransform tf = new();
        if (ow > max || oh > max)
        {
            scale = Math.Min((double)max / ow, (double)max / oh);
            tf.ScaledWidth = (uint)Math.Max(1, Math.Floor(ow * scale));
            tf.ScaledHeight = (uint)Math.Max(1, Math.Floor(oh * scale));
        }
        using var sb = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, tf,
            ExifOrientationMode.IgnoreExifOrientation, ColorManagementMode.DoNotColorManage);
        double fx = ow / (double)sb.PixelWidth, fy = oh / (double)sb.PixelHeight;

        Result best = null;
        foreach (var engine in engines)
        {
            var res = await engine.RecognizeAsync(sb);
            var words = new List<object>(); int chars = 0, li = 0;
            foreach (var line in res.Lines)
            {
                foreach (var w in line.Words)
                {
                    var r = w.BoundingRect;
                    words.Add(new { text = w.Text, x = r.X * fx, y = r.Y * fy, w = r.Width * fx, h = r.Height * fy, line = li });
                    chars += w.Text.Length;
                }
                li++;
            }
            if (best == null || chars > best.Chars) best = new Result(words, chars);
        }
        return new { width = ow, height = oh, words = best.Words };
    }
}
