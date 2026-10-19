using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;
using PandaDownloader.Core.Models;

namespace PandaDownloader.Core
{
    public class DownloadEngine : IDisposable
    {
        private static readonly HttpClient _httpClient = new HttpClient(new SocketsHttpHandler
        {
            EnableMultipleHttp2Connections = true,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            MaxConnectionsPerServer = 64
        });

        public string Id { get; } = Guid.NewGuid().ToString("N");
        public string Url { get; }
        public string SaveDirectory { get; }
        public string Filename { get; private set; } = "download.bin";
        public string FilePath { get; private set; } = string.Empty;
        public int ConnectionsCount { get; }
        public long TotalBytes { get; private set; }
        public long DownloadedBytes => _segments.Sum(s => s.DownloadedBytes);
        public bool SupportsRange { get; private set; }
        public Models.TaskStatus Status { get; private set; } = Models.TaskStatus.Idle;

        private readonly List<DownloadSegment> _segments = new();
        private readonly object _lock = new();
        private SafeFileHandle? _fileHandle;
        private CancellationTokenSource? _cts;
        private double _currentSpeed;
        private long _lastDownloadedBytes;
        private Timer? _speedTimer;

        public event Action<DownloadProgressReport>? OnProgress;
        public event Action<string, long>? OnCompleted;
        public event Action<Exception>? OnError;

        public DownloadEngine(string url, string? saveDirectory = null, int connectionsCount = 8, string? customFilename = null)
        {
            Url = url;
            SaveDirectory = saveDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            ConnectionsCount = Math.Clamp(connectionsCount, 1, 32);
            if (!string.IsNullOrWhiteSpace(customFilename))
            {
                Filename = customFilename;
            }
        }

        public async Task StartAsync()
        {
            try
            {
                Status = Models.TaskStatus.Probing;
                _cts = new CancellationTokenSource();

                await ProbeServerAsync(_cts.Token);

                Directory.CreateDirectory(SaveDirectory);
                FilePath = Path.Combine(SaveDirectory, Filename);

                InitializeSegments();
                CreateAndPreallocateFile();

                Status = Models.TaskStatus.Downloading;
                StartSpeedMonitor();

                if (!SupportsRange || TotalBytes <= 0)
                {
                    await DownloadSingleStreamAsync(_cts.Token);
                }
                else
                {
                    await DownloadMultiSegmentAsync(_cts.Token);
                }

                Status = Models.TaskStatus.Completed;
                _speedTimer?.Dispose();
                _fileHandle?.Dispose();

                OnCompleted?.Invoke(FilePath, TotalBytes > 0 ? TotalBytes : DownloadedBytes);
            }
            catch (Exception ex)
            {
                Status = Models.TaskStatus.Error;
                _speedTimer?.Dispose();
                _fileHandle?.Dispose();
                OnError?.Invoke(ex);
            }
        }

        private async Task ProbeServerAsync(CancellationToken ct)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Url);
            req.Headers.Range = new RangeHeaderValue(0, 0);
            req.Headers.UserAgent.ParseAdd("Mozilla/5.0 PandaDownloader/1.0");

            using var res = await _httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

            if (res.Content.Headers.ContentDisposition?.FileName != null)
            {
                Filename = res.Content.Headers.ContentDisposition.FileName.Trim('"', '\'');
            }
            else if (string.IsNullOrWhiteSpace(Filename) || Filename == "download.bin")
            {
                var uri = new Uri(Url);
                var seg = Path.GetFileName(uri.LocalPath);
                Filename = !string.IsNullOrWhiteSpace(seg) ? seg : $"file_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
            }

