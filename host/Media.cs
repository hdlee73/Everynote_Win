using System.IO;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Windows.Storage;

namespace PdfNote;

/// <summary>media.transcode: AVI/WMV/MKV/old MOV etc. that WebView2 cannot decode -> H.264/AAC MP4 with Windows Media Foundation
/// (offline, uses the codecs Windows already has; hardware encoder when available).</summary>
static class MediaTranscode
{
    /// <summary>Extension that matches the file's real container, so Media Foundation picks the right source even when
    /// an old asset was saved as .mp4 (Everynote stores every video asset under a .mp4 name).</summary>
    static string Sniff(string path)
    {
        var b = new byte[16];
        using (var f = File.OpenRead(path)) { if (f.Read(b, 0, b.Length) < 12) return Path.GetExtension(path); }
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'A' && b[9] == 'V' && b[10] == 'I') return ".avi";
        if (b[0] == 0x30 && b[1] == 0x26 && b[2] == 0xB2 && b[3] == 0x75 && b[4] == 0x8E && b[5] == 0x66) return ".wmv";
        if (b[0] == 0x1A && b[1] == 0x45 && b[2] == 0xDF && b[3] == 0xA3) return ".mkv";
        if (b[0] == 0x47 && (b[1] & 0x40) != 0) return ".ts";
        if (b[0] == 0 && b[1] == 0 && b[2] == 1 && (b[3] == 0xBA || b[3] == 0xB3)) return ".mpg";
        if (b[0] == 'F' && b[1] == 'L' && b[2] == 'V') return ".flv";
        if (b[4] == 'f' && b[5] == 't' && b[6] == 'y' && b[7] == 'p') return b[8] == 'q' && b[9] == 't' ? ".mov" : b[8] == '3' && b[9] == 'g' ? ".3gp" : ".mp4";
        if (b[4] == 'm' && b[5] == 'o' && b[6] == 'o' && b[7] == 'v') return ".mov";
        return Path.GetExtension(path);
    }

    /// <summary>media.openExternal: hand the video to the default Windows player, under a name whose extension matches its real format.</summary>
    public static void OpenExternal(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("not found: " + path);
        var ext = Sniff(path);
        if (!string.Equals(ext, Path.GetExtension(path), StringComparison.OrdinalIgnoreCase))
        {
            var copy = Path.Combine(AppPaths.SystemTemp, "everynote-video-" + Path.GetFileNameWithoutExtension(path) + ext);
            if (!File.Exists(copy) || new FileInfo(copy).Length != new FileInfo(path).Length) File.Copy(path, copy, true);
            path = copy;
        }
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });
    }

    public static async Task<object> TranscodeAsync(string from, string to, Action<int> progress)
    {
        if (!File.Exists(from)) throw new FileNotFoundException("not found: " + from);
        string temp = null;
        try
        {
            var ext = Sniff(from);
            var src = from;
            if (!string.Equals(ext, Path.GetExtension(from), StringComparison.OrdinalIgnoreCase))
            {
                temp = Path.Combine(AppPaths.SystemTemp, "everynote-video-" + Guid.NewGuid().ToString("N") + ext);
                File.Copy(from, temp, true); src = temp;
            }
            var input = await StorageFile.GetFileFromPathAsync(src);
            var dir = Path.GetDirectoryName(to);
            Directory.CreateDirectory(dir);
            var folder = await StorageFolder.GetFolderFromPathAsync(dir);
            var output = await folder.CreateFileAsync(Path.GetFileName(to), CreationCollisionOption.ReplaceExisting);
            var profile = MediaEncodingProfile.CreateMp4(VideoEncodingQuality.Auto);
            var t = new MediaTranscoder { HardwareAccelerationEnabled = true, VideoProcessingAlgorithm = MediaVideoProcessingAlgorithm.Default };
            var prep = await t.PrepareFileTranscodeAsync(input, output, profile);
            if (!prep.CanTranscode)
            {
                try { await output.DeleteAsync(); } catch { }
                throw new NotSupportedException(prep.FailureReason == TranscodeFailureReason.CodecNotFound
                    ? "이 동영상의 코덱이 Windows에 없습니다" : "이 동영상은 변환할 수 없습니다 (" + prep.FailureReason + ")");
            }
            var op = prep.TranscodeAsync();
            int last = -1;
            op.Progress = (_, p) => { var n = (int)Math.Round(p); if (n != last) { last = n; progress?.Invoke(n); } };
            try { await op; }
            catch { try { await output.DeleteAsync(); } catch { } throw; }
            return new { path = to, size = new FileInfo(to).Length };
        }
        finally { if (temp != null) try { File.Delete(temp); } catch { } }
    }
}
