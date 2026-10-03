using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Shapes = System.Windows.Shapes;

namespace PdfNote;

public static class ObjStyle
{
    public static readonly string[] TextColors =
        { "#111111", "#E53935", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#757575", "#FFFFFF" };

    public static readonly (string key, string name)[] Fonts =
        { ("gothic", "고딕"), ("serif", "명조"), ("mono", "고정폭"), ("hand", "손글씨") };

    public static readonly double[] Sizes = { 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72 };

    public static readonly (string key, string name)[] ShapeKinds =
    {
        ("rect", "사각형"), ("round", "둥근 사각형"), ("circle", "원"), ("triangle", "삼각형"), ("diamond", "마름모"),
        ("star", "별"), ("heart", "하트"), ("line", "선"), ("arrow", "화살표")
    };

    public static readonly (string group, string[] items)[] Stickers =
    {
        ("별·반짝", new[] { "⭐", "🌟", "✨", "💫", "⚡", "🔥", "💥", "🎆", "🎇", "🌠", "☄️", "🪐" }),
        ("하트", new[] { "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💗", "💓", "💝" }),
        ("잎·꽃", new[] { "🍀", "🌿", "🍃", "🍂", "🍁", "🌸", "🌼", "🌻", "🌷", "🌹", "🌺", "🪻" }),
        ("응원", new[] { "👍", "👏", "🙌", "💪", "🎉", "🏆", "🥇", "✅", "💯", "🙏", "🤝", "📣" }),
        ("표정", new[] { "😀", "😊", "😍", "🤩", "😎", "🤔", "😮", "😢", "😡", "😴", "🥳", "😅" }),
        ("날씨", new[] { "☀️", "🌤️", "⛅", "☁️", "🌧️", "⛈️", "❄️", "🌈", "🌙", "🌪️", "💧", "🌡️" }),
    };

    public static Brush B(string hex)
    {
        if (string.IsNullOrEmpty(hex)) return null;
        try
        {
            var b = new SolidColorBrush((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex));
            b.Freeze();
            return b;
        }
        catch { return null; }
    }

    public static System.Windows.Media.FontFamily Font(string key) => key switch
    {
        "serif" => new System.Windows.Media.FontFamily("Batang, Times New Roman, Malgun Gothic"),
        "mono" => new System.Windows.Media.FontFamily("Consolas, D2Coding, Malgun Gothic"),
        "hand" => new System.Windows.Media.FontFamily("Ink Free, Segoe Print, Malgun Gothic"),
        _ => new System.Windows.Media.FontFamily("Malgun Gothic, Segoe UI")
    };

    public static Geometry ShapeGeometry(string key)
    {
        switch (key)
        {
            case "round": return new RectangleGeometry(new Rect(0, 0, 100, 100), 18, 18);
            case "circle": return new EllipseGeometry(new Rect(0, 0, 100, 100));
            case "triangle": return Geometry.Parse("M50,0 L100,100 L0,100 Z");
            case "diamond": return Geometry.Parse("M50,0 L100,50 L50,100 L0,50 Z");
            case "heart":
                return Geometry.Parse("M50,95 C10,62 0,36 15,16 C30,-2 48,8 50,25 C52,8 70,-2 85,16 C100,36 90,62 50,95 Z");
            case "line": return Geometry.Parse("M0,100 L100,0");
            case "arrow": return Geometry.Parse("M0,100 L100,0 M52,0 L100,0 L100,48");
            case "star":
            {
                var pts = new List<string>();
                for (int i = 0; i < 10; i++)
                {
                    double r = i % 2 == 0 ? 50 : 21;
                    double a = -Math.PI / 2 + i * Math.PI / 5;
                    pts.Add(string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:0.##},{1:0.##}",
                        50 + r * Math.Cos(a), 52 + r * Math.Sin(a)));
                }
                return Geometry.Parse("M" + string.Join(" L", pts) + " Z");
            }
            default: return new RectangleGeometry(new Rect(0, 0, 100, 100));
        }
    }
}

