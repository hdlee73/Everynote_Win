using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

namespace PdfNote;

/// <summary>Port of Android SpreadsheetImport: removes cell borders / gridlines in a TEMP copy of an .xlsx so converted sheets look clean.</summary>
static class SpreadsheetPrep
{
    const long MaxTotal = 256L * 1024 * 1024, MaxXml = 32L * 1024 * 1024;
    static readonly Regex SheetName = new(@"^xl/worksheets/sheet[0-9]+\.xml$", RegexOptions.Compiled);
    static readonly string[] Later = { "pageMargins", "pageSetup", "headerFooter", "rowBreaks", "colBreaks", "customProperties", "cellWatches",
        "ignoredErrors", "smartTags", "drawing", "legacyDrawing", "legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst" };

    public static void PrepareXlsx(string file)
    {
        var prepared = file + ".prepared";
        try
        {
            using (var inZ = ZipFile.OpenRead(file))
            using (var fs = File.Create(prepared))
            using (var outZ = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                long total = 0;
                foreach (var e in inZ.Entries)
                {
                    var ne = outZ.CreateEntry(e.FullName, CompressionLevel.Fastest);
                    try { ne.LastWriteTime = e.LastWriteTime; } catch { }
                    if (e.FullName.EndsWith("/")) continue;
                    bool isStyles = e.FullName == "xl/styles.xml";
                    bool transform = isStyles || SheetName.IsMatch(e.FullName);
                    using var input = e.Open();
                    using var output = ne.Open();
                    var buf = new byte[65536];
                    var xml = transform ? new MemoryStream() : null;
                    int n;
                    while ((n = input.Read(buf, 0, buf.Length)) > 0)
                    {
                        total += n;
                        if (total > MaxTotal || (xml != null && xml.Length + n > MaxXml)) throw new IOException("엑셀 내용이 너무 큽니다");
                        if (xml != null) xml.Write(buf, 0, n); else output.Write(buf, 0, n);
                    }
                    if (xml != null)
                    {
                        var cleaned = CleanXml(xml.ToArray(), isStyles);
                        output.Write(cleaned, 0, cleaned.Length);
                    }
                }
            }
            File.Copy(prepared, file, true);
        }
        catch (Exception ex)
        {
            throw new IOException("엑셀 격자선 정리 실패: " + ex.Message, ex);
        }
        finally { try { File.Delete(prepared); } catch { } }
    }

    static byte[] CleanXml(byte[] bytes, bool styles)
    {
        if (Encoding.UTF8.GetString(bytes).Replace("\0", "").ToUpperInvariant().Contains("<!DOCTYPE"))
            throw new IOException("지원하지 않는 XML 선언");
        var doc = new XmlDocument { PreserveWhitespace = true, XmlResolver = null };
        var rs = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using (var r = XmlReader.Create(new MemoryStream(bytes), rs)) doc.Load(r);
        var root = doc.DocumentElement;
        if (styles)
        {
            foreach (var node in doc.GetElementsByTagName("*").Cast<XmlNode>().Where(x => x.LocalName == "border").ToList())
                while (node.HasChildNodes) node.RemoveChild(node.FirstChild);
        }
        else
        {
            foreach (var v in doc.GetElementsByTagName("*").Cast<XmlNode>().Where(x => x.LocalName == "sheetView").ToList())
                ((XmlElement)v).SetAttribute("showGridLines", "0");
            var print = doc.GetElementsByTagName("*").Cast<XmlNode>().FirstOrDefault(x => x.LocalName == "printOptions") as XmlElement;
            if (print == null)
            {
                var prefix = root.Prefix;
                print = doc.CreateElement(string.IsNullOrEmpty(prefix) ? "printOptions" : prefix + ":printOptions", root.NamespaceURI);
                XmlNode before = null;
                foreach (XmlNode c in root.ChildNodes)
                    if (c.NodeType == XmlNodeType.Element && Array.IndexOf(Later, c.LocalName) >= 0) { before = c; break; }
                root.InsertBefore(print, before);
            }
            print.SetAttribute("gridLines", "0");
            print.SetAttribute("gridLinesSet", "1");
        }
        using var ms = new MemoryStream();
        using (var w = XmlWriter.Create(ms, new XmlWriterSettings { Encoding = new UTF8Encoding(false) })) doc.Save(w);
        return ms.ToArray();
    }
}
