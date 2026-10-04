using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PdfNote;

/// <summary>
/// Google account access for Drive sync (opt-in). OAuth 2.0 for installed apps: system browser + loopback redirect on
/// 127.0.0.1:&lt;random port&gt; + PKCE. Scopes: drive.file (only files this app created/opened) and email (to show the account).
/// Tokens, client id and secret are stored DPAPI-protected (CurrentUser) in &lt;data&gt;\google.json and never reach the page.
/// <c>request</c> is an authenticated HTTP proxy restricted to HTTPS *.googleapis.com / accounts.google.com.
/// </summary>
sealed class GoogleService
{
    const string Scope = "https://www.googleapis.com/auth/drive.file email";
    const string AuthEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
    const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    const string RevokeEndpoint = "https://oauth2.googleapis.com/revoke";
    const string UserInfoEndpoint = "https://www.googleapis.com/oauth2/v3/userinfo";
    const long MaxTextBytes = 32L * 1024 * 1024;

    static readonly string StoreFile = Path.Combine(AppPaths.Data, "google.json");
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Everynote.google.v1");

    sealed class State
    {
        public string ClientId, ClientSecret, RefreshToken, AccessToken, Email;
        public long ExpiresAtMs;
    }

    readonly object lk = new();
    readonly SemaphoreSlim refreshLock = new(1, 1);
    State st;
    CancellationTokenSource signInCts;
    readonly HttpClient http = new(new SocketsHttpHandler { AllowAutoRedirect = false, AutomaticDecompression = DecompressionMethods.All, PooledConnectionLifetime = TimeSpan.FromMinutes(10) })
    { Timeout = Timeout.InfiniteTimeSpan };

    public GoogleService() { st = Load(); }

    // ------------------------------------------------------------------------------------------------- storage
    static State Load()
    {
        var s = new State();
        try
        {
            if (File.Exists(StoreFile))
            {
                using var d = JsonDocument.Parse(File.ReadAllText(StoreFile));
                var blob = d.RootElement.GetProperty("blob").GetString();
                var plain = System.Security.Cryptography.ProtectedData.Unprotect(Convert.FromBase64String(blob), Entropy, DataProtectionScope.CurrentUser);
                var o = JsonNode.Parse(Encoding.UTF8.GetString(plain));
                s.ClientId = (string)o["clientId"]; s.ClientSecret = (string)o["clientSecret"];
                s.RefreshToken = (string)o["refreshToken"]; s.AccessToken = (string)o["accessToken"]; s.Email = (string)o["email"];
                s.ExpiresAtMs = (long?)o["expiresAt"] ?? 0;
            }
        }
        catch (Exception e) { Log.Write("google store unreadable: " + e.Message); }
        return s;
    }

    void Save()
    {
        State s; lock (lk) s = st;
        var o = new JsonObject
        {
            ["clientId"] = s.ClientId, ["clientSecret"] = s.ClientSecret, ["refreshToken"] = s.RefreshToken,
            ["accessToken"] = s.AccessToken, ["email"] = s.Email, ["expiresAt"] = s.ExpiresAtMs
        };
        var blob = System.Security.Cryptography.ProtectedData.Protect(Encoding.UTF8.GetBytes(o.ToJsonString()), Entropy, DataProtectionScope.CurrentUser);
        Directory.CreateDirectory(AppPaths.Data);
        var tmp = StoreFile + ".part";
        File.WriteAllText(tmp, JsonSerializer.Serialize(new { v = 1, blob = Convert.ToBase64String(blob) }));
        File.Move(tmp, StoreFile, true);
    }

    static string Env(params string[] names)
    {
        foreach (var n in names) { var v = Environment.GetEnvironmentVariable(n); if (!string.IsNullOrWhiteSpace(v)) return v.Trim(); }
        return null;
    }

    string ClientId { get { lock (lk) return !string.IsNullOrEmpty(st.ClientId) ? st.ClientId : Env("EVERYNOTE_GOOGLE_CLIENT_ID", "PDFNOTE_GOOGLE_CLIENT_ID"); } }
    string ClientSecret { get { lock (lk) return !string.IsNullOrEmpty(st.ClientSecret) ? st.ClientSecret : Env("EVERYNOTE_GOOGLE_CLIENT_SECRET", "PDFNOTE_GOOGLE_CLIENT_SECRET"); } }