/// <summary>Builds the visual content of an object (used for both editing and export).</summary>
public static class ObjectViews
{
    public static BitmapSource LoadImage(string path)
    {
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.DecodePixelWidth = 1600;
            bmp.UriSource = new Uri(path);
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch { return null; }
    }

    public static string LinkTitle(ObjectItem m)
    {
        if (!string.IsNullOrWhiteSpace(m.Text)) return m.Text;
        if (m.LinkPage >= 0) return $"{m.LinkPage + 1}페이지로 이동";
        return m.Url;
    }

    public static FrameworkElement Build(ObjectItem m, double bw, double bh, string key, bool editable,
        Action changed, Action<ObjectItem> linkClicked)
    {
        double w = Math.Max(24, m.W * bw), h = Math.Max(24, m.H * bh);
        switch (m.Type)
        {
            case "text":
            {
                if (editable)
                {
                    var tb = new TextBox
                    {
                        Text = m.Text, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
                        Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                        Padding = new Thickness(3), Width = w, MinHeight = m.Size * 1.6,
                        FontFamily = ObjStyle.Font(m.Font), FontSize = m.Size,
                        FontWeight = m.Bold ? FontWeights.Bold : FontWeights.Normal,
                        FontStyle = m.Italic ? FontStyles.Italic : FontStyles.Normal,
                        Foreground = ObjStyle.B(m.Color) ?? Brushes.Black,
                        CaretBrush = Brushes.DodgerBlue
                    };
                    tb.TextChanged += (s, e) => { m.Text = tb.Text; changed?.Invoke(); };
                    return tb;
                }
                return new TextBlock
                {
                    Text = m.Text, TextWrapping = TextWrapping.Wrap, Padding = new Thickness(3), Width = w,
                    FontFamily = ObjStyle.Font(m.Font), FontSize = m.Size,
                    FontWeight = m.Bold ? FontWeights.Bold : FontWeights.Normal,
                    FontStyle = m.Italic ? FontStyles.Italic : FontStyles.Normal,
                    Foreground = ObjStyle.B(m.Color) ?? Brushes.Black
                };
            }
            case "image":
            {
                var src = LoadImage(System.IO.Path.Combine(Store.MediaDir(key), m.Media));
                return new Image { Source = src, Stretch = Stretch.Uniform, Width = w, Height = h };
            }
            case "sticker":
                return new Viewbox
                {
                    Width = w, Height = h, Stretch = Stretch.Uniform,
                    Child = new TextBlock
                    {
                        Text = m.Text, FontSize = 100,
                        FontFamily = new System.Windows.Media.FontFamily("Segoe UI Emoji")
                    }
                };
            case "shape":
                return new Shapes.Path
                {
                    Data = ObjStyle.ShapeGeometry(m.Shape), Stretch = Stretch.Fill,
                    Stroke = ObjStyle.B(m.Color) ?? Brushes.Black, StrokeThickness = m.Thick,
                    Fill = ObjStyle.B(m.Fill), StrokeLineJoin = PenLineJoin.Round,
                    StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round,
                    Width = w, Height = h, Margin = new Thickness(m.Thick)
                };
            case "table":
            {
                int rows = Math.Max(1, m.Rows), cols = Math.Max(1, m.Cols);
                while (m.Cells.Count < rows * cols) m.Cells.Add("");
                var g = new Grid { Width = w };
                for (int c = 0; c < cols; c++) g.ColumnDefinitions.Add(new ColumnDefinition());
                for (int r = 0; r < rows; r++) g.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
                for (int r = 0; r < rows; r++)
                    for (int c = 0; c < cols; c++)
                    {
                        int idx = r * cols + c;
                        FrameworkElement cell;
                        if (editable)
                        {
                            var tb = new TextBox
                            {
                                Text = m.Cells[idx], AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
                                Background = Brushes.Transparent, BorderThickness = new Thickness(0),
                                Padding = new Thickness(4, 3, 4, 3), MinHeight = 28, FontSize = m.Size,
                                FontWeight = r == 0 ? FontWeights.SemiBold : FontWeights.Normal,
                                VerticalContentAlignment = VerticalAlignment.Center
                            };
                            tb.TextChanged += (s, e) => { m.Cells[idx] = tb.Text; changed?.Invoke(); };
                            cell = tb;
                        }
                        else
                        {
                            cell = new TextBlock
                            {
                                Text = m.Cells[idx], TextWrapping = TextWrapping.Wrap, FontSize = m.Size,
                                Padding = new Thickness(4, 3, 4, 3), MinHeight = 28,
                                FontWeight = r == 0 ? FontWeights.SemiBold : FontWeights.Normal
                            };
                        }
                        var border = new Border
                        {
                            BorderBrush = ObjStyle.B(m.Color) ?? Brushes.Gray,
                            BorderThickness = new Thickness(m.Thick / 2),
                            Background = r == 0 ? ObjStyle.B(m.Fill) : Brushes.White,
                            Child = cell
                        };
                        Grid.SetRow(border, r); Grid.SetColumn(border, c);
                        g.Children.Add(border);
                    }
                return g;
            }
            case "link":
            {
                bool yt = (m.Url ?? "").Contains("youtu", StringComparison.OrdinalIgnoreCase);
                var tbk = new TextBlock
                {
                    Text = (yt ? "▶  " : "🔗  ") + LinkTitle(m), FontSize = 14, TextTrimming = TextTrimming.CharacterEllipsis,
                    Foreground = ObjStyle.B(yt ? "#C62828" : "#1565C0"), MaxWidth = Math.Max(120, w)
                };
                var b = new Border
                {
                    Background = ObjStyle.B(yt ? "#FFEBEE" : "#E3F2FD"),
                    BorderBrush = ObjStyle.B(yt ? "#E53935" : "#1E88E5"), BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(7), Padding = new Thickness(10, 6, 10, 6),
                    Cursor = editable ? Cursors.Hand : Cursors.Arrow, Child = tbk
                };
                if (editable)
                    b.MouseLeftButtonUp += (s, e) => { linkClicked?.Invoke(m); e.Handled = true; };
                return b;
            }
        }
        return new TextBlock { Text = "?" };
    }
}

