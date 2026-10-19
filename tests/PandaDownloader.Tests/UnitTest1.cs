using System;
using System.IO;
using System.Threading.Tasks;
using PandaDownloader.Core;
using PandaDownloader.Core.Models;
using Xunit;

namespace PandaDownloader.Tests
{
    public class DownloadEngineTests
    {
        [Fact]
        public void TestSegmentPercentageCalculation()
        {
            var segment = new DownloadSegment
            {
                Id = 0,
                StartByte = 0,
                CurrentByte = 500,
                EndByte = 999
            };

            Assert.Equal(1000, segment.TotalBytes);
            Assert.Equal(500, segment.DownloadedBytes);
            Assert.Equal(50.0, segment.Percent);
        }

        [Fact]
        public void TestThreadCountClamping()
        {
            var engineMin = new DownloadEngine("https://example.com/file.bin", connectionsCount: -5);
            Assert.Equal(1, engineMin.ConnectionsCount);

            var engineMax = new DownloadEngine("https://example.com/file.bin", connectionsCount: 128);
            Assert.Equal(32, engineMax.ConnectionsCount);

            var engineNormal = new DownloadEngine("https://example.com/file.bin", connectionsCount: 16);
            Assert.Equal(16, engineNormal.ConnectionsCount);
        }

        [Fact]
        public async Task TestLiveMultiSegmentDownload()
        {
            // Public test endpoint with Range support
            string testUrl = "https://proof.ovh.net/files/10Mb.dat";
            string tempDir = Path.Combine(Path.GetTempPath(), $"PandaTest_{Guid.NewGuid():N}");

            try
            {
                using var engine = new DownloadEngine(testUrl, saveDirectory: tempDir, connectionsCount: 8, customFilename: "test_10mb.dat");

                bool completed = false;
                string downloadedPath = string.Empty;

                engine.OnCompleted += (path, size) =>
                {
                    completed = true;
                    downloadedPath = path;
                };

                await engine.StartAsync();

                Assert.True(completed, "Download should report completed status");
                Assert.True(File.Exists(downloadedPath), "Downloaded file must exist on disk");

                var fileInfo = new FileInfo(downloadedPath);
                Assert.Equal(10485760, fileInfo.Length);
            }
            finally
            {
                if (Directory.Exists(tempDir))
                {
                    try { Directory.Delete(tempDir, true); } catch { }
                }
            }
        }
    }
}