    // ------------------------------------------------------------------------------------------------- public API
    public object Status()
    {
        lock (lk) return new { signedIn = !string.IsNullOrEmpty(st.RefreshToken) || !string.IsNullOrEmpty(st.AccessToken), email = st.Email ?? "", configured = !string.IsNullOrEmpty(ClientId) };
    }

    /// <summary>Stores (or with empty values clears) the OAuth client. A different client id invalidates the current sign-in.</summary>
    public object Config(string clientId, string clientSecret)
    {
        clientId = (clientId ?? "").Trim(); clientSecret = (clientSecret ?? "").Trim();
        lock (lk)
        {
            if (!string.Equals(st.ClientId ?? "", clientId, StringComparison.Ordinal)) { st.RefreshToken = null; st.AccessToken = null; st.Email = null; st.ExpiresAtMs = 0; }
            st.ClientId = clientId.Length == 0 ? null : clientId;
            st.ClientSecret = clientSecret.Length == 0 ? null : clientSecret;
        }
        Save();
        return Status();
    }

    public async Task<object> SignIn(CancellationToken outer)
    {
        var cid = ClientId;
        if (string.IsNullOrEmpty(cid)) throw new InvalidOperationException("Google 클라이언트 ID가 설정되지 않았습니다");
        CancellationTokenSource mine;
        lock (lk) { try { signInCts?.Cancel(); } catch { } mine = signInCts = CancellationTokenSource.CreateLinkedTokenSource(outer); }
        mine.CancelAfter(TimeSpan.FromMinutes(5));
        var ct = mine.Token;

        var verifier = Base64Url(RandomNumberGenerator.GetBytes(48));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = Base64Url(RandomNumberGenerator.GetBytes(16));

        HttpListener listener = null; int port = 0;
        for (int i = 0; i < 20 && listener == null; i++)
        {
            var tl = new TcpListener(IPAddress.Loopback, 0); tl.Start(); port = ((IPEndPoint)tl.LocalEndpoint).Port; tl.Stop();
            var l = new HttpListener(); l.Prefixes.Add($"http://127.0.0.1:{port}/");
            try { l.Start(); listener = l; } catch { try { l.Close(); } catch { } }
        }
        if (listener == null) throw new IOException("로그인용 로컬 포트를 열 수 없습니다");
        var redirect = $"http://127.0.0.1:{port}/";
        try
        {
            var url = AuthEndpoint + "?" + Query(
                ("client_id", cid), ("redirect_uri", redirect), ("response_type", "code"), ("scope", Scope),
                ("code_challenge", challenge), ("code_challenge_method", "S256"), ("state", state),
                ("access_type", "offline"), ("prompt", "consent select_account"), ("include_granted_scopes", "true"));
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });   // ShellExecute -> default browser

            string code = null, err = null;
            using (ct.Register(() => { try { listener.Close(); } catch { } }))
            {
                while (code == null && err == null)
                {
                    HttpListenerContext ctx;
                    try { ctx = await listener.GetContextAsync(); }
                    catch (Exception) when (ct.IsCancellationRequested) { throw new OperationCanceledException("로그인이 취소되었거나 시간이 초과되었습니다"); }
                    var q = ctx.Request.QueryString;
                    if (ctx.Request.Url.AbsolutePath != "/" || (q["code"] == null && q["error"] == null)) { Respond(ctx, 404, "Not found"); continue; }
                    if (q["state"] != state) { Respond(ctx, 400, "Invalid state"); continue; }
                    if (q["error"] != null) { err = q["error"]; Respond(ctx, 200, Page(false)); }
                    else { code = q["code"]; Respond(ctx, 200, Page(true)); }
                }
            }
            if (err != null) throw new InvalidOperationException(err == "access_denied" ? "Google 로그인이 거부되었습니다" : "Google 로그인 오류: " + err);

