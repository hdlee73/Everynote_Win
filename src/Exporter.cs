using System.IO;
using System.Globalization;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PdfNote;

public static class Exporter
{
    // ---------------- Flattened PDF (original page + ink + highlights + memos) ----------------

    static SolidColorBrush Brush(string hex, byte alpha)
    {
        var c = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
        var b = new SolidColorBrush(System.Windows.Media.Color.FromArgb(alpha, c.R, c.G, c.B));
        b.Freeze();
        return b;
    }

    static BitmapSource Flatten(BitmapSource page, double baseW, double baseH, int pageIndex, DocAnnotations ann, string key)
    {
        double s = page.PixelWidth / baseW;
        int pw = page.PixelWidth, ph = (int)Math.Round(baseH * s);
        var dv = new DrawingVisual();
        using (var dc = dv.RenderOpen())
        {
            dc.DrawImage(page, new Rect(0, 0, pw, ph));
            dc.PushTransform(new ScaleTransform(s, s));

            foreach (var h in ann.Highlights.Where(x => x.Page == pageIndex))
                foreach (var r in h.Rects)
                    dc.DrawRectangle(Brush(h.Color, 0x70), null, new Rect(r.X * baseW, r.Y * baseH, r.W * baseW, r.H * baseH));

            if (ann.Ink.TryGetValue(pageIndex, out var b64) && !string.IsNullOrEmpty(b64))
            {
                try { InkIo.FromB64(b64).Draw(dc); } catch { }
            }

            // links made from selected text: blue underline
            var linkPen = new Pen(Brush("#1565C0", 0xFF), 1.2);
            foreach (var l in ann.Links.Where(x => x.Page == pageIndex))
                foreach (var r in l.Rects)
                {
                    double y = (r.Y + r.H) * baseH - 1;
                    dc.DrawLine(linkPen, new System.Windows.Point(r.X * baseW, y), new System.Windows.Point((r.X + r.W) * baseW, y));
                }

            // page objects (text, images, stickers, shapes, tables, links)
            var objs = ann.Objects.Where(x => x.Page == pageIndex).ToList();
            if (objs.Count > 0)
            {
                var canvas = new System.Windows.Controls.Canvas { Width = baseW, Height = baseH };
                foreach (var o in objs)
                {
                    try
                    {
                        var el = ObjectViews.Build(o, baseW, baseH, key, false, null, null);
                        if (el == null) continue;
                        System.Windows.Controls.Canvas.SetLeft(el, o.X * baseW);
                        System.Windows.Controls.Canvas.SetTop(el, o.Y * baseH);
                        canvas.Children.Add(el);
                    }
                    catch { }
                }
                canvas.Measure(new Size(baseW, baseH));
                canvas.Arrange(new Rect(0, 0, baseW, baseH));
                canvas.UpdateLayout();
                dc.DrawRectangle(new VisualBrush(canvas), null, new Rect(0, 0, baseW, baseH));
            }

            var typeface = new Typeface(new System.Windows.Media.FontFamily("Malgun Gothic, Segoe UI"),
                FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
            foreach (var m in ann.Memos.Where(x => x.Page == pageIndex && !x.Minimized && !string.IsNullOrWhiteSpace(x.Text)))
            {
                double mw = MemoControl.WidthFor(m.Size);
                var ft = new FormattedText(m.Text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
                    typeface, m.FontSize > 0 ? m.FontSize : 13, Brushes.Black, 1.0)
                { MaxTextWidth = mw - 14, MaxTextHeight = 600 };
                double x = m.X * baseW, y = m.Y * baseH;
                dc.DrawRectangle(Brush(string.IsNullOrEmpty(m.Color) ? "#FFF59D" : m.Color, 0xF0),
                    new Pen(Brush("#C9B400", 0xFF), 1), new Rect(x, y, mw, ft.Height + 12));
                dc.DrawText(ft, new System.Windows.Point(x + 7, y + 6));
            }
            dc.Pop();
        }
        var rtb = new RenderTargetBitmap(pw, ph, 96, 96, PixelFormats.Pbgra32);
        rtb.Render(dv);
        rtb.Freeze();
        return rtb;
    }

    static void W(Stream s, string text)
    {
        var b = Encoding.ASCII.GetBytes(text);
        s.Write(b, 0, b.Length);
    }

    /// <summary>Writes a PDF where every page is a JPEG image of the annotated page. Must run on the UI thread.</summary>
    public static async Task ExportPdfAsync(IPageSource src, DocAnnotations ann, string outPath,
        int pixelWidth, Action<int> progress)
    {
        int n = src.PageCount;
        var offs = new long[3 + 3 * n];
        using var fs = File.Create(outPath);
        W(fs, "%PDF-1.4\n");
        fs.Write(new byte[] { (byte)'%', 0xE2, 0xE3, 0xCF, 0xD3, (byte)'\n' });

        offs[1] = fs.Position;
        W(fs, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

        var kids = new StringBuilder();
        for (int i = 0; i < n; i++) kids.Append($"{3 + 3 * i} 0 R ");
        offs[2] = fs.Position;
        W(fs, $"2 0 obj\n<< /Type /Pages /Kids [ {kids} ] /Count {n} >>\nendobj\n");

        for (int i = 0; i < n; i++)
        {
            progress?.Invoke(i + 1);
            var (bw, bh) = src.GetPageSize(i);
            var bmp = await src.RenderAsync(i, pixelWidth);
            var flat = Flatten(bmp, bw, bh, i, ann, src.Key);
            byte[] jpg;
            using (var ms = new MemoryStream())
            {
                var enc = new JpegBitmapEncoder { QualityLevel = 85 };
                enc.Frames.Add(BitmapFrame.Create(flat));
                enc.Save(ms);
                jpg = ms.ToArray();
            }
            int pageId = 3 + 3 * i, contentId = 4 + 3 * i, imgId = 5 + 3 * i;
            double ptW = bw * 0.75, ptH = bh * 0.75;
            string F(double d) => d.ToString("0.##", CultureInfo.InvariantCulture);

            offs[imgId] = fs.Position;
            W(fs, $"{imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width {flat.PixelWidth} /Height {flat.PixelHeight} " +
                  $"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {jpg.Length} >>\nstream\n");
            fs.Write(jpg, 0, jpg.Length);
            W(fs, "\nendstream\nendobj\n");

            string content = $"q {F(ptW)} 0 0 {F(ptH)} 0 0 cm /Im0 Do Q";
            offs[contentId] = fs.Position;
            W(fs, $"{contentId} 0 obj\n<< /Length {content.Length} >>\nstream\n{content}\nendstream\nendobj\n");

            offs[pageId] = fs.Position;
            W(fs, $"{pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {F(ptW)} {F(ptH)}] " +
                  $"/Resources << /XObject << /Im0 {imgId} 0 R >> >> /Contents {contentId} 0 R >>\nendobj\n");
        }

        long xref = fs.Position;
        int total = 3 + 3 * n;
        W(fs, $"xref\n0 {total}\n0000000000 65535 f \n");
        for (int id = 1; id < total; id++) W(fs, $"{offs[id]:D10} 00000 n \n");
        W(fs, $"trailer\n<< /Size {total} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n");
    }

    // ---------------- Text exports (Markdown / CSV / Anki TSV) ----------------

    public static string ToMarkdown(string title, DocAnnotations a)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# {title} — 노트·발췌");
        sb.AppendLine();
        if (a.Outline.Count > 0)
        {
            sb.AppendLine("## 개요");
            foreach (var o in a.Outline.OrderBy(x => x.Page).ThenBy(x => x.Y))
                sb.AppendLine($"- [p.{o.Page + 1}] {o.Title}");
            sb.AppendLine();
        }
        sb.AppendLine("## 하이라이트");
        foreach (var h in a.Highlights.OrderBy(x => x.Page))
        {
            sb.AppendLine($"- **[p.{h.Page + 1}]** {h.Text}");
            if (!string.IsNullOrWhiteSpace(h.Note))
                sb.AppendLine($"  - 메모: {h.Note.Replace("\n", " ")}");
        }
        sb.AppendLine();
        sb.AppendLine("## 메모");
        foreach (var m in a.Memos.OrderBy(x => x.Page).Where(x => !string.IsNullOrWhiteSpace(x.Text)))
            sb.AppendLine($"- **[p.{m.Page + 1}]** {m.Text.Replace("\n", " ")}");
        var typed = a.Objects.Where(x => x.Type == "text" && !string.IsNullOrWhiteSpace(x.Text)).OrderBy(x => x.Page).ToList();
        if (typed.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine("## 입력한 글");
            foreach (var t in typed) sb.AppendLine($"- **[p.{t.Page + 1}]** {t.Text.Replace("\n", " ")}");
        }
        return sb.ToString();
    }

    static string Csv(string s)
    {
        s ??= "";
        return "\"" + s.Replace("\"", "\"\"") + "\"";
    }

    public static string ToCsv(DocAnnotations a)
    {
        var sb = new StringBuilder();
        sb.AppendLine("page,type,text,note");
        foreach (var h in a.Highlights.OrderBy(x => x.Page))
            sb.AppendLine($"{h.Page + 1},highlight,{Csv(h.Text)},{Csv(h.Note)}");
        foreach (var m in a.Memos.OrderBy(x => x.Page))
            sb.AppendLine($"{m.Page + 1},memo,{Csv(m.Text)},");
        foreach (var t in a.Objects.Where(x => x.Type == "text").OrderBy(x => x.Page))
            sb.AppendLine($"{t.Page + 1},text,{Csv(t.Text)},");
        return sb.ToString();
    }

    static string Tsv(string s) => (s ?? "").Replace("\t", " ").Replace("\r", "").Replace("\n", "<br>");

    /// <summary>Anki import: front = excerpt, back = note + document + page.</summary>
    public static string ToAnkiTsv(string title, DocAnnotations a)
    {
        var sb = new StringBuilder();
        foreach (var h in a.Highlights.OrderBy(x => x.Page))
        {
            string back = (string.IsNullOrWhiteSpace(h.Note) ? "" : h.Note + "<br>") + $"{title} · p.{h.Page + 1}";
            sb.AppendLine($"{Tsv(h.Text)}\t{Tsv(back)}");
        }
        return sb.ToString();
    }
}
