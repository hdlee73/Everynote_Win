using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace PdfNote;

public partial class App : Application
{
    const string RuntimeUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";   // Evergreen bootstrapper
    [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
    static Mutex mutex;
    static readonly string PipeName = "PDFNote-open-" + Environment.UserName;

    static List<string> FileArgs(IEnumerable<string> args)
    {
        var list = new List<string>();
        foreach (var a in args)
        {
            if (string.IsNullOrWhiteSpace(a) || a.StartsWith("--") || a.StartsWith("/")) continue;
            try { var f = Path.GetFullPath(a); if (File.Exists(f)) list.Add(f); } catch { }
        }
        return list;
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        // taskbar identity: matches the AppUserModelID of the installer's shortcuts so pinning/jump lists work
        try { SetCurrentProcessExplicitAppUserModelID("hdlee73.Everynote"); } catch { }
        AppPaths.EnsureDirs();
        DispatcherUnhandledException += (s, a) => { Log.Write("UI exception: " + a.Exception); a.Handled = true; };
        AppDomain.CurrentDomain.UnhandledException += (s, a) => Log.Write("Unhandled: " + a.ExceptionObject);
        TaskScheduler.UnobservedTaskException += (s, a) => { Log.Write("Unobserved task: " + a.Exception); a.SetObserved(); };

        var files = FileArgs(e.Args);
        mutex = new Mutex(true, @"Local\PDFNote-single-instance-v2", out bool first);
        if (!first)
        {
            SendToPrimary(files);
            Shutdown();
            return;
        }

        string rtVersion = null; Exception rtError = null;
        try { rtVersion = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
        catch (Exception ex) { rtError = ex; }
        if (string.IsNullOrEmpty(rtVersion))
        {
            ShowRuntimeMissing(rtError ?? new Exception("WebView2 runtime not found"));
            Shutdown();
            return;
        }
        Log.Write("start; WebView2 runtime " + rtVersion + "; args=" + string.Join(" | ", files));

        var w = new MainWindow(files);
        MainWindow = w;
        w.Show();
        StartPipeServer(w);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { mutex?.ReleaseMutex(); } catch { }
        base.OnExit(e);
    }

    internal static void ShowRuntimeMissing(Exception ex)
    {
        Log.Write("WebView2 runtime missing: " + ex.Message);
        var r = MessageBox.Show(
            "Everynote를 실행하려면 Microsoft Edge WebView2 런타임이 필요합니다.\n\n" +
            "[예]를 누르면 Microsoft 다운로드 페이지가 열립니다. 설치한 뒤 Everynote를 다시 실행하세요.\n\n" +
            "Everynote needs the Microsoft Edge WebView2 Evergreen Runtime. Click Yes to open the download page, install it, then start Everynote again.\n\n" + ex.Message,
            "Everynote", MessageBoxButton.YesNo, MessageBoxImage.Information);
        if (r == MessageBoxResult.Yes)
        {
            try { Process.Start(new ProcessStartInfo(RuntimeUrl) { UseShellExecute = true }); } catch { }
        }
    }

    // ------------------------------------------------------------------------------------------------- single instance
    static void SendToPrimary(List<string> files)
    {
        var payload = JsonSerializer.Serialize(files);
        for (int i = 0; i < 25; i++)
        {
            try
            {
                using var c = new NamedPipeClientStream(".", PipeName, PipeDirection.Out, PipeOptions.CurrentUserOnly);
                c.Connect(400);
                using var w = new StreamWriter(c, new System.Text.UTF8Encoding(false)) { AutoFlush = true };
                w.WriteLine(payload);
                return;
            }
            catch (Exception) { Thread.Sleep(200); }
        }
    }

    static void StartPipeServer(MainWindow w)
    {
        var t = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var s = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.CurrentUserOnly);
                    s.WaitForConnection();
                    using var r = new StreamReader(s, System.Text.Encoding.UTF8);
                    var line = r.ReadLine();
                    var files = new List<string>();
                    if (!string.IsNullOrEmpty(line))
                    {
                        using var d = JsonDocument.Parse(line);
                        foreach (var e in d.RootElement.EnumerateArray()) { var f = e.GetString(); if (!string.IsNullOrEmpty(f) && File.Exists(f)) files.Add(f); }
                    }
                    w.HandleExternalOpen(files);
                }
                catch (Exception ex) { Log.Write("pipe: " + ex.Message); Thread.Sleep(500); }
            }
        }) { IsBackground = true, Name = "single-instance-pipe" };
        t.Start();
    }
}
