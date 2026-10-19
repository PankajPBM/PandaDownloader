# 🐼 Panda Downloader

> **Developed & Published by [PB Tech Zone](https://prakash77.com.np)**  
> 🌐 **Website:** [https://prakash77.com.np](https://prakash77.com.np)  
> 💬 **WhatsApp Support:** [+977 9814891277](https://wa.me/9779814891277)  
> 📦 **GitHub Repository:** [https://github.com/PankajPBM/PandaDownloader](https://github.com/PankajPBM/PandaDownloader)  
> 🎨 **Themes:** Full Light & Dark Theme with instant 1-click toggle  
> 💾 **Installer:** Production Inno Setup installer script with auto-prerequisites (`installer/PandaDownloader.iss`)

A high-performance, multi-threaded download manager, stream sniffer, and IDM-style dynamic segment acceleration engine built with Electron, React, and .NET 10.

---

## 🚀 Key Architectural Features

### 1. Dynamic File Segmentation Engine
* **Concurrent Multi-Threading:** Spawns 4 to 32 parallel HTTP connections using `Range: bytes=start-end` headers to bypass per-connection server bandwidth limits.
* **Work-Stealing Dynamic Division:** When a fast connection completes its range, Panda Downloader automatically inspects all active threads, finds the segment with the largest remaining byte offset, and splits it dynamically in half to eliminate slow-thread bottlenecks.
* **Direct File-Offset Writing:** Uses direct asynchronous disk writes at exact file offsets (`fs.writeSync(fd, chunk, offset)`), eliminating the time-consuming and CPU-heavy post-download file concatenation step.
* **Session Resumption:** Automatically tracks byte offsets and segment boundaries in `.panda` metadata descriptors, allowing clean pause and resume even across app restarts.

### 2. Universal Browser Video & Audio Sniffer
* **Manifest V3 Extension:** Runs a background service worker monitoring `webRequest.onHeadersReceived` for media streams (`video/mp4`, `video/webm`, HLS `.m3u8`, DASH `.mpd`, etc.).
* **Dynamic Player Overlay:** Automatically injects a floating `🐼 Download Video` button over HTML5 `<video>` and `<audio>` elements across web pages.
* **Dual-Channel Bridge:** Communicates with Panda Downloader via Native Messaging Host and high-speed local loopback API (`http://127.0.0.1:45731`).
* **Clipboard Sniffer:** Detects download links copied to the Windows clipboard and offers a 1-click download toast.

---

## 🛠️ Project Structure

```
Panda Downloader/
├── src/
│   ├── main/
│   │   ├── downloader/
│   │   │   ├── engine.js       # Core multi-part dynamic segmentation engine
│   │   │   └── manager.js      # Concurrency queue & persistent history manager
│   │   ├── native-host/
│   │   │   └── host.js         # Native messaging host script
│   │   ├── preload.js          # Secure Electron IPC bridge
│   │   └── main.js             # Electron main process & local loopback server
│   └── renderer/
│       ├── App.jsx             # Sleek IDM-style segmented visualization dashboard
│       ├── index.css           # Glassmorphism dark theme styling
│       ├── index.html          # HTML5 entrypoint
│       └── main.jsx            # React root
├── extension/
│   ├── manifest.json           # Chrome/Edge Manifest V3 definition
│   ├── background.js           # Network media sniffer service worker
│   ├── content.js              # HTML5 video/audio player overlay injector
│   ├── content.css             # Floating download button styles
│   ├── popup/                  # Detected streams popup panel
│   └── native-messaging/       # Windows registry registration files
├── package.json
└── vite.config.js
```

---

## 💻 How to Build & Run in Visual Studio

You can open and build Panda Downloader directly in Visual Studio using the provided solution files:
* **Classic Solution:** [`PandaDownloader.sln`](file:///d:/Pankaj/Project/Panda%20Downloader/PandaDownloader.sln)
* **Modern .NET 10 Solution:** [`PandaDownloader.slnx`](file:///d:/Pankaj/Project/Panda%20Downloader/PandaDownloader.slnx)

### 1. Build from Visual Studio or CLI:
* Press **Ctrl+Shift+B** in Visual Studio, or run:
```bash
dotnet build PandaDownloader.sln
```

### 2. Run All Tests from Test Explorer or CLI:
* Open **Test Explorer** (Ctrl+E, T) and click **Run All**, or run:
```bash
dotnet test PandaDownloader.sln
```

### 3. Run the Application:
* Press **F5** in Visual Studio to launch the complete Panda Downloader Desktop App!
* Or run high-speed multi-threaded downloads from terminal:
```bash
dotnet run --project src/PandaDownloader.App -- "https://example.com/video.mp4" 16
```

---

## 💻 How to Run (Node / Electron CLI)

### 1. Launch the Desktop Application

```bash
# Build the React frontend
npm run build:renderer

# Launch Panda Downloader
npm start
```

For live development with hot module reloading:
```bash
npm run app:dev
```

### 2. Install the Browser Extension (Chrome or Microsoft Edge)

1. Open your Chromium browser and navigate to:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
2. Enable **Developer mode** (toggle in top-right or sidebar).
3. Click **Load unpacked** and select the `extension` folder located inside this project directory (`d:\Pankaj\Project\Panda Downloader\extension`).
4. (Optional) Run `extension/native-messaging/install-host.bat` as Administrator if you want to register the native messaging host directly in the Windows registry.

---

## 🧪 Testing the Multi-Part Engine

Run the included automated multi-segment download verification:

```bash
node tests/test-engine.js
```
