using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using PandaDownloader.Core;

namespace PandaDownloader.App
{
    internal class Program
    {
        static async Task Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.WriteLine("🐼 =========================================");
            Console.WriteLine("🐼   PANDA DOWNLOADER (.NET 10 & Electron)  ");
            Console.WriteLine("🐼 =========================================\n");

            if (args.Length > 0 && (args[0].StartsWith("http://") || args[0].StartsWith("https://")))
            {
                // CLI Download Mode
                string url = args[0];
                int threads = args.Length > 1 && int.TryParse(args[1], out int t) ? t : 8;

                Console.WriteLine($"Initiating High-Speed Download...");
                Console.WriteLine($"URL:     {url}");
                Console.WriteLine($"Threads: {threads}\n");

                using var engine = new DownloadEngine(url, connectionsCount: threads);

                engine.OnProgress += (report) =>
                {
                    double mbSec = report.SpeedBytesPerSec / (1024 * 1024);
                    Console.Write($"\r[Progress] {report.Percent:F1}% | Speed: {mbSec:F2} MB/s | Size: {report.DownloadedBytes / (1024 * 1024):F1}/{report.TotalBytes / (1024 * 1024):F1} MB | Segments: {report.Segments.Count}   ");
                };

                engine.OnCompleted += (path, size) =>
                {
                    Console.WriteLine($"\n\n[SUCCESS] Completed successfully!");
                    Console.WriteLine($"Saved to: {path}");
                    Console.WriteLine($"Total:    {size / (1024 * 1024):F2} MB");
                };

                engine.OnError += (err) =>
                {
                    Console.WriteLine($"\n[ERROR] Download failed: {err.Message}");
                };

                await engine.StartAsync();
            }
            else
            {
                // Visual Studio F5 / GUI Launcher Mode
                string projectRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
                if (!File.Exists(Path.Combine(projectRoot, "package.json")))
                {
                    projectRoot = Directory.GetCurrentDirectory();
                }

                Console.WriteLine($"Project Root: {projectRoot}");
                Console.WriteLine("Launching Panda Downloader Desktop Dashboard...\n");

                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm start",
                    WorkingDirectory = projectRoot,
                    UseShellExecute = true
                };

                try
                {
                    var proc = Process.Start(psi);
                    Console.WriteLine("Desktop Application process started.");
                    if (proc != null)
                    {
                        await proc.WaitForExitAsync();
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Could not launch Electron GUI: {ex.Message}");
                    Console.WriteLine("You can also run downloads directly from CLI:");
                    Console.WriteLine("  PandaDownloader.App.exe <url> [threads]");
                }
            }
        }
    }
}