            var tok = await PostToken(new[] { ("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirect), ("code_verifier", verifier), ("client_id", cid), ("client_secret", ClientSecret ?? "") }, ct);
            var access = (string)tok["access_token"];
            var refresh = (string)tok["refresh_token"];
            if (string.IsNullOrEmpty(refresh)) lock (lk) refresh = st.RefreshToken;
            string email = null;
            try
            {
                using var rq = new HttpRequestMessage(HttpMethod.Get, UserInfoEndpoint);
                rq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
                using var rs = await http.SendAsync(rq, ct);
                var js = JsonNode.Parse(await rs.Content.ReadAsStringAsync(ct));
                email = (string)js?["email"];
            }
            catch (Exception e) { Log.Write("google userinfo: " + e.Message); }
            lock (lk)
            {
                st.AccessToken = access; st.RefreshToken = refresh; st.Email = email ?? st.Email;
                st.ExpiresAtMs = Now() + ((long?)tok["expires_in"] ?? 3600) * 1000;
            }
            Save();
            return new { email = email ?? "" };
        }
        finally
        {
            try { listener.Close(); } catch { }
            lock (lk) { if (ReferenceEquals(signInCts, mine)) signInCts = null; }
            mine.Dispose();
        }
    }

    public async Task<object> SignOut()
    {
        string tok;
        lock (lk) { tok = st.RefreshToken ?? st.AccessToken; st.RefreshToken = null; st.AccessToken = null; st.Email = null; st.ExpiresAtMs = 0; }
        Save();
        if (!string.IsNullOrEmpty(tok))
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                using var rq = new HttpRequestMessage(HttpMethod.Post, RevokeEndpoint) { Content = new FormUrlEncodedContent(new[] { new KeyValuePair<string, string>("token", tok) }) };
                (await http.SendAsync(rq, cts.Token)).Dispose();
            }
            catch (Exception e) { Log.Write("google revoke: " + e.Message); }
        }
        return true;
    }

    // ------------------------------------------------------------------------------------------------- request proxy
    public static bool HostAllowed(Uri u) =>
        u.Scheme == Uri.UriSchemeHttps && u.IsDefaultPort && string.IsNullOrEmpty(u.UserInfo) &&
        (u.Host.Equals("accounts.google.com", StringComparison.OrdinalIgnoreCase) || u.Host.EndsWith(".googleapis.com", StringComparison.OrdinalIgnoreCase));

    static bool WantsBearer(Uri u) => u.Host.EndsWith(".googleapis.com", StringComparison.OrdinalIgnoreCase);

    static readonly HashSet<string> BlockedHeaders = new(StringComparer.OrdinalIgnoreCase) { "authorization", "host", "cookie", "proxy-authorization", "connection", "transfer-encoding", "expect" };

    public async Task<object> Request(JsonElement a, CancellationToken ct)
    {
        string S(string k) => a.ValueKind == JsonValueKind.Object && a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        var urlStr = S("url") ?? throw new ArgumentException("missing argument: url");
        if (!Uri.TryCreate(urlStr, UriKind.Absolute, out var uri) || !HostAllowed(uri)) throw new UnauthorizedAccessException("허용되지 않는 주소입니다 (HTTPS *.googleapis.com만 가능)");
        var method = new HttpMethod((S("method") ?? "GET").ToUpperInvariant());
        var headers = new List<KeyValuePair<string, string>>();
        if (a.TryGetProperty("headers", out var hs) && hs.ValueKind == JsonValueKind.Object)
            foreach (var h in hs.EnumerateObject()) if (h.Value.ValueKind == JsonValueKind.String && !BlockedHeaders.Contains(h.Name)) headers.Add(new(h.Name, h.Value.GetString()));
        var text = S("body"); var b64 = S("bodyBase64");
        var upload = S("uploadPath") is { Length: > 0 } up ? PathPolicy.ReadPath(up) : null;
        if (upload != null && !File.Exists(upload)) throw new FileNotFoundException("not found: " + upload);
        var save = S("savePath") is { Length: > 0 } sp ? PathPolicy.WritePath(sp) : null;
        byte[] bodyBytes = b64 != null ? Convert.FromBase64String(b64) : null;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(upload != null || save != null ? TimeSpan.FromMinutes(45) : TimeSpan.FromMinutes(3));
        var tk = timeout.Token;

        bool refreshed = false;
        for (int hop = 0; ; )
        {
            string bearer = WantsBearer(uri) ? await GetAccessToken(false, tk) : null;
            if (WantsBearer(uri) && bearer == null) throw new InvalidOperationException("Google에 로그인되어 있지 않습니다");
            FileStream fs = null;
            using var rq = new HttpRequestMessage(method, uri);
            try
            {
                if (bearer != null) rq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
                HttpContent content = null;
                if (upload != null) { fs = new FileStream(upload, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true); content = new StreamContent(fs, 81920); }
                else if (bodyBytes != null) content = new ByteArrayContent(bodyBytes);
                else if (text != null) content = new StringContent(text, new UTF8Encoding(false));
                else if (method != HttpMethod.Get && method != HttpMethod.Head && method != HttpMethod.Delete) content = new ByteArrayContent(Array.Empty<byte>());
                if (content != null) { content.Headers.ContentType = null; rq.Content = content; }
                foreach (var h in headers)
                {
                    if (h.Key.Equals("content-type", StringComparison.OrdinalIgnoreCase)) { if (content != null) content.Headers.TryAddWithoutValidation("Content-Type", h.Value); }
                    else if (!rq.Headers.TryAddWithoutValidation(h.Key, h.Value) && content != null) content.Headers.TryAddWithoutValidation(h.Key, h.Value);
                }
                if (content != null && content.Headers.ContentType == null && text != null) content.Headers.ContentType = new MediaTypeHeaderValue("application/json") { CharSet = "utf-8" };

                using var rs = await http.SendAsync(rq, HttpCompletionOption.ResponseHeadersRead, tk);
                int status = (int)rs.StatusCode;

                if (status == 401 && bearer != null && !refreshed)
                {
                    refreshed = true;
                    if (await GetAccessToken(true, tk) != null) continue;
                }
                if ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && (method == HttpMethod.Get || method == HttpMethod.Head) && rs.Headers.Location != null && ++hop <= 5)
                {
                    var next = rs.Headers.Location.IsAbsoluteUri ? rs.Headers.Location : new Uri(uri, rs.Headers.Location);
                    if (!HostAllowed(next)) throw new UnauthorizedAccessException("허용되지 않는 리디렉션입니다");
                    uri = next; continue;
                }

                var hdr = new Dictionary<string, string>();
                foreach (var h in rs.Headers) hdr[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);
                foreach (var h in rs.Content.Headers) hdr[h.Key.ToLowerInvariant()] = string.Join(", ", h.Value);

                if (save != null && status >= 200 && status < 300)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(save));
                    var tmp = save + "." + Guid.NewGuid().ToString("N").Substring(0, 8) + ".part";
                    try
                    {
                        await using (var o = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
                        await using (var i = await rs.Content.ReadAsStreamAsync(tk)) await i.CopyToAsync(o, 81920, tk);
                        File.Move(tmp, save, true);
                    }
                    finally { try { if (File.Exists(tmp)) File.Delete(tmp); } catch { } }
                    return new { status, headers = hdr, savedPath = save };
                }
                using var ms = new MemoryStream();
                await using (var i = await rs.Content.ReadAsStreamAsync(tk))
                {
                    var buf = new byte[81920]; int n;
                    while ((n = await i.ReadAsync(buf, 0, buf.Length, tk)) > 0)
                    {
                        ms.Write(buf, 0, n);
                        if (ms.Length > MaxTextBytes) throw new IOException("응답이 너무 큽니다 (savePath를 사용하세요)");
                    }
                }
                return new { status, headers = hdr, text = Encoding.UTF8.GetString(ms.ToArray()) };
            }
            catch (OperationCanceledException) when (tk.IsCancellationRequested && !ct.IsCancellationRequested) { throw new TimeoutException("Google 요청 시간이 초과되었습니다"); }
            finally { fs?.Dispose(); }
        }
    }

    // ------------------------------------------------------------------------------------------------- tokens
    async Task<string> GetAccessToken(bool force, CancellationToken ct)
    {
        lock (lk)
        {
            if (!force && !string.IsNullOrEmpty(st.AccessToken) && st.ExpiresAtMs - Now() > 60_000) return st.AccessToken;
            if (string.IsNullOrEmpty(st.RefreshToken)) return force ? null : (st.AccessToken is { Length: > 0 } t && st.ExpiresAtMs > Now() ? t : null);
        }
        await refreshLock.WaitAsync(ct);
        try
        {
            string rt, stale;
            lock (lk)
            {
                if (!force && !string.IsNullOrEmpty(st.AccessToken) && st.ExpiresAtMs - Now() > 60_000) return st.AccessToken;   // refreshed by someone else
                rt = st.RefreshToken; stale = st.AccessToken;
            }
            if (force && !string.IsNullOrEmpty(stale)) { lock (lk) { if (st.AccessToken != stale && st.ExpiresAtMs - Now() > 60_000) return st.AccessToken; } }
            JsonNode tok;
            try { tok = await PostToken(new[] { ("grant_type", "refresh_token"), ("refresh_token", rt), ("client_id", ClientId ?? ""), ("client_secret", ClientSecret ?? "") }, ct); }
            catch (GoogleAuthException e) when (e.Code == "invalid_grant")
            {
                lock (lk) { st.RefreshToken = null; st.AccessToken = null; st.ExpiresAtMs = 0; }
                Save();
                throw new InvalidOperationException("Google 로그인이 만료되었습니다. 다시 로그인하세요");
            }
            lock (lk) { st.AccessToken = (string)tok["access_token"]; st.ExpiresAtMs = Now() + ((long?)tok["expires_in"] ?? 3600) * 1000; if ((string)tok["refresh_token"] is { Length: > 0 } nr) st.RefreshToken = nr; }
            Save();
            lock (lk) return st.AccessToken;
        }
        finally { refreshLock.Release(); }
    }

    sealed class GoogleAuthException : Exception { public string Code; public GoogleAuthException(string code, string msg) : base(msg) { Code = code; } }

    async Task<JsonNode> PostToken((string, string)[] form, CancellationToken ct)
    {
        var pairs = form.Where(f => !(f.Item1 == "client_secret" && string.IsNullOrEmpty(f.Item2))).Select(f => new KeyValuePair<string, string>(f.Item1, f.Item2));
        using var rq = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint) { Content = new FormUrlEncodedContent(pairs) };
        using var rs = await http.SendAsync(rq, ct);
        var body = await rs.Content.ReadAsStringAsync(ct);
        JsonNode js = null; try { js = JsonNode.Parse(body); } catch { }
        if (!rs.IsSuccessStatusCode)
        {
            var code = (string)js?["error"] ?? ((int)rs.StatusCode).ToString();
            throw new GoogleAuthException(code, "Google 인증 오류: " + code + (js?["error_description"] != null ? " - " + (string)js["error_description"] : ""));
        }
        return js;
    }

    // ------------------------------------------------------------------------------------------------- helpers
    static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    static string Query(params (string, string)[] kv) => string.Join("&", kv.Select(p => Uri.EscapeDataString(p.Item1) + "=" + Uri.EscapeDataString(p.Item2)));

    static void Respond(HttpListenerContext ctx, int code, string html)
    {
        try
        {
            var b = Encoding.UTF8.GetBytes(html);
            ctx.Response.StatusCode = code; ctx.Response.ContentType = "text/html; charset=utf-8"; ctx.Response.ContentLength64 = b.Length;
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.OutputStream.Write(b, 0, b.Length); ctx.Response.Close();
        }
        catch { }
    }

    static string Page(bool ok) =>
        "<!doctype html><meta charset=utf-8><title>Everynote</title><body style=\"font-family:Segoe UI,Malgun Gothic,sans-serif;background:#f5f5f7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0\">" +
        "<div style=\"background:#fff;border-radius:16px;padding:36px 44px;box-shadow:0 8px 30px rgba(0,0,0,.12);text-align:center;max-width:420px\">" +
        "<div style=\"font-size:44px\">" + (ok ? "&#9989;" : "&#9888;&#65039;") + "</div><h2 style=\"margin:8px 0\">" + (ok ? "Everynote 로그인 완료" : "로그인하지 못했습니다") + "</h2>" +
        "<p style=\"color:#555\">" + (ok ? "이 창을 닫고 Everynote로 돌아가세요.<br>You can close this tab and return to Everynote." : "Everynote로 돌아가 다시 시도하세요.<br>Return to Everynote and try again.") + "</p></div>";
}
