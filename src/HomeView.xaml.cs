using System.IO;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PdfNote;

public class DocRow
{
    public string Title { get; set; }
    public string Sub { get; set; }
    public string Path { get; set; }
}

public partial class HomeView : UserControl
{
    public event Action<string> OpenRequested;
    public event Action OpenDialogRequested;
    public event Action NewNoteRequested;

    public HomeView()
    {
        InitializeComponent();
        Refresh();
    }

    public void Refresh()
    {
        var recents = Store.Settings.Recents.Where(r => File.Exists(r.Path)).Select(r => new DocRow
        {
            Title = (r.IsNotebook ? "📓 " : "📄 ") + r.Title,
            Sub = r.LastOpened.ToString("yyyy-MM-dd HH:mm") + "  ·  " + r.Path,
            Path = r.Path
        }).ToList();
        RecentList.ItemsSource = recents;
        RecentEmpty.Visibility = recents.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        var lib = new List<DocRow>();
        try
        {
            lib = Directory.EnumerateFiles(Store.LibraryDir, "*.*", SearchOption.AllDirectories)
                .Where(f => f.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
                            f.EndsWith(".pnote", StringComparison.OrdinalIgnoreCase))
                .Select(f => new FileInfo(f))
                .OrderByDescending(f => f.LastWriteTime)
                .Take(200)
                .Select(f => new DocRow
                {
                    Title = (f.Extension.Equals(".pnote", StringComparison.OrdinalIgnoreCase) ? "📓 " : "📄 ") +
                            System.IO.Path.GetFileNameWithoutExtension(f.Name),
                    Sub = f.LastWriteTime.ToString("yyyy-MM-dd HH:mm") + "  ·  " + f.DirectoryName,
                    Path = f.FullName
                }).ToList();
        }
        catch (Exception ex) { Store.Log("library scan: " + ex.Message); }
        LibList.ItemsSource = lib;
        LibEmpty.Visibility = lib.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    void Open_Click(object s, RoutedEventArgs e) => OpenDialogRequested?.Invoke();
    void New_Click(object s, RoutedEventArgs e) => NewNoteRequested?.Invoke();
    void Library_Click(object s, RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo(Store.LibraryDir) { UseShellExecute = true });

    void List_DoubleClick(object s, MouseButtonEventArgs e)
    {
        if (s is ListBox lb && lb.SelectedItem is DocRow r) OpenRequested?.Invoke(r.Path);
    }

    void List_KeyDown(object s, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && s is ListBox lb && lb.SelectedItem is DocRow r) OpenRequested?.Invoke(r.Path);
    }

    void RemoveRecent_Click(object s, RoutedEventArgs e)
    {
        if (RecentList.SelectedItem is not DocRow r) return;
        Store.RemoveRecent(r.Path);
        Refresh();
    }

    void Reveal_Click(object s, RoutedEventArgs e)
    {
        if (RecentList.SelectedItem is not DocRow r) return;
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{r.Path}\"") { UseShellExecute = true });
    }
}