            if (res.StatusCode == System.Net.HttpStatusCode.PartialContent)
            {
                SupportsRange = true;
                if (res.Content.Headers.ContentRange?.Length.HasValue == true)
                {
                    TotalBytes = res.Content.Headers.ContentRange.Length.Value;
                }
            }
            else if (res.IsSuccessStatusCode)
            {
                SupportsRange = res.Headers.AcceptRanges.Contains("bytes");
                if (res.Content.Headers.ContentLength.HasValue)
                {
                    TotalBytes = res.Content.Headers.ContentLength.Value;
                }
            }
        }

        private void InitializeSegments()
        {
            _segments.Clear();
            if (!SupportsRange || TotalBytes <= 0)
            {
                _segments.Add(new DownloadSegment
                {
                    Id = 0,
                    StartByte = 0,
                    CurrentByte = 0,
                    EndByte = TotalBytes > 0 ? TotalBytes - 1 : 0
                });
                return;
            }

            long chunkSize = TotalBytes / ConnectionsCount;
            for (int i = 0; i < ConnectionsCount; i++)
            {
                long start = i * chunkSize;
                long end = (i == ConnectionsCount - 1) ? TotalBytes - 1 : (start + chunkSize - 1);
                _segments.Add(new DownloadSegment
                {
                    Id = i,
                    StartByte = start,
                    CurrentByte = start,
                    EndByte = end
                });
            }
        }

        private void CreateAndPreallocateFile()
        {
            _fileHandle = File.OpenHandle(FilePath, FileMode.Create, FileAccess.Write, FileShare.ReadWrite, FileOptions.Asynchronous);
            if (TotalBytes > 0)
            {
                RandomAccess.SetLength(_fileHandle, TotalBytes);
            }
        }

        private async Task DownloadMultiSegmentAsync(CancellationToken ct)
        {
            var tasks = _segments.Select(seg => DownloadSegmentAsync(seg, ct)).ToList();
            await Task.WhenAll(tasks);
        }

        private async Task DownloadSegmentAsync(DownloadSegment segment, CancellationToken ct)
        {
            if (segment.CurrentByte > segment.EndByte)
            {
                segment.Status = SegmentStatus.Completed;
                return;
            }

            segment.Status = SegmentStatus.Downloading;

            using var req = new HttpRequestMessage(HttpMethod.Get, Url);
            req.Headers.Range = new RangeHeaderValue(segment.CurrentByte, segment.EndByte);
            req.Headers.UserAgent.ParseAdd("Mozilla/5.0 PandaDownloader/1.0");

            using var res = await _httpClient.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            using var stream = await res.Content.ReadAsStreamAsync(ct);

            byte[] buffer = new byte[64 * 1024];
            int read;

            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct)) > 0)
            {
                if (_fileHandle == null) break;

                long writeOffset = segment.CurrentByte;
                await RandomAccess.WriteAsync(_fileHandle, buffer.AsMemory(0, read), writeOffset, ct);

                lock (_lock)
                {
                    segment.CurrentByte += read;
                }

                ReportProgress();
            }

            segment.Status = SegmentStatus.Completed;
            CheckDynamicSplitOrFinish(ct);
        }

        // IDM-Style dynamic work stealing
        private void CheckDynamicSplitOrFinish(CancellationToken ct)
        {
            lock (_lock)
            {
                DownloadSegment? largest = null;
                long maxRemaining = 0;

                foreach (var seg in _segments.Where(s => s.Status == SegmentStatus.Downloading))
                {
                    long rem = seg.EndByte - seg.CurrentByte;
                    if (rem > maxRemaining && rem > 2 * 1024 * 1024)
                    {
                        maxRemaining = rem;
                        largest = seg;
                    }
                }

                if (largest != null)
                {
                    long remaining = largest.EndByte - largest.CurrentByte;
                    long splitPoint = largest.CurrentByte + (remaining / 2);
                    long oldEnd = largest.EndByte;

                    largest.EndByte = splitPoint;

                    var newSeg = new DownloadSegment
                    {
                        Id = _segments.Count,
                        StartByte = splitPoint + 1,
                        CurrentByte = splitPoint + 1,
                        EndByte = oldEnd,
                        Status = SegmentStatus.Pending
                    };

                    _segments.Add(newSeg);
                    _ = DownloadSegmentAsync(newSeg, ct);
                }
            }
        }

        private async Task DownloadSingleStreamAsync(CancellationToken ct)
        {
            using var res = await _httpClient.GetAsync(Url, HttpCompletionOption.ResponseHeadersRead, ct);
            using var stream = await res.Content.ReadAsStreamAsync(ct);

            byte[] buffer = new byte[64 * 1024];
            int read;
            long writeOffset = 0;

            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct)) > 0)
            {
                if (_fileHandle == null) break;

                await RandomAccess.WriteAsync(_fileHandle, buffer.AsMemory(0, read), writeOffset, ct);
                writeOffset += read;

                if (_segments.Count > 0)
                {
                    _segments[0].CurrentByte += read;
                }

                ReportProgress();
            }
        }

        private void StartSpeedMonitor()
        {
            _lastDownloadedBytes = DownloadedBytes;
            _speedTimer = new Timer(_ =>
            {
                long current = DownloadedBytes;
                _currentSpeed = Math.Max(0, current - _lastDownloadedBytes);
                _lastDownloadedBytes = current;
                ReportProgress();
            }, null, 1000, 1000);
        }

        private void ReportProgress()
        {
            double pct = TotalBytes > 0 ? Math.Min(100.0, (double)DownloadedBytes / TotalBytes * 100.0) : 0;
            OnProgress?.Invoke(new DownloadProgressReport
            {
                Id = Id,
                Filename = Filename,
                DownloadedBytes = DownloadedBytes,
                TotalBytes = TotalBytes,
                Percent = Math.Round(pct, 2),
                SpeedBytesPerSec = _currentSpeed,
                Status = Status,
                SupportsRange = SupportsRange,
                Segments = _segments.ToList()
            });
        }

        public void Dispose()
        {
            _cts?.Cancel();
            _speedTimer?.Dispose();
            _fileHandle?.Dispose();
        }
    }
}
