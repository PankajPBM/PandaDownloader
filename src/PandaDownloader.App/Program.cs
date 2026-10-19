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
            // If URL passed as command line argument, run high-speed engine directly
            if (args.Length > 0 && (args[0].StartsWith("http://") || args[0].StartsWith("https://")))
            {
                string url = args[0];
                int threads = args.Length > 1 && int.TryParse(args[1], out int t) ? t : 8;

                using var engine = new DownloadEngine(url, connectionsCount: threads);
                await engine.StartAsync();
                return;
            }

            // Visual Studio F5 / GUI Launcher: Launch Electron background process silently
            string projectRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
            if (!File.Exists(Path.Combine(projectRoot, "package.json")))
            {
                projectRoot = Directory.GetCurrentDirectory();
            }

            string packagedExe = Path.Combine(projectRoot, "release", "PandaDownloader-win32-x64", "PandaDownloader.exe");
            string electronDistExe = Path.Combine(projectRoot, "node_modules", "electron", "dist", "electron.exe");

            ProcessStartInfo psi;
            string extraArgs = string.Join(" ", args);

            if (File.Exists(packagedExe))
            {
                psi = new ProcessStartInfo
                {
                    FileName = packagedExe,
                    Arguments = extraArgs,
                    WorkingDirectory = projectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
            }
            else if (File.Exists(electronDistExe))
            {
                psi = new ProcessStartInfo
                {
                    FileName = electronDistExe,
                    Arguments = string.IsNullOrEmpty(extraArgs) ? "." : $". {extraArgs}",
                    WorkingDirectory = projectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
            }
            else
            {
                // Fallback to npm without console window
                psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c npm start",
                    WorkingDirectory = projectRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
            }

            try
            {
                var proc = Process.Start(psi);
                if (proc != null)
                {
                    await proc.WaitForExitAsync();
                }
            }
            catch (Exception)
            {
                // Ignore any GUI exit errors
            }
        }
    }
}