/// <summary>Movable / resizable wrapper for a page object. Controls appear on hover or focus.</summary>
public class ObjectControl : Grid
{
    public ObjectItem Model { get; }
    readonly double _bw, _bh;
    readonly string _key;
    public event Action Changed;
    public event Action<ObjectControl> DeleteRequested;
    public event Action<ObjectItem> LinkActivated;
    public event Action<ObjectControl> Moved;

    FrameworkElement _content;
    Border _strip, _grip;
    Shapes.Rectangle _frame;
    string _dragKind;           // "move" | "resize"
    Point _start, _orig;
    double _origW, _origH;

    public ObjectControl(ObjectItem m, double bw, double bh, string key)
    {
        Model = m; _bw = bw; _bh = bh; _key = key;
        Focusable = true;
        BuildAll();
        MouseEnter += (s, e) => UpdateChrome();
        MouseLeave += (s, e) => UpdateChrome();
        IsKeyboardFocusWithinChanged += (s, e) => UpdateChrome();
        PreviewMouseLeftButtonDown += (s, e) => { if (!IsKeyboardFocusWithin) Focus(); };
        MouseMove += OnMouseMoveDrag;
        MouseLeftButtonUp += OnMouseUpDrag;
    }

    bool BodyMovable => Model.Type is "image" or "sticker" or "shape";

