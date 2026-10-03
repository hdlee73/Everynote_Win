using System.IO;
using System.Diagnostics;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;

namespace PdfNote;

public class DocRow
{
    public string Title { get; set; }
    public string Sub { get; set; }
    public string Path { get; set; }
    public bool IsFolder { get; set; }
}

public partial class HomeView : UserControl
{
    public event Action<string> OpenRequested;
    public event Action OpenDialogRequested;
    public event Action NewNoteRequested;

    string _filter = "all";
    string _folder;

    public HomeView()
    {
        InitializeComponent();
        Refresh();
    }

    static bool IsDoc(string f) =>
        f.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".pnote", StringComparison.OrdinalIgnoreCase);

    static string Icon(string path) =>
        path.EndsWith(".pnote", StringComparison.OrdinalIgnoreCase) ? "📓 " : "📄 ";

    DocRow FileRow(string path, bool showFolder)
    {
        var fi = new FileInfo(path);
        string star = Store.IsFavorite(path) ? "★ " : "";
        return new DocRow
        {
            Title = star + Icon(path) + System.IO.Path.GetFileNameWithoutExtension(path),
            Sub = fi.LastWriteTime.ToString("yyyy-MM-dd HH:mm") + (showFolder ? "  ·  " + fi.DirectoryName : ""),
            Path = path
        };
    }

    public void Refresh()
    {
        string lib = Store.LibraryDir;
        string trash = Store.TrashDir;
        if (string.IsNullOrEmpty(_folder) || !Directory.Exists(_folder)) _folder = lib;
        string q = (SearchBox?.Text ?? "").Trim();
        var rows = new List<DocRow>();
        string empty = "";
        UpBtn.Visibility = Visibility.Collapsed;
        EmptyTrashBtn.Visibility = Visibility.Collapsed;
        PathText.Text = "";

        try
        {
            switch (_filter)
            {
                case "fav":
                    rows = Store.Settings.Favorites.Where(File.Exists).Select(p => FileRow(p, true)).ToList();
                    empty = "즐겨찾기한 문서가 없습니다. 목록에서 우클릭 → 즐겨찾기.";
                    break;
                case "recent":
                    rows = Store.Settings.Recents.Where(r => File.Exists(r.Path)).Select(r => new DocRow
                    {
                        Title = (Store.IsFavorite(r.Path) ? "★ " : "") + (r.IsNotebook ? "📓 " : "📄 ") + r.Title,
                        Sub = r.LastOpened.ToString("yyyy-MM-dd HH:mm") + "  ·  " + r.Path,
                        Path = r.Path
                    }).ToList();
                    empty = "아직 연 문서가 없습니다. PDF를 끌어다 놓아도 열립니다.";
                    break;
                case "trash":
                    rows = Directory.EnumerateFiles(trash).Where(IsDoc).Select(f => new FileInfo(f))
                        .OrderByDescending(f => f.LastWriteTime).Select(f => FileRow(f.FullName, false)).ToList();
                    empty = "휴지통이 비어 있습니다.";
                    EmptyTrashBtn.Visibility = rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                    PathText.Text = "삭제한 문서는 여기에 보관됩니다. 우클릭 → 복원.";
                    break;
                default:
                    if (q.Length > 0)
                    {
                        rows = Directory.EnumerateFiles(lib, "*.*", SearchOption.AllDirectories)
                            .Where(f => IsDoc(f) && !f.StartsWith(trash, StringComparison.OrdinalIgnoreCase) &&
                                        System.IO.Path.GetFileNameWithoutExtension(f).Contains(q, StringComparison.CurrentCultureIgnoreCase))
                            .Take(300).Select(f => FileRow(f, true)).ToList();
                        empty = "검색 결과가 없습니다.";
                    }
                    else
                    {
                        foreach (var d in Directory.EnumerateDirectories(_folder).OrderBy(d => d, StringComparer.CurrentCultureIgnoreCase))
                        {
                            if (string.Equals(d, trash, StringComparison.OrdinalIgnoreCase)) continue;
                            rows.Add(new DocRow
                            {
                                Title = "📁 " + System.IO.Path.GetFileName(d),
                                Sub = Directory.EnumerateFileSystemEntries(d).Count() + "개 항목",
                                Path = d, IsFolder = true
                            });
                        }
                        rows.AddRange(Directory.EnumerateFiles(_folder).Where(IsDoc).Select(f => new FileInfo(f))
                            .OrderByDescending(f => f.LastWriteTime).Select(f => FileRow(f.FullName, false)));
                        empty = "새 노트를 만들면 이곳에 저장됩니다. PDF를 이 폴더에 넣어도 표시됩니다.";
                        bool sub = !string.Equals(_folder.TrimEnd('\\'), lib.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
                        UpBtn.Visibility = sub ? Visibility.Visible : Visibility.Collapsed;
                        PathText.Text = sub ? "문서함\\" + System.IO.Path.GetRelativePath(lib, _folder) : "문서함 (" + lib + ")";
                    }
                    break;
            }
        }
        catch (Exception ex) { Store.Log("home refresh: " + ex.Message); }
        DocList.ItemsSource = rows;
        EmptyText.Text = rows.Count == 0 ? empty : "";
    }

    void Tab_Checked(object s, RoutedEventArgs e)
    {
        if (DocList == null) return;
        _filter = (string)((RadioButton)s).Tag;
        Refresh();
    }

    void Search_Changed(object s, TextChangedEventArgs e) { if (DocList != null) Refresh(); }

    void Open_Click(object s, RoutedEventArgs e) => OpenDialogRequested?.Invoke();
    void New_Click(object s, RoutedEventArgs e) => NewNoteRequested?.Invoke();
    void Library_Click(object s, RoutedEventArgs e) =>
        Process.Start(new ProcessStartInfo(Store.LibraryDir) { UseShellExecute = true });

    /// <summary>Folder where a new note should be created (current library folder).</summary>
    public string CurrentFolder => _filter == "all" && Directory.Exists(_folder) ? _folder : Store.LibraryDir;

    void NewFolder_Click(object s, RoutedEventArgs e)
    {
        var name = Dialogs.Prompt(Window.GetWindow(this), "새 폴더", "폴더 이름");
        if (string.IsNullOrWhiteSpace(name)) return;
        name = string.Concat(name.Trim().Select(c => System.IO.Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
        try { Directory.CreateDirectory(System.IO.Path.Combine(CurrentFolder, name)); }
        catch (Exception ex) { MessageBox.Show(ex.Message); }
        if (_filter != "all") TabAll.IsChecked = true;
        Refresh();
    }

    void Up_Click(object s, RoutedEventArgs e)
    {
        var parent = Directory.GetParent(_folder)?.FullName;
        _folder = parent != null && parent.StartsWith(Store.LibraryDir, StringComparison.OrdinalIgnoreCase) ? parent : Store.LibraryDir;
        Refresh();
    }

    void ActivateRow(DocRow r)
    {
        if (r == null) return;
        if (r.IsFolder) { _folder = r.Path; SearchBox.Text = ""; Refresh(); return; }
        if (_filter == "trash") { Ctx_Restore(null, null); return; }
        OpenRequested?.Invoke(r.Path);
    }

    void List_DoubleClick(object s, MouseButtonEventArgs e) => ActivateRow(DocList.SelectedItem as DocRow);

    void List_KeyDown(object s, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) ActivateRow(DocList.SelectedItem as DocRow);
        else if (e.Key == Key.Delete && DocList.SelectedItem is DocRow r && !r.IsFolder)
        { if (_filter == "trash") Ctx_Delete(null, null); else Ctx_Trash(null, null); }
    }

    DocRow Sel => DocList.SelectedItem as DocRow;

    void Ctx_Opened(object s, RoutedEventArgs e)
    {
        var r = Sel;
        bool has = r != null, trash = _filter == "trash", folder = has && r.IsFolder;
        MiOpen.Visibility = has && !trash ? Visibility.Visible : Visibility.Collapsed;
        MiFav.Visibility = has && !trash && !folder ? Visibility.Visible : Visibility.Collapsed;
        MiRename.Visibility = has && !trash ? Visibility.Visible : Visibility.Collapsed;
        MiMove.Visibility = has && !trash && !folder ? Visibility.Visible : Visibility.Collapsed;
        MiTrash.Visibility = has && !trash && !folder ? Visibility.Visible : Visibility.Collapsed;
        MiRestore.Visibility = has && trash ? Visibility.Visible : Visibility.Collapsed;
        MiDelete.Visibility = has && (trash || folder) ? Visibility.Visible : Visibility.Collapsed;
        MiDelete.Header = folder ? "빈 폴더 삭제" : "영구 삭제";
        MiRemoveRecent.Visibility = has && _filter == "recent" ? Visibility.Visible : Visibility.Collapsed;
        MiReveal.Visibility = has ? Visibility.Visible : Visibility.Collapsed;
        if (has && r.Path != null && Store.IsFavorite(r.Path)) MiFav.Header = "즐겨찾기 해제"; else MiFav.Header = "즐겨찾기";

        MiMove.Items.Clear();
        if (has && !folder && !trash)
        {
            var top = new MenuItem { Header = "문서함 (최상위)" };
            top.Click += (a, b) => MoveTo(Store.LibraryDir);
            MiMove.Items.Add(top);
            try
            {
                foreach (var d in Directory.EnumerateDirectories(Store.LibraryDir, "*", SearchOption.AllDirectories)
                             .Where(d => !d.StartsWith(Store.TrashDir, StringComparison.OrdinalIgnoreCase)).Take(60))
                {
                    var dir = d;
                    var mi = new MenuItem { Header = System.IO.Path.GetRelativePath(Store.LibraryDir, d) };
                    mi.Click += (a, b) => MoveTo(dir);
                    MiMove.Items.Add(mi);
                }
            }
            catch { }
        }
    }

    void Ctx_Open(object s, RoutedEventArgs e) => ActivateRow(Sel);

    void Ctx_Fav(object s, RoutedEventArgs e)
    {
        if (Sel is not { IsFolder: false } r) return;
        Store.ToggleFavorite(r.Path);
        Refresh();
    }

    static string UniquePath(string dir, string name)
    {
        string baseName = System.IO.Path.GetFileNameWithoutExtension(name), ext = System.IO.Path.GetExtension(name);
        string p = System.IO.Path.Combine(dir, name);
        int n = 2;
        while (File.Exists(p) || Directory.Exists(p)) p = System.IO.Path.Combine(dir, $"{baseName} ({n++}){ext}");
        return p;
    }

    void Ctx_Rename(object s, RoutedEventArgs e)
    {
        if (Sel is not DocRow r) return;
        string cur = r.IsFolder ? System.IO.Path.GetFileName(r.Path) : System.IO.Path.GetFileNameWithoutExtension(r.Path);
        var name = Dialogs.Prompt(Window.GetWindow(this), "이름 바꾸기", "새 이름", cur);
        if (string.IsNullOrWhiteSpace(name) || name == cur) return;
        name = string.Concat(name.Trim().Select(c => System.IO.Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));
        try
        {
            string dir = System.IO.Path.GetDirectoryName(r.Path);
            if (r.IsFolder)
            {
                string np = UniquePath(dir, name);
                Directory.Move(r.Path, np);
                foreach (var f in Store.Settings.Favorites.ToList().Where(f => f.StartsWith(r.Path + "\\", StringComparison.OrdinalIgnoreCase)))
                    Store.RenameInLists(f, np + f.Substring(r.Path.Length));
                foreach (var f in Store.Settings.Recents.ToList().Where(f => f.Path.StartsWith(r.Path + "\\", StringComparison.OrdinalIgnoreCase)))
                    Store.RenameInLists(f.Path, np + f.Path.Substring(r.Path.Length));
            }
            else
            {
                string ext = System.IO.Path.GetExtension(r.Path);
                string np = UniquePath(dir, name + ext);
                File.Move(r.Path, np);
                if (ext.Equals(".pnote", StringComparison.OrdinalIgnoreCase)) RetitleNotebook(np, name);
                Store.RenameInLists(r.Path, np);
                var rec = Store.Settings.Recents.FirstOrDefault(x => string.Equals(x.Path, np, StringComparison.OrdinalIgnoreCase));
                if (rec != null) { rec.Title = name; Store.SaveSettings(); }
            }
        }
        catch (Exception ex) { MessageBox.Show(Window.GetWindow(this), "이름을 바꿀 수 없습니다.\n" + ex.Message); }
        Refresh();
    }

    static void RetitleNotebook(string file, string title)
    {
        try
        {
            var meta = JsonSerializer.Deserialize<NotebookMeta>(File.ReadAllText(file),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (meta == null) return;
            meta.Title = title;
            File.WriteAllText(file, JsonSerializer.Serialize(meta));
        }
        catch (Exception ex) { Store.Log("retitle: " + ex.Message); }
    }

    void MoveTo(string dir)
    {
        if (Sel is not { IsFolder: false } r) return;
        try
        {
            string np = UniquePath(dir, System.IO.Path.GetFileName(r.Path));
            if (string.Equals(np, r.Path, StringComparison.OrdinalIgnoreCase)) return;
            File.Move(r.Path, np);
            Store.RenameInLists(r.Path, np);
        }
        catch (Exception ex) { MessageBox.Show(Window.GetWindow(this), "이동할 수 없습니다.\n" + ex.Message); }
        Refresh();
    }

    void Ctx_Trash(object s, RoutedEventArgs e)
    {
        if (Sel is not { IsFolder: false } r) return;
        try
        {
            string np = UniquePath(Store.TrashDir, System.IO.Path.GetFileName(r.Path));
            File.Move(r.Path, np);
            Store.RemoveRecent(r.Path);
            if (Store.IsFavorite(r.Path)) Store.ToggleFavorite(r.Path);
        }
        catch (Exception ex) { MessageBox.Show(Window.GetWindow(this), "휴지통으로 옮길 수 없습니다.\n(열려 있는 문서는 탭을 닫은 뒤 시도하세요)\n" + ex.Message); }
        Refresh();
    }

    void Ctx_Restore(object s, RoutedEventArgs e)
    {
        if (Sel is not { IsFolder: false } r) return;
        try
        {
            string np = UniquePath(Store.LibraryDir, System.IO.Path.GetFileName(r.Path));
            File.Move(r.Path, np);
        }
        catch (Exception ex) { MessageBox.Show(Window.GetWindow(this), "복원할 수 없습니다.\n" + ex.Message); }
        Refresh();
    }

    void Ctx_Delete(object s, RoutedEventArgs e)
    {
        if (Sel is not DocRow r) return;
        string what = r.IsFolder ? "이 폴더(비어 있어야 함)" : "이 문서";
        if (MessageBox.Show(Window.GetWindow(this), what + "를 영구 삭제할까요? 되돌릴 수 없습니다.", "영구 삭제",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        try
        {
            if (r.IsFolder) Directory.Delete(r.Path, false); else File.Delete(r.Path);
        }
        catch (Exception ex) { MessageBox.Show(Window.GetWindow(this), "삭제할 수 없습니다.\n" + ex.Message); }
        Refresh();
    }

    void EmptyTrash_Click(object s, RoutedEventArgs e)
    {
        if (MessageBox.Show(Window.GetWindow(this), "휴지통을 비울까요? 되돌릴 수 없습니다.", "휴지통 비우기",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        foreach (var f in Directory.EnumerateFiles(Store.TrashDir)) { try { File.Delete(f); } catch { } }
        Refresh();
    }

    void Ctx_RemoveRecent(object s, RoutedEventArgs e)
    {
        if (Sel is not DocRow r) return;
        Store.RemoveRecent(r.Path);
        Refresh();
    }

    void Ctx_Reveal(object s, RoutedEventArgs e)
    {
        if (Sel is not DocRow r) return;
        string arg = r.IsFolder ? $"\"{r.Path}\"" : $"/select,\"{r.Path}\"";
        Process.Start(new ProcessStartInfo("explorer.exe", arg) { UseShellExecute = true });
    }
}
