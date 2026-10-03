using System.Windows;

namespace PdfNote;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Store.LoadSettings();
        DispatcherUnhandledException += (s, a) =>
        {
            Store.Log(a.Exception.ToString());
            MessageBox.Show("예기치 않은 오류가 발생했습니다.\n\n" + a.Exception.Message +
                            "\n\n작업 중인 주석은 자동 저장됩니다.", "PDF Note", MessageBoxButton.OK, MessageBoxImage.Warning);
            a.Handled = true;
        };
        var w = new MainWindow(e.Args);
        MainWindow = w;
        w.Show();
    }
}
