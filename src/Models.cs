namespace PdfNote;

public class RectD
{
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
    public RectD() { }
    public RectD(double x, double y, double w, double h) { X = x; Y = y; W = w; H = h; }
}

public class HighlightItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int Page { get; set; }
    public string Color { get; set; } = "#FFEB3B";
    public List<RectD> Rects { get; set; } = new();
    public string Text { get; set; } = "";
    public string Note { get; set; } = "";
}

public class MemoItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int Page { get; set; }
    public double X { get; set; }
    public double Y { get; set; }
    public string Text { get; set; } = "";
    public bool Minimized { get; set; }
}

public class OutlineItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public int Page { get; set; }
    public double Y { get; set; }
    public string Title { get; set; } = "";
}

/// <summary>Per-document annotations, stored as a JSON sidecar (the original PDF is never modified).</summary>
public class DocAnnotations
{
    public int Version { get; set; } = 1;
    public int LastPage { get; set; }
    public Dictionary<int, string> Ink { get; set; } = new();          // page -> base64 ISF
    public List<HighlightItem> Highlights { get; set; } = new();
    public List<MemoItem> Memos { get; set; } = new();
    public List<int> Bookmarks { get; set; } = new();
    public List<OutlineItem> Outline { get; set; } = new();
}

public class NotebookMeta
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "새 노트";
    public string Paper { get; set; } = "lined";      // blank | lined | grid
    public string Color { get; set; } = "#FFFFFF";
    public int Pages { get; set; } = 1;
}

public class RecentItem
{
    public string Path { get; set; } = "";
    public string Title { get; set; } = "";
    public DateTime LastOpened { get; set; } = DateTime.Now;
    public bool IsNotebook { get; set; }
}

public class AppSettings
{
    public bool LowSpec { get; set; } = true;
    public bool FingerInk { get; set; } = false;
    public string Voice { get; set; } = "";
    public string TranslateTarget { get; set; } = "ko";
    public List<RecentItem> Recents { get; set; } = new();
}

public record WordBox(string Text, double X, double Y, double W, double H);

public class OutlineEntry
{
    public string Title { get; set; } = "";
    public int Page { get; set; }
    public double Y { get; set; } = -1;
    public int Level { get; set; }
    public bool IsUser { get; set; }
    public string Id { get; set; } = "";
    public string DisplayTitle =>
        new string(' ', Level * 3) + (string.IsNullOrWhiteSpace(Title) ? "(제목 없음)" : Title) +
        (Page >= 0 ? $"  ·  p.{Page + 1}" : "");
}

public class NoteEntry
{
    public string Kind { get; set; } = "";
    public int Page { get; set; }
    public string Text { get; set; } = "";
    public string Note { get; set; } = "";
    public string Id { get; set; } = "";
    public string Header => $"p.{Page + 1}  ·  {Kind}";
    public System.Windows.Visibility NoteVisible =>
        string.IsNullOrEmpty(Note) ? System.Windows.Visibility.Collapsed : System.Windows.Visibility.Visible;
}

public class BookmarkEntry
{
    public int Page { get; set; }
    public string Display => $"p.{Page + 1}";
}

public class SearchHit
{
    public int Page { get; set; }
    public string Snippet { get; set; } = "";
    public string Display => $"p.{Page + 1}   {Snippet}";
}
