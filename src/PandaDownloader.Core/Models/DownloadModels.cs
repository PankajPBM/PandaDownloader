using System;
using System.Collections.Generic;

namespace PandaDownloader.Core.Models
{
    public enum TaskStatus
    {
        Idle,
        Probing,
        Downloading,
        Paused,
        Completed,
        Cancelled,
        Error
    }

    public enum SegmentStatus
    {
        Pending,
        Downloading,
        Completed,
        Error
    }

    public class DownloadSegment
    {
        public int Id { get; set; }
        public long StartByte { get; set; }
        public long CurrentByte { get; set; }
        public long EndByte { get; set; }
        public long TotalBytes => EndByte - StartByte + 1;
        public long DownloadedBytes => Math.Max(0, CurrentByte - StartByte);
        public double Percent => TotalBytes > 0 ? Math.Min(100.0, (double)DownloadedBytes / TotalBytes * 100.0) : 0;
        public SegmentStatus Status { get; set; } = SegmentStatus.Pending;
        public int Retries { get; set; }
    }

    public class DownloadProgressReport
    {
        public string Id { get; set; } = string.Empty;
        public string Filename { get; set; } = string.Empty;
        public long DownloadedBytes { get; set; }
        public long TotalBytes { get; set; }
        public double Percent { get; set; }
        public double SpeedBytesPerSec { get; set; }
        public TaskStatus Status { get; set; }
        public bool SupportsRange { get; set; }
        public List<DownloadSegment> Segments { get; set; } = new();
    }
}