    void BuildAll()
    {
        Children.Clear();
        _content = ObjectViews.Build(Model, _bw, _bh, _key, true, () => Changed?.Invoke(), m => LinkActivated?.Invoke(m));
        Children.Add(_content);

        if (BodyMovable)
        {
            _content.Cursor = Cursors.SizeAll;
            _content.PreviewMouseLeftButtonDown += (s, e) => BeginDrag("move", e, _content);
        }

        _frame = new Shapes.Rectangle
        {
            Stroke = Brushes.DodgerBlue, StrokeThickness = 1, StrokeDashArray = new DoubleCollection { 3, 2 },
            Margin = new Thickness(-2), IsHitTestVisible = false, Visibility = Visibility.Collapsed
        };
        Children.Add(_frame);

        var del = SmallBtn("✕", "삭제");
        del.Click += (s, e) => DeleteRequested?.Invoke(this);
        var gear = SmallBtn("⚙", "설정");
        gear.Click += (s, e) => OpenMenu(gear);
        var dock = new DockPanel { LastChildFill = true, Height = 18 };
        DockPanel.SetDock(del, Dock.Right);
        DockPanel.SetDock(gear, Dock.Right);
        dock.Children.Add(del);
        dock.Children.Add(gear);
        dock.Children.Add(new TextBlock
        {
            Text = "이동", Foreground = Brushes.White, FontSize = 10, VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(6, 0, 0, 0)
        });
        _strip = new Border
        {
            Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(0xCC, 0x45, 0x5A, 0x64)),
            CornerRadius = new CornerRadius(3, 3, 0, 0), Height = 18, VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(-2, -19, -2, 0), MinWidth = 70, Cursor = Cursors.SizeAll,
            Child = dock, Visibility = Visibility.Collapsed
        };
        _strip.MouseLeftButtonDown += (s, e) => BeginDrag("move", e, _strip);
        _strip.MouseRightButtonUp += (s, e) => { OpenMenu(_strip); e.Handled = true; };
        Children.Add(_strip);

