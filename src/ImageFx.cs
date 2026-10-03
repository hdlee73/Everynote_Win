using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PdfNote;

public static class ImageFx
{
    /// <summary>Finds the bounding box of non-blank content, as a normalized rect (x,y,w,h in 0..1).</summary>
    public static RectD FindContentBounds(BitmapSource bmp)
    {
        try
        {
            double sc = Math.Min(1.0, 260.0 / bmp.PixelWidth);
            var scaled = new TransformedBitmap(bmp, new ScaleTransform(sc, sc));
            var gray = new FormatConvertedBitmap(scaled, PixelFormats.Gray8, null, 0);
            int w = gray.PixelWidth, h = gray.PixelHeight;
            var buf = new byte[w * h];
            gray.CopyPixels(buf, w, 0);
            int minX = w, minY = h, maxX = -1, maxY = -1;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                    if (buf[y * w + x] < 232)
                    {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
            if (maxX < 0) return new RectD(0, 0, 1, 1);
            double pad = 0.025;
            double x0 = Math.Max(0, (double)minX / w - pad), y0 = Math.Max(0, (double)minY / h - pad);
            double x1 = Math.Min(1, (double)(maxX + 1) / w + pad), y1 = Math.Min(1, (double)(maxY + 1) / h + pad);
            // do not crop tiny amounts (avoids needless layout jumps)
            if ((x1 - x0) > 0.94 && (y1 - y0) > 0.94) return new RectD(0, 0, 1, 1);
            return new RectD(x0, y0, x1 - x0, y1 - y0);
        }
        catch { return new RectD(0, 0, 1, 1); }
    }
}
