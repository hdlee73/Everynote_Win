using System.Diagnostics;
using System.Reflection;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace PdfNote;

/// <summary>doc/docx/ppt/pptx/xls/xlsx -> PDF. Microsoft Office via late-bound COM, else LibreOffice headless, else an error.</summary>
static class OfficeConverter
{
    public const string NoEngine = "LibreOffice 또는 Microsoft Office가 설치되어 있지 않습니다";
    public const string StagePrepare = "문서를 준비하고 있습니다";
    public const string StageConvert = "원본 서식을 PDF로 변환하는 중";
    static readonly TimeSpan Timeout = TimeSpan.FromMinutes(10);

    // ---------------------------------------------------------------- detection
    static bool ProgId(string progId)
    {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var root = RegistryKey.OpenBaseKey(RegistryHive.ClassesRoot, view);
                using var k = root.OpenSubKey(progId + "\\CLSID");
                if (k != null) return true;
            }
            catch { }
        }
        return false;
    }

    public static string FindSoffice()
    {
        var cands = new List<string>();
        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
            {
                try
                {
                    using var b = RegistryKey.OpenBaseKey(hive, view);
                    using var k = b.OpenSubKey(@"SOFTWARE\LibreOffice\UNO\InstallPath");
                    var v = k?.GetValue(null) as string;
                    if (!string.IsNullOrEmpty(v)) cands.Add(Path.Combine(v, "soffice.exe"));
                }
                catch { }
            }
        foreach (var pf in new[] { Environment.GetEnvironmentVariable("ProgramFiles"), Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
                                   Environment.GetEnvironmentVariable("ProgramW6432"), @"C:\Program Files", @"C:\Program Files (x86)" })
            if (!string.IsNullOrEmpty(pf)) cands.Add(Path.Combine(pf, "LibreOffice", "program", "soffice.exe"));
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var d in path.Split(';', StringSplitOptions.RemoveEmptyEntries))
            try { cands.Add(Path.Combine(d.Trim().Trim('"'), "soffice.exe")); } catch { }
        foreach (var c in cands) { try { if (File.Exists(c)) return c; } catch { } }
        return null;
    }

    static (bool word, bool excel, bool ppt, string lo) Detect() => (ProgId("Word.Application"), ProgId("Excel.Application"), ProgId("PowerPoint.Application"), FindSoffice());

    public static object Engines() { var d = Detect(); return new { word = d.word, excel = d.excel, powerpoint = d.ppt, libreoffice = d.lo }; }

    // ---------------------------------------------------------------- conversion
    static string Family(string ext) => ext switch
    {
        "doc" or "docx" or "rtf" or "odt" => "word",
        "ppt" or "pptx" or "pps" or "ppsx" or "odp" => "ppt",
        "xls" or "xlsx" or "xlsm" or "ods" or "csv" => "excel",
        _ => null,
    };

    public static async Task<string> ConvertAsync(string id, string srcPath, string kind, Action<string> progress, CancellationToken outer)
    {
        var src = PathPolicy.ReadPath(srcPath);
        if (!File.Exists(src)) throw new FileNotFoundException("문서를 읽을 수 없습니다");
        var ext = (kind ?? "").Trim().TrimStart('.').ToLowerInvariant();
        if (Family(ext) == null) ext = Path.GetExtension(src).TrimStart('.').ToLowerInvariant();
        var fam = Family(ext) ?? throw new NotSupportedException("지원하지 않는 문서 형식입니다");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(outer);
        cts.CancelAfter(Timeout);
        var ct = cts.Token;
        var guid = Guid.NewGuid().ToString("N");
        Directory.CreateDirectory(AppPaths.Temp);
        var work = Path.Combine(AppPaths.Temp, "office-" + guid);
        var output = Path.Combine(AppPaths.Temp, "office-result-" + guid + ".pdf");
        Directory.CreateDirectory(work);
        try
        {
            progress(StagePrepare);
            var input = Path.Combine(work, "src." + ext);
            await Task.Run(() => File.Copy(src, input, true), ct);
            if (ext == "xlsx") await Task.Run(() => SpreadsheetPrep.PrepareXlsx(input), ct);
            ct.ThrowIfCancellationRequested();
            progress(StageConvert);

            var eng = Detect();
            bool haveOffice = fam == "word" ? eng.word : fam == "ppt" ? eng.ppt : eng.excel;
            string soffice = eng.lo;
            if (!haveOffice && soffice == null) throw new InvalidOperationException(NoEngine);

            Exception first = null;
            if (haveOffice)
            {
                try
                {
                    await ComConvertAsync(fam, ext, input, output, ct);
                    if (Ok(output)) return output;
                    throw new IOException("PDF 변환 결과가 비어 있습니다");
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception ex)
                {
                    Log.Write("COM convert failed (" + fam + "): " + ex);
                    first = ex;
                    try { File.Delete(output); } catch { }
                    if (soffice == null) throw new IOException(Describe(ex), ex);
                }
            }
            try
            {
                await LibreOfficeAsync(soffice, input, work, ct);
                var produced = Path.Combine(work, "src.pdf");
                if (!Ok(produced)) throw new IOException("PDF 변환 결과가 비어 있습니다");
                File.Move(produced, output, true);
                return output;
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                Log.Write("LibreOffice convert failed: " + ex);
                throw new IOException(first != null ? Describe(first) + " / LibreOffice: " + Describe(ex) : Describe(ex), ex);
            }
        }
        catch
        {
            try { File.Delete(output); } catch { }
            throw;
        }
        finally
        {
            try { Directory.Delete(work, true); } catch { }
        }
    }

    static bool Ok(string p) { try { var f = new FileInfo(p); return f.Exists && f.Length > 0; } catch { return false; } }

    static string Describe(Exception e)
    {
        while (e is TargetInvocationException || (e is AggregateException ag && ag.InnerException != null)) e = e.InnerException;
        var m = e.Message?.Trim();
        return string.IsNullOrEmpty(m) ? e.GetType().Name : m;
    }

    // ---------------------------------------------------------------- LibreOffice
    static async Task LibreOfficeAsync(string soffice, string input, string outDir, CancellationToken ct)
    {
        var profile = Path.Combine(AppPaths.Data, "lo-profile");
        Directory.CreateDirectory(profile);
        var psi = new ProcessStartInfo(soffice)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = outDir,
        };
        psi.ArgumentList.Add("-env:UserInstallation=" + new Uri(profile).AbsoluteUri);
        foreach (var a in new[] { "--headless", "--invisible", "--norestore", "--nolockcheck", "--nologo", "--convert-to", "pdf", "--outdir", outDir, input })
            psi.ArgumentList.Add(a);
        using var p = new Process { StartInfo = psi };
        var log = new StringBuilder();
        p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
        p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (log) log.AppendLine(e.Data); };
        p.Start();
        p.BeginOutputReadLine(); p.BeginErrorReadLine();
        try { await p.WaitForExitAsync(ct); }
        catch (OperationCanceledException)
        {
            try { p.Kill(true); } catch { }
            throw;
        }
        string tail; lock (log) tail = log.ToString().Trim();
        Log.Write("soffice exit " + p.ExitCode + " " + tail);
        if (p.ExitCode != 0) throw new IOException("LibreOffice 변환 실패 (" + p.ExitCode + ")" + (tail.Length > 0 ? ": " + tail.Substring(0, Math.Min(300, tail.Length)) : ""));
    }

    // ---------------------------------------------------------------- Microsoft Office (late-bound COM)
    static readonly string[] OfficeProcs = { "WINWORD", "EXCEL", "POWERPNT" };

    static HashSet<int> Pids() { var s = new HashSet<int>(); foreach (var n in OfficeProcs) foreach (var p in Process.GetProcessesByName(n)) { s.Add(p.Id); p.Dispose(); } return s; }

    static Task ComConvertAsync(string fam, string ext, string input, string output, CancellationToken ct)
    {
        var before = Pids();
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var t = new Thread(() =>
        {
            try
            {
                switch (fam)
                {
                    case "word": WordToPdf(input, output); break;
                    case "ppt": PowerPointToPdf(input, output); break;
                    default: ExcelToPdf(input, output, ext); break;
                }
                tcs.TrySetResult();
            }
            catch (Exception ex) { tcs.TrySetException(ex); }
        }) { IsBackground = true, Name = "office-com" };
        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        ct.Register(() =>
        {
            // best effort: the COM call cannot be interrupted, so kill Office processes that we started
            try
            {
                foreach (var n in OfficeProcs)
                    foreach (var p in Process.GetProcessesByName(n))
                    {
                        if (!before.Contains(p.Id)) { try { p.Kill(true); } catch { } }
                        p.Dispose();
                    }
            }
            catch { }
            tcs.TrySetCanceled(ct);
        });
        return tcs.Task;
    }

    static void Rel(object o) { try { if (o != null && Marshal.IsComObject(o)) Marshal.FinalReleaseComObject(o); } catch { } }

    static dynamic Create(string progId)
    {
        var t = Type.GetTypeFromProgID(progId) ?? throw new InvalidOperationException(progId + " 을(를) 찾을 수 없습니다");
        return Activator.CreateInstance(t);
    }

    static void WordToPdf(string src, string dst)
    {
        dynamic app = null, doc = null;
        try
        {
            app = Create("Word.Application");
            try { app.Visible = false; } catch { }
            try { app.DisplayAlerts = 0; } catch { }
            try { app.AutomationSecurity = 3; } catch { }
            doc = app.Documents.Open(FileName: src, ConfirmConversions: false, ReadOnly: true, AddToRecentFiles: false, Visible: false);
            try { doc.ExportAsFixedFormat(dst, 17); }
            catch { doc.SaveAs2(dst, 17); }
        }
        finally
        {
            try { if (doc != null) doc.Close(0); } catch { }
            try { if (app != null && (int)app.Documents.Count == 0) app.Quit(0); } catch { }
            Rel(doc); Rel(app);
        }
    }

    static void PowerPointToPdf(string src, string dst)
    {
        dynamic app = null, pres = null;
        try
        {
            app = Create("PowerPoint.Application");
            try { app.AutomationSecurity = 3; } catch { }
            pres = app.Presentations.Open(src, -1, 0, 0);   // ReadOnly, Untitled, WithWindow = msoFalse
            try { pres.SaveAs(dst, 32); }                   // ppSaveAsPDF
            catch { pres.ExportAsFixedFormat(dst, 2); }     // ppFixedFormatTypePDF
        }
        finally
        {
            try { if (pres != null) pres.Close(); } catch { }
            try { if (app != null && (int)app.Presentations.Count == 0) app.Quit(); } catch { }
            Rel(pres); Rel(app);
        }
    }

    static void ExcelToPdf(string src, string dst, string ext)
    {
        dynamic app = null, wb = null;
        try
        {
            app = Create("Excel.Application");
            try { app.Visible = false; } catch { }
            try { app.DisplayAlerts = false; } catch { }
            try { app.ScreenUpdating = false; } catch { }
            try { app.EnableEvents = false; } catch { }
            try { app.AutomationSecurity = 3; } catch { }
            wb = app.Workbooks.Open(src, 0, true);          // UpdateLinks=0, ReadOnly
            foreach (dynamic ws in wb.Worksheets)
            {
                // like Android SpreadsheetImport: no gridlines, no borders (.xlsx borders were already stripped), fit to one page wide
                if (ext != "xlsx") { try { ws.UsedRange.Borders.LineStyle = -4142; } catch { } }   // xlNone
                try { dynamic ps = ws.PageSetup; try { ps.PrintGridlines = false; } catch { } try { ps.Zoom = false; } catch { }
                      try { ps.FitToPagesWide = 1; } catch { } try { ps.FitToPagesTall = false; } catch { } Rel(ps); } catch { }
                Rel(ws);
            }
            wb.ExportAsFixedFormat(Type: 0, Filename: dst, Quality: 0, IncludeDocProperties: true, IgnorePrintAreas: false, OpenAfterPublish: false);
        }
        finally
        {
            try { if (wb != null) wb.Close(false); } catch { }
            try { if (app != null && (int)app.Workbooks.Count == 0) app.Quit(); } catch { }
            Rel(wb); Rel(app);
        }
    }
}