        _grip = new Border
        {
            Width = 16, Height = 16, Background = Brushes.DodgerBlue, BorderBrush = Brushes.White,
            BorderThickness = new Thickness(1.5), CornerRadius = new CornerRadius(8),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, -8, -8), Cursor = Cursors.SizeNWSE, Visibility = Visibility.Collapsed,
            ToolTip = "크기 조절"
        };
        _grip.MouseLeftButtonDown += (s, e) => BeginDrag("resize", e, _grip);
        Children.Add(_grip);
    }

    static Button SmallBtn(string text, string tip) => new()
    {
        Content = text, Width = 22, ToolTip = tip, Foreground = Brushes.White, Background = Brushes.Transparent,
        BorderThickness = new Thickness(0), Padding = new Thickness(0), FontSize = 11, Cursor = Cursors.Hand
    };

    public void Refresh() => BuildAll();

    public void FocusContent()
    {
        if (_content is TextBox tb) { tb.Focus(); Keyboard.Focus(tb); }
        else if (_content is Grid g && g.Children.OfType<Border>().FirstOrDefault()?.Child is TextBox cell)
        { cell.Focus(); Keyboard.Focus(cell); }
        else Focus();
    }

    void UpdateChrome()
    {
        bool on = IsMouseOver || IsKeyboardFocusWithin || _dragKind != null;
        var v = on ? Visibility.Visible : Visibility.Collapsed;
        _strip.Visibility = v;
        _frame.Visibility = v;
        _grip.Visibility = on && Model.Type != "link" ? Visibility.Visible : Visibility.Collapsed;
    }

    // ---------------------------------------------------------------- dragging

    void BeginDrag(string kind, MouseButtonEventArgs e, UIElement source)
    {
        if (Parent is not IInputElement p) return;
        _dragKind = kind;
        _start = e.GetPosition(p);
        _orig = new Point(Canvas.GetLeft(this), Canvas.GetTop(this));
        _origW = _content.ActualWidth;
        _origH = _content.ActualHeight;
        CaptureMouse();
        UpdateChrome();
        e.Handled = true;
    }

    void OnMouseMoveDrag(object s, MouseEventArgs e)
    {
        if (_dragKind == null || Parent is not IInputElement p) return;
        var pos = e.GetPosition(p);
        if (_dragKind == "move")
        {
            Canvas.SetLeft(this, _orig.X + pos.X - _start.X);
            Canvas.SetTop(this, _orig.Y + pos.Y - _start.Y);
        }
        else
        {
            double nw = Math.Max(Model.Type == "table" ? 90 : 40, _origW + pos.X - _start.X);
            double nh = Math.Max(24, _origH + pos.Y - _start.Y);
            ApplySize(nw, nh);
        }
    }

    void OnMouseUpDrag(object s, MouseButtonEventArgs e)
    {
        if (_dragKind == null) return;
        string kind = _dragKind;
        _dragKind = null;
        ReleaseMouseCapture();
        UpdateChrome();
        if (kind == "move") Moved?.Invoke(this);
        Changed?.Invoke();
    }

    void ApplySize(double w, double h)
    {
        switch (Model.Type)
        {
            case "text":
            case "table":
                _content.Width = w;
                break;
            case "image":
            case "sticker":
            case "shape":
                _content.Width = w;
                _content.Height = h;
                break;
            default: return;
        }
        Model.W = w / _bw;
        Model.H = h / _bh;
    }

    // ---------------------------------------------------------------- menu

    static MenuItem Sub(string header, IEnumerable<(string text, Action act, bool check)> items)
    {
        var mi = new MenuItem { Header = header };
        foreach (var (text, act, check) in items)
        {
            var c = new MenuItem { Header = text, IsCheckable = false, IsChecked = check };
            c.Click += (s, e) => act();
            mi.Items.Add(c);
        }
        return mi;
    }

    static MenuItem ColorSub(string header, string current, bool allowNone, Action<string> set)
    {
        var mi = new MenuItem { Header = header };
        if (allowNone)
        {
            var none = new MenuItem { Header = "없음", IsChecked = string.IsNullOrEmpty(current) };
            none.Click += (s, e) => set("");
            mi.Items.Add(none);
        }
        foreach (var hex in ObjStyle.TextColors)
        {
            var c = hex;
            var item = new MenuItem
            {
                Header = new Shapes.Rectangle { Width = 44, Height = 14, Fill = ObjStyle.B(c), Stroke = Brushes.Gray, StrokeThickness = 0.5 },
                IsChecked = string.Equals(current, c, StringComparison.OrdinalIgnoreCase)
            };
            item.Click += (s, e) => set(c);
            mi.Items.Add(item);
        }
        return mi;
    }

    void Apply(Action edit)
    {
        edit();
        BuildAll();
        UpdateChrome();
        Changed?.Invoke();
    }

    void OpenMenu(FrameworkElement target)
    {
        var menu = new ContextMenu { PlacementTarget = target, Placement = System.Windows.Controls.Primitives.PlacementMode.Bottom };
        var m = Model;
        switch (m.Type)
        {
            case "text":
                menu.Items.Add(Sub("글꼴", ObjStyle.Fonts.Select(f =>
                    (f.name, (Action)(() => Apply(() => m.Font = f.key)), m.Font == f.key))));
                var bold = new MenuItem { Header = "굵게", IsChecked = m.Bold };
                bold.Click += (s, e) => Apply(() => m.Bold = !m.Bold);
                var ital = new MenuItem { Header = "기울임", IsChecked = m.Italic };
                ital.Click += (s, e) => Apply(() => m.Italic = !m.Italic);
                menu.Items.Add(bold);
                menu.Items.Add(ital);
                menu.Items.Add(Sub("크기", ObjStyle.Sizes.Select(z =>
                    ($"{z:0}pt", (Action)(() => Apply(() => m.Size = z)), Math.Abs(m.Size - z) < 0.1))));
                menu.Items.Add(ColorSub("색", m.Color, false, c => Apply(() => m.Color = c)));
                break;
            case "shape":
                menu.Items.Add(Sub("모양", ObjStyle.ShapeKinds.Select(k =>
                    (k.name, (Action)(() => Apply(() => m.Shape = k.key)), m.Shape == k.key))));
                menu.Items.Add(ColorSub("선 색", m.Color, false, c => Apply(() => m.Color = c)));
                menu.Items.Add(ColorSub("채우기", m.Fill, true, c => Apply(() => m.Fill = c)));
                menu.Items.Add(Sub("선 굵기", new[] { 1.0, 2, 3, 5, 8, 12 }.Select(t =>
                    ($"{t:0}", (Action)(() => Apply(() => m.Thick = t)), Math.Abs(m.Thick - t) < 0.1))));
                break;
            case "table":
                menu.Items.Add(ColorSub("선 색", m.Color, false, c => Apply(() => m.Color = c)));
                menu.Items.Add(ColorSub("머리글 배경", m.Fill, true, c => Apply(() => m.Fill = c)));
                menu.Items.Add(Sub("글자 크기", new[] { 10.0, 12, 14, 16, 18, 20 }.Select(z =>
                    ($"{z:0}pt", (Action)(() => Apply(() => m.Size = z)), Math.Abs(m.Size - z) < 0.1))));
                menu.Items.Add(new Separator());
                menu.Items.Add(Sub("행/열", new (string, Action, bool)[]
                {
                    ("행 추가", () => Apply(() => ResizeTable(m.Rows + 1, m.Cols)), false),
                    ("행 삭제", () => Apply(() => ResizeTable(m.Rows - 1, m.Cols)), false),
                    ("열 추가", () => Apply(() => ResizeTable(m.Rows, m.Cols + 1)), false),
                    ("열 삭제", () => Apply(() => ResizeTable(m.Rows, m.Cols - 1)), false),
                }));
                break;
            case "link":
                var open = new MenuItem { Header = "링크 열기" };
                open.Click += (s, e) => LinkActivated?.Invoke(m);
                menu.Items.Add(open);
                var edit = new MenuItem { Header = "링크 수정…" };
                edit.Click += (s, e) => EditLink();
                menu.Items.Add(edit);
                break;
        }
        if (menu.Items.Count > 0) menu.Items.Add(new Separator());
        var del = new MenuItem { Header = "삭제" };
        del.Click += (s, e) => DeleteRequested?.Invoke(this);
        menu.Items.Add(del);
        menu.IsOpen = true;
    }

    void ResizeTable(int rows, int cols)
    {
        var m = Model;
        rows = Math.Clamp(rows, 1, 30);
        cols = Math.Clamp(cols, 1, 12);
        var old = m.Cells;
        var cells = new List<string>(rows * cols);
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++)
            {
                int oi = r * m.Cols + c;
                cells.Add(r < m.Rows && c < m.Cols && oi < old.Count ? old[oi] : "");
            }
        m.Rows = rows; m.Cols = cols; m.Cells = cells;
    }

    void EditLink()
    {
        var owner = Window.GetWindow(this);
        var input = Dialogs.Prompt(owner, "링크 수정", "웹 주소 또는 이동할 페이지 번호",
            Model.LinkPage >= 0 ? (Model.LinkPage + 1).ToString() : Model.Url);
        if (input == null) return;
        var title = Dialogs.Prompt(owner, "링크 수정", "표시할 제목", Model.Text);
        Apply(() =>
        {
            ParseTarget(input, out var url, out var page);
            Model.Url = url; Model.LinkPage = page;
            if (title != null) Model.Text = title;
        });
    }

    public static void ParseTarget(string input, out string url, out int page)
    {
        input = (input ?? "").Trim();
        url = ""; page = -1;
        if (int.TryParse(input, out int n) && n > 0) { page = n - 1; return; }
        if (input.Length == 0) return;
        url = input.Contains("://") ? input : "https://" + input;
    }
}
