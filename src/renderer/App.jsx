import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, X, Folder, File, Plus, Download, 
  Trash2, ShieldCheck, Activity, Globe, HardDrive, 
  Minus, Square, Copy, CheckCircle, Settings, Layers,
  ExternalLink, Zap, Check, Music, Video, Archive,
  FileText, Cpu, AlertCircle, Sun, Moon, Phone, MessageCircle
} from 'lucide-react';

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('panda_theme') || 'dark');
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activePopupTask, setActivePopupTask] = useState(null);
  const [completionTask, setCompletionTask] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }
  const [deleteFileFromDisk, setDeleteFileFromDisk] = useState(false);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('panda_theme', next);
  };

  const handleOpenLink = (url) => {
    if (window.pandaAPI && window.pandaAPI.openExternal) {
      window.pandaAPI.openExternal(url);
    } else {
      window.open(url, '_blank');
    }
  };

  // New task form state
  const [newUrl, setNewUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [connectionsCount, setConnectionsCount] = useState(16);
  const [targetSaveDir, setTargetSaveDir] = useState('');

  // Batch task form state
  const [batchInput, setBatchInput] = useState('');
  const [batchThreads, setBatchThreads] = useState(8);

  // Settings state
  const [settings, setSettings] = useState({
    defaultSaveDir: '',
    autoCategorize: true,
    autoAcceptDownloads: false,
    defaultThreads: 16,
    maxConcurrent: 4,
    minimizeToTray: true,
    capturedExtensions: []
  });
  const [extensionsInput, setExtensionsInput] = useState('');

  const [totalSpeed, setTotalSpeed] = useState(0);
  const [clipboardPrompt, setClipboardPrompt] = useState(null);

  // Load initial tasks & settings & setup IPC listeners
  useEffect(() => {
    if (window.pandaAPI) {
      window.pandaAPI.getAllTasks().then(data => {
        if (data) {
          setTasks(data.active || []);
          setHistory(data.history || []);
        }
      });

      window.pandaAPI.getSettings().then(s => {
        if (s) {
          setSettings(s);
          setConnectionsCount(s.defaultThreads || 16);
          setTargetSaveDir(s.defaultSaveDir || '');
          setExtensionsInput((s.capturedExtensions || []).join(', '));
        }
      });

      const unsubProgress = window.pandaAPI.onProgress((prog) => {
        setTasks(prev => prev.map(t => {
          if (t.id === prog.id) {
            const updated = { ...t, ...prog };
            // Keep popup synced if open
            setActivePopupTask(curr => curr && curr.id === prog.id ? updated : curr);
            return updated;
          }
          return t;
        }));
      });

      const unsubSpeed = window.pandaAPI.onSpeed((data) => {
        setTasks(prev => {
          const updated = prev.map(t => {
            if (t.id === data.progress.id) {
              const u = { ...t, ...data.progress };
              setActivePopupTask(curr => curr && curr.id === u.id ? u : curr);
              return u;
            }
            return t;
          });
          const total = updated.reduce((acc, t) => acc + (t.status === 'downloading' ? (t.speed || 0) : 0), 0);
          setTotalSpeed(total);
          return updated;
        });
      });

      const unsubStatus = window.pandaAPI.onStatus((data) => {
        setTasks(prev => {
          const exists = prev.some(t => t.id === data.id);
          if (exists) {
            return prev.map(t => t.id === data.id ? { ...t, status: data.status } : t);
          }
          const list = [data.task, ...prev];
          // Open IDM progress popup for new downloading task
          if (data.task && data.task.status === 'downloading') {
            setActivePopupTask(data.task);
          }
          return list;
        });
      });

      const unsubCompleted = window.pandaAPI.onCompleted((data) => {
        setTasks(prev => prev.filter(t => t.id !== data.id));
        setHistory(prev => [{ ...data, status: 'completed' }, ...prev]);
        setCompletionTask(data);
        setActivePopupTask(curr => curr && curr.id === data.id ? null : curr);
      });

      const unsubClipboard = window.pandaAPI.onClipboardDetected((data) => {
        setClipboardPrompt(data.url);
      });

      const unsubBrowser = window.pandaAPI.onBrowserIntercepted((data) => {
        if (data && data.original) {
          setNewUrl(data.original.url || '');
          setCustomTitle(data.original.filename || '');
          setShowAddModal(true);
        } else if (data && data.task) {
          setTasks(prev => [data.task, ...prev]);
          setActivePopupTask(data.task);
        }
      });

      const unsubDeleted = window.pandaAPI.onTaskDeleted((data) => {
        setTasks(prev => prev.filter(t => t.id !== data.id));
        setHistory(prev => prev.filter(t => t.id !== data.id));
        setActivePopupTask(curr => curr && curr.id === data.id ? null : curr);
      });

      const unsubOpenAdd = window.pandaAPI.onOpenAddModal(() => setShowAddModal(true));
      const unsubOpenSettings = window.pandaAPI.onOpenSettingsModal(() => setShowSettingsModal(true));

      return () => {
        unsubProgress();
        unsubSpeed();
        unsubStatus();
        unsubCompleted();
        unsubClipboard();
        unsubBrowser();
        unsubDeleted();
        unsubOpenAdd();
        unsubOpenSettings();
      };
    } else {
      // Mock tasks for development preview
      const demoTask = {
        id: 'demo_1',
        filename: 'Ubuntu-24.04-desktop-amd64.iso',
        status: 'downloading',
        downloadedBytes: 2450000000,
        totalBytes: 5120000000,
        percent: 47.8,
        speed: 18450000,
        eta: 144,
        connectionsCount: 8,
        supportsRange: true,
        savePath: 'C:\\Users\\Bivek\\Downloads\\PandaDownloads\\Compressed\\Ubuntu-24.04.iso',
        segments: Array.from({ length: 8 }, (_, i) => ({
          id: i,
          percent: Math.min(100, Math.floor(20 + i * 10)),
          status: 'downloading',
          start: i * 640000000,
          current: i * 640000000 + 300000000,
          end: (i + 1) * 640000000
        }))
      };
      setTasks([demoTask]);
      setTotalSpeed(18450000);
      setSettings({
        defaultSaveDir: 'C:\\Users\\Bivek\\Downloads\\PandaDownloads',
        autoCategorize: true,
        autoAcceptDownloads: true,
        defaultThreads: 16,
        maxConcurrent: 4,
        minimizeToTray: true,
        capturedExtensions: ['mp4', 'mkv', 'webm', 'zip', 'rar', '7z', 'iso', 'exe']
      });
      setExtensionsInput('mp4, mkv, webm, zip, rar, 7z, iso, exe');
    }
  }, []);

  // Handlers
  const handleStartDownload = async () => {
    if (!newUrl.trim()) return;
    if (window.pandaAPI) {
      const task = await window.pandaAPI.addTask({
        url: newUrl.trim(),
        filename: customTitle.trim() || undefined,
        connectionsCount: connectionsCount,
        saveDirectory: targetSaveDir.trim() || undefined
      });
      if (task) {
        setActivePopupTask(task);
      }
    }
    setNewUrl('');
    setCustomTitle('');
    setShowAddModal(false);
  };

  const handleStartBatch = async () => {
    const lines = batchInput.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    if (window.pandaAPI) {
      await window.pandaAPI.addBatchTasks({
        urls: lines,
        connectionsCount: batchThreads,
        saveDirectory: targetSaveDir.trim() || undefined
      });
      const data = await window.pandaAPI.getAllTasks();
      if (data) setTasks(data.active || []);
    }
    setBatchInput('');
    setShowBatchModal(false);
  };

  const handlePause = (id) => {
    if (window.pandaAPI) window.pandaAPI.pauseTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'paused', speed: 0 } : t));
    setActivePopupTask(curr => curr && curr.id === id ? { ...curr, status: 'paused', speed: 0 } : curr);
  };

  const handleResume = (id) => {
    if (window.pandaAPI) window.pandaAPI.resumeTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'downloading' } : t));
    setActivePopupTask(curr => curr && curr.id === id ? { ...curr, status: 'downloading' } : curr);
  };

  const promptDelete = (task) => {
    setDeleteTarget({ id: task.id, name: task.filename || task.url });
    setDeleteFileFromDisk(false);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (window.pandaAPI) {
      await window.pandaAPI.deleteTask(deleteTarget.id, deleteFileFromDisk);
    }
    setTasks(prev => prev.filter(t => t.id !== deleteTarget.id));
    setHistory(prev => prev.filter(t => t.id !== deleteTarget.id));
    if (activePopupTask && activePopupTask.id === deleteTarget.id) {
      setActivePopupTask(null);
    }
    setDeleteTarget(null);
  };

  const handleOpenFile = (filePath) => {
    if (window.pandaAPI && filePath) window.pandaAPI.openFile(filePath);
  };

  const handleOpenFolder = (filePath) => {
    if (window.pandaAPI && filePath) window.pandaAPI.openFolder(filePath);
  };

  const handleSelectDirectory = async () => {
    if (window.pandaAPI) {
      const dir = await window.pandaAPI.selectDirectory();
      if (dir) {
        setTargetSaveDir(dir);
        setSettings(prev => ({ ...prev, defaultSaveDir: dir }));
      }
    }
  };

  const handleSaveSettings = async () => {
    const exts = extensionsInput.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const updated = {
      ...settings,
      defaultSaveDir: targetSaveDir,
      defaultThreads: connectionsCount,
      capturedExtensions: exts
    };
    if (window.pandaAPI) {
      await window.pandaAPI.saveSettings(updated);
    }
    setSettings(updated);
    setShowSettingsModal(false);
  };

  const toggleAutoAccept = async () => {
    const val = !settings.autoAcceptDownloads;
    const updated = { ...settings, autoAcceptDownloads: val };
    setSettings(updated);
    if (window.pandaAPI) {
      await window.pandaAPI.saveSettings(updated);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSec) => {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    if (bytesPerSec > 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
    }
    return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  };

  const formatETA = (seconds) => {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = Math.round(seconds % 60);
      return `${m}m ${s}s`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  // Filter tasks by active category and search
  const allItems = [...tasks, ...history];
  const filteredTasks = allItems.filter(item => {
    const name = (item.filename || item.url || '').toLowerCase();
    if (searchQuery && !name.includes(searchQuery.toLowerCase())) return false;

    if (activeCategory === 'active') return tasks.some(t => t.id === item.id);
    if (activeCategory === 'completed') return item.status === 'completed';
    if (activeCategory === 'videos') return /\.(mp4|webm|mkv|mov|avi|flv|m3u8|mpd)$/i.test(name);
    if (activeCategory === 'audio') return /\.(mp3|wav|m4a|flac|aac|ogg|opus)$/i.test(name);
    if (activeCategory === 'compressed') return /\.(zip|rar|7z|tar|gz|iso|bz2)$/i.test(name);
    if (activeCategory === 'programs') return /\.(exe|msi|apk|dmg|pkg)$/i.test(name);
    if (activeCategory === 'documents') return /\.(pdf|docx?|xlsx?|pptx?|txt)$/i.test(name);
    return true;
  });

  return (
    <div data-theme={theme} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Title Bar */}
      <div className="titlebar">
        <div className="titlebar-brand">
          <span className="logo-icon">🐼</span>
          <span>Panda Downloader</span>
          <span className="badge">IDM ENGINE</span>
          <span 
            className="badge" 
            style={{ cursor: 'pointer', background: 'rgba(6, 182, 212, 0.15)', color: 'var(--accent-cyan)' }} 
            onClick={() => handleOpenLink('https://prakash77.com.np')} 
            title="Developed by PB Tech Zone"
          >
            by PB Tech Zone
          </span>
        </div>
        <div className="titlebar-controls">
          <button 
            className="titlebar-btn" 
            onClick={toggleTheme} 
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button className="titlebar-btn" onClick={() => window.pandaAPI && window.pandaAPI.minimize()} title="Minimize">
            <Minus size={14} />
          </button>
          <button className="titlebar-btn" onClick={() => window.pandaAPI && window.pandaAPI.maximize()} title="Maximize">
            <Square size={12} />
          </button>
          <button className="titlebar-btn close" onClick={() => window.pandaAPI && window.pandaAPI.close()} title="Close to Tray">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="app-container">
        {/* Sidebar */}
        <div className="sidebar">
          <div>
            <div className="sidebar-section-title">Categories</div>
            <div className="sidebar-nav">
              <div 
                className={`nav-item ${activeCategory === 'all' ? 'active' : ''}`}
                onClick={() => setActiveCategory('all')}
              >
                <div className="nav-item-left">
                  <Globe size={16} />
                  <span>All Downloads</span>
                </div>
                <span className="nav-count">{allItems.length}</span>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'active' ? 'active' : ''}`}
                onClick={() => setActiveCategory('active')}
              >
                <div className="nav-item-left">
                  <Activity size={16} />
                  <span>Downloading</span>
                </div>
                <span className="nav-count">{tasks.length}</span>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'completed' ? 'active' : ''}`}
                onClick={() => setActiveCategory('completed')}
              >
                <div className="nav-item-left">
                  <CheckCircle size={16} />
                  <span>Completed</span>
                </div>
                <span className="nav-count">{history.length}</span>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'videos' ? 'active' : ''}`}
                onClick={() => setActiveCategory('videos')}
              >
                <div className="nav-item-left">
                  <Video size={16} />
                  <span>Video & Streams</span>
                </div>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'audio' ? 'active' : ''}`}
                onClick={() => setActiveCategory('audio')}
              >
                <div className="nav-item-left">
                  <Music size={16} />
                  <span>Music & Audio</span>
                </div>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'compressed' ? 'active' : ''}`}
                onClick={() => setActiveCategory('compressed')}
              >
                <div className="nav-item-left">
                  <Archive size={16} />
                  <span>Compressed / ZIP</span>
                </div>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'programs' ? 'active' : ''}`}
                onClick={() => setActiveCategory('programs')}
              >
                <div className="nav-item-left">
                  <Cpu size={16} />
                  <span>Programs / APK</span>
                </div>
              </div>
              <div 
                className={`nav-item ${activeCategory === 'documents' ? 'active' : ''}`}
                onClick={() => setActiveCategory('documents')}
              >
                <div className="nav-item-left">
                  <FileText size={16} />
                  <span>Documents</span>
                </div>
              </div>
            </div>
          </div>

          <div className="sidebar-footer">
            <div className="sniffer-status">
              <div className="status-dot"></div>
              <span>Browser Sniffer Active</span>
            </div>
            <div className="sniffer-desc">Background daemon port 45731 • Intercepts all media</div>

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                PB Tech Zone
              </div>
              <div 
                onClick={() => handleOpenLink('https://prakash77.com.np')} 
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent-cyan)', cursor: 'pointer' }}
                title="Visit prakash77.com.np"
              >
                <Globe size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>prakash77.com.np</span>
                <ExternalLink size={10} />
              </div>
              <div 
                onClick={() => handleOpenLink('https://wa.me/9779814891277')} 
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--accent-emerald)', cursor: 'pointer' }}
                title="Contact via WhatsApp"
              >
                <MessageCircle size={13} />
                <span>+977 9814891277</span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="main-content">
          {/* Top Toolbar */}
          <div className="toolbar">
            <div className="toolbar-left">
              <button className="btn-primary" onClick={() => setShowAddModal(true)}>
                <Plus size={16} />
                <span>Add Download</span>
              </button>
              <button className="btn-secondary" onClick={() => setShowBatchModal(true)}>
                <Layers size={15} />
                <span>Bulk / Batch</span>
              </button>
              <button className="btn-secondary" onClick={() => tasks.forEach(t => handleResume(t.id))}>
                <Play size={14} />
                <span>Resume All</span>
              </button>
              <button className="btn-secondary" onClick={() => tasks.forEach(t => handlePause(t.id))}>
                <Pause size={14} />
                <span>Pause All</span>
              </button>
              <button 
                className={`toolbar-toggle-btn ${settings.autoAcceptDownloads ? 'active' : ''}`}
                onClick={toggleAutoAccept}
                title="When ON, browser downloads start immediately without prompt"
              >
                <Zap size={14} color={settings.autoAcceptDownloads ? '#10b981' : '#94a3b8'} />
                <span>Auto-Accept: {settings.autoAcceptDownloads ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            <div className="toolbar-right">
              <button className="btn-secondary" onClick={() => setShowSettingsModal(true)} title="Settings">
                <Settings size={15} />
                <span>Settings</span>
              </button>
              <div className="speed-gauge">
                <Activity size={16} color="#10b981" />
                <div>
                  <div className="speed-val">{formatSpeed(totalSpeed)}</div>
                  <div className="speed-label">Aggregate Bandwidth</div>
                </div>
              </div>
            </div>
          </div>

          {/* Download Items Viewport */}
          <div className="downloads-viewport">
            {filteredTasks.length === 0 ? (
              <div className="empty-view">
                <div className="empty-icon">🐼</div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>No Downloads in this View</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>
                  Click "Add Download", "Bulk / Batch", or catch videos directly from Chrome & Edge
                </div>
              </div>
            ) : (
              filteredTasks.map((task) => (
                <div 
                  key={task.id} 
                  className="download-card"
                  onClick={() => setActivePopupTask(task)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card-header">
                    <div className="card-title-group">
                      <div className="file-icon">
                        <Download size={20} />
                      </div>
                      <div className="file-meta-col">
                        <div className="file-name" title={task.filename || task.url}>
                          {task.filename || task.url}
                        </div>
                        <div className="file-details">
                          <span>{formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}</span>
                          <span>•</span>
                          <span>{task.percent || 0}%</span>
                          {task.status === 'downloading' && (
                            <>
                              <span>•</span>
                              <span style={{ color: '#10b981', fontWeight: 600 }}>{formatSpeed(task.speed)}</span>
                              <span>•</span>
                              <span>ETA: {formatETA(task.eta)}</span>
                            </>
                          )}
                          <span>•</span>
                          <span className={`status-tag ${task.status}`}>{task.status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="card-actions" onClick={e => e.stopPropagation()}>
                      {task.status === 'downloading' ? (
                        <button className="action-btn" title="Pause" onClick={() => handlePause(task.id)}>
                          <Pause size={14} />
                        </button>
                      ) : task.status === 'paused' ? (
                        <button className="action-btn" title="Resume" onClick={() => handleResume(task.id)}>
                          <Play size={14} />
                        </button>
                      ) : null}

                      {task.filePath && (
                        <>
                          <button className="action-btn" title="Open File" onClick={() => handleOpenFile(task.filePath)}>
                            <File size={14} />
                          </button>
                          <button className="action-btn" title="Open Folder" onClick={() => handleOpenFolder(task.filePath)}>
                            <Folder size={14} />
                          </button>
                        </>
                      )}

                      <button className="action-btn delete" title="Delete Download" onClick={() => promptDelete(task)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Master Progress Bar */}
                  <div className="master-progress-track">
                    <div 
                      className="master-progress-fill" 
                      style={{ width: `${Math.min(100, task.percent || 0)}%` }}
                    />
                  </div>

                  {/* Segments Preview Mini */}
                  {task.segments && task.segments.length > 0 && (
                    <div className="segments-container" style={{ marginTop: 8 }}>
                      <div className="segments-header">
                        <span>Dynamic Multi-Segment Streams ({task.segments.length} Connections)</span>
                        <span>{task.supportsRange ? 'Range Accelerated' : 'Single Stream'}</span>
                      </div>
                      <div className="segments-grid">
                        {task.segments.map((seg, idx) => (
                          <div 
                            key={idx} 
                            className={`segment-capsule ${seg.status === 'downloading' ? 'active' : ''}`}
                            title={`Thread ${idx + 1}: ${seg.percent || 0}%`}
                          >
                            <div 
                              className="segment-fill" 
                              style={{ width: `${Math.min(100, seg.percent || 0)}%` }}
                            />
                            <div className="segment-label">
                              T{idx + 1}: {Math.floor(seg.percent || 0)}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1. ICONIC IDM DOWNLOAD PROGRESS POPUP WINDOW */}
      {/* ============================================================== */}
      {activePopupTask && (
        <div className="modal-backdrop" onClick={() => setActivePopupTask(null)}>
          <div className="idm-popup-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚡</span>
                <div>
                  <div className="modal-title">Download Status: {activePopupTask.filename || 'File'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Dynamic Range Segmentation Engine</div>
                </div>
              </div>
              <button className="titlebar-btn" onClick={() => setActivePopupTask(null)} title="Hide to Background">
                <Minus size={16} />
              </button>
            </div>

            {/* IDM Grid Info */}
            <div className="idm-grid">
              <span className="idm-grid-label">File Name:</span>
              <span className="idm-grid-value" title={activePopupTask.filename}>{activePopupTask.filename || activePopupTask.url}</span>

              <span className="idm-grid-label">Status:</span>
              <span className="idm-grid-value" style={{ textTransform: 'capitalize', color: activePopupTask.status === 'downloading' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                {activePopupTask.status}
              </span>

              <span className="idm-grid-label">File Size:</span>
              <span className="idm-grid-value">{formatBytes(activePopupTask.totalBytes)}</span>

              <span className="idm-grid-label">Downloaded:</span>
              <span className="idm-grid-value">{formatBytes(activePopupTask.downloadedBytes)} ({activePopupTask.percent || 0}%)</span>

              <span className="idm-grid-label">Transfer Rate:</span>
              <span className="idm-grid-value" style={{ color: '#06b6d4', fontWeight: 700 }}>
                {activePopupTask.status === 'downloading' ? formatSpeed(activePopupTask.speed) : '0 KB/s'}
              </span>

              <span className="idm-grid-label">Time Left (ETA):</span>
              <span className="idm-grid-value">{formatETA(activePopupTask.eta)}</span>

              <span className="idm-grid-label">Resume Capability:</span>
              <span className="idm-grid-value" style={{ color: activePopupTask.supportsRange ? '#10b981' : '#f59e0b' }}>
                {activePopupTask.supportsRange ? '✓ Yes (HTTP Range)' : 'Limited / Single Stream'}
              </span>

              {activePopupTask.filePath && (
                <>
                  <span className="idm-grid-label">Save To:</span>
                  <span className="idm-grid-value" title={activePopupTask.filePath}>{activePopupTask.filePath}</span>
                </>
              )}
            </div>

            {/* Master Shimmer Progress Bar */}
            <div className="idm-shimmer-track">
              <div 
                className="idm-shimmer-fill" 
                style={{ width: `${Math.min(100, activePopupTask.percent || 0)}%` }}
              />
              <div className="idm-shimmer-text">
                {activePopupTask.percent || 0}% Completed
              </div>
            </div>

            {/* Active Connections Dynamic Streams */}
            {activePopupTask.segments && activePopupTask.segments.length > 0 && (
              <div className="idm-segments-panel">
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
                  Active Segment Streams ({activePopupTask.segments.length} Threads)
                </div>
                {activePopupTask.segments.map((seg, idx) => (
                  <div key={idx} className="idm-segment-row">
                    <span style={{ width: 65, color: '#94a3b8' }}>Conn {idx + 1}:</span>
                    <div className="idm-segment-bar">
                      <div className="idm-segment-fill" style={{ width: `${Math.min(100, seg.percent || 0)}%` }} />
                    </div>
                    <span style={{ width: 45, textAlign: 'right', color: '#f8fafc' }}>{Math.floor(seg.percent || 0)}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Popup Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {activePopupTask.status === 'downloading' ? (
                  <button className="btn-secondary" onClick={() => handlePause(activePopupTask.id)}>
                    <Pause size={14} />
                    <span>Pause</span>
                  </button>
                ) : (
                  <button className="btn-primary" onClick={() => handleResume(activePopupTask.id)}>
                    <Play size={14} />
                    <span>Resume</span>
                  </button>
                )}

                {activePopupTask.filePath && (
                  <button className="btn-secondary" onClick={() => handleOpenFolder(activePopupTask.filePath)}>
                    <Folder size={14} />
                    <span>Open Folder</span>
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setActivePopupTask(null)}>
                  Hide to Background
                </button>
                <button className="btn-secondary" style={{ color: '#f43f5e', borderColor: 'rgba(244, 63, 94, 0.3)' }} onClick={() => promptDelete(activePopupTask)}>
                  <Trash2 size={14} />
                  <span>Cancel & Delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. DOWNLOAD FILE INFO MODAL (IDM PROMPT) */}
      {/* ============================================================== */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📥</span>
                <div className="modal-title">Download File Info</div>
              </div>
              <button className="titlebar-btn" onClick={() => setShowAddModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">URL / Video Stream Address</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="https://... or YouTube video link"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Save As Filename</label>
              <input 
                type="text" 
                className="form-input" 
                placeholder="Leave blank to auto-detect filename from server or video title"
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Save To Directory</label>
              <div className="dir-picker-row">
                <input 
                  type="text" 
                  className="form-input dir-picker-input" 
                  value={targetSaveDir || settings.defaultSaveDir}
                  onChange={e => setTargetSaveDir(e.target.value)}
                  placeholder="Default Category Folder"
                />
                <button className="btn-secondary" onClick={handleSelectDirectory}>
                  <Folder size={14} />
                  <span>Browse...</span>
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Parallel Segmentation Threads (IDM Acceleration)</label>
              <div className="threads-selector">
                {[4, 8, 16, 32].map(num => (
                  <div 
                    key={num} 
                    className={`thread-option ${connectionsCount === num ? 'selected' : ''}`}
                    onClick={() => setConnectionsCount(num)}
                  >
                    {num} Threads
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button className="btn-secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleStartDownload}>
                <Download size={16} />
                <span>Start Download</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. BULK / BATCH DOWNLOADER MODAL */}
      {/* ============================================================== */}
      {showBatchModal && (
        <div className="modal-backdrop" onClick={() => setShowBatchModal(false)}>
          <div className="modal-card" style={{ width: 620 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>📦</span>
                <div className="modal-title">Batch / Bulk Downloader</div>
              </div>
              <button className="titlebar-btn" onClick={() => setShowBatchModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">
                Enter URLs (One per line) or Wildcard Pattern (e.g. <code>https://domain.com/file[01-10].zip</code>):
              </label>
              <textarea
                className="batch-textarea"
                placeholder="https://example.com/file1.zip&#10;https://example.com/file2.zip&#10;or: https://example.com/part[01-05].rar"
                value={batchInput}
                onChange={e => setBatchInput(e.target.value)}
                rows={5}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Threads Per Task</label>
              <div className="threads-selector">
                {[4, 8, 16].map(num => (
                  <div 
                    key={num} 
                    className={`thread-option ${batchThreads === num ? 'selected' : ''}`}
                    onClick={() => setBatchThreads(num)}
                  >
                    {num} Threads
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Detected {batchInput.split('\n').filter(Boolean).length} input entries
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn-secondary" onClick={() => setShowBatchModal(false)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={handleStartBatch}>
                  <Download size={16} />
                  <span>Start Batch Download</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 4. SETTINGS MODAL */}
      {/* ============================================================== */}
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-card settings-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>⚙️</span>
                <div className="modal-title">Panda Downloader Options</div>
              </div>
              <button className="titlebar-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={16} />
              </button>
            </div>

            {/* General Section */}
            <div className="settings-group">
              <div className="settings-group-title">File Saving & Folders</div>
              <div className="form-group">
                <label className="form-label">Default Save Directory</label>
                <div className="dir-picker-row">
                  <input 
                    type="text" 
                    className="form-input dir-picker-input" 
                    value={targetSaveDir || settings.defaultSaveDir}
                    onChange={e => setTargetSaveDir(e.target.value)}
                  />
                  <button className="btn-secondary" onClick={handleSelectDirectory}>
                    <Folder size={14} />
                    <span>Browse...</span>
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>Auto-Categorize into Subfolders</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Saves into Video/, Audio/, Compressed/, Programs/, Documents/</div>
                </div>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={settings.autoCategorize}
                    onChange={e => setSettings(prev => ({ ...prev, autoCategorize: e.target.checked }))}
                  />
                  <span className="slider"></span>
                </label>
              </div>
            </div>

            {/* Interception & Background Section */}
            <div className="settings-group">
              <div className="settings-group-title">Interception & Daemon</div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>⚡ Auto-Accept Downloads</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    Start downloads immediately from browser without confirmation dialog
                  </div>
                </div>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={settings.autoAcceptDownloads}
                    onChange={e => setSettings(prev => ({ ...prev, autoAcceptDownloads: e.target.checked }))}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>Minimize to System Tray</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Keep running in background when window is closed</div>
                </div>
                <label className="switch">
                  <input 
                    type="checkbox" 
                    checked={settings.minimizeToTray}
                    onChange={e => setSettings(prev => ({ ...prev, minimizeToTray: e.target.checked }))}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              <div className="form-group">
                <label className="form-label">Captured File Types & Extensions (Comma-separated)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={extensionsInput}
                  onChange={e => setExtensionsInput(e.target.value)}
                />
              </div>
            </div>

            {/* Connection Section */}
            <div className="settings-group">
              <div className="settings-group-title">Connection & Performance</div>
              <div className="form-group">
                <label className="form-label">Default Acceleration Connections</label>
                <div className="threads-selector">
                  {[4, 8, 16, 32].map(num => (
                    <div 
                      key={num} 
                      className={`thread-option ${connectionsCount === num ? 'selected' : ''}`}
                      onClick={() => setConnectionsCount(num)}
                    >
                      {num} Threads
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Publisher & Support Section */}
            <div className="settings-group">
              <div className="settings-group-title">Publisher & Support</div>
              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>Publisher / Developer</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>PB Tech Zone</div>
                </div>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleOpenLink('https://prakash77.com.np')}>
                  <Globe size={12} />
                  <span>Website</span>
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>WhatsApp Direct Support</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>+977 9814891277</div>
                </div>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--accent-emerald)', borderColor: 'rgba(16, 185, 129, 0.3)' }} onClick={() => handleOpenLink('https://wa.me/9779814891277')}>
                  <MessageCircle size={12} />
                  <span>WhatsApp</span>
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>Interface Theme</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Active: {theme.toUpperCase()} MODE</div>
                </div>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={toggleTheme}>
                  {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
                  <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'}</span>
                </button>
              </div>

              <div className="settings-row">
                <div>
                  <div style={{ fontWeight: 600 }}>Source Repository</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>github.com/PankajPBM/PandaDownloader</div>
                </div>
                <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => handleOpenLink('https://github.com/PankajPBM/PandaDownloader')}>
                  <ExternalLink size={12} />
                  <span>GitHub</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button className="btn-secondary" onClick={() => setShowSettingsModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveSettings}>
                <Check size={16} />
                <span>Save Settings</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. DOWNLOAD COMPLETED CELEBRATION MODAL */}
      {/* ============================================================== */}
      {completionTask && (
        <div className="modal-backdrop" onClick={() => setCompletionTask(null)}>
          <div className="modal-card complete-card" onClick={e => e.stopPropagation()}>
            <div className="complete-icon-ring">
              <Check size={36} color="#10b981" />
            </div>

            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>Download Complete! 🐼</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {completionTask.filename}
              </div>
              <div style={{ fontSize: 12, color: '#10b981', marginTop: 2 }}>
                {formatBytes(completionTask.totalBytes)} • High-Speed Muxed
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {completionTask.filePath && (
                <>
                  <button className="btn-primary" onClick={() => {
                    handleOpenFile(completionTask.filePath);
                    setCompletionTask(null);
                  }}>
                    <File size={15} />
                    <span>Open File</span>
                  </button>
                  <button className="btn-secondary" onClick={() => {
                    handleOpenFolder(completionTask.filePath);
                    setCompletionTask(null);
                  }}>
                    <Folder size={15} />
                    <span>Open Folder</span>
                  </button>
                </>
              )}
              <button className="btn-secondary" onClick={() => setCompletionTask(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 6. DELETE CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {deleteTarget && (
        <div className="modal-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="modal-card" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e' }}>
                <AlertCircle size={20} />
                <div className="modal-title" style={{ color: '#f43f5e' }}>Delete Download</div>
              </div>
              <button className="titlebar-btn" onClick={() => setDeleteTarget(null)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: 13, color: '#cbd5e1' }}>
              Are you sure you want to remove <strong>{deleteTarget.name}</strong>?
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8 }}>
              <input 
                type="checkbox" 
                id="delFileCheck" 
                checked={deleteFileFromDisk} 
                onChange={e => setDeleteFileFromDisk(e.target.checked)}
                style={{ cursor: 'pointer', width: 16, height: 16 }}
              />
              <label htmlFor="delFileCheck" style={{ fontSize: 12, color: '#f8fafc', cursor: 'pointer' }}>
                Also delete downloaded file from hard disk
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button 
                className="btn-primary" 
                style={{ background: '#f43f5e', borderColor: '#f43f5e' }}
                onClick={confirmDelete}
              >
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 7. CLIPBOARD SNIFFER TOAST */}
      {/* ============================================================== */}
      {clipboardPrompt && (
        <div className="clipboard-toast">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>Media Link Copied!</div>
            <div style={{ fontSize: 11, color: '#94a3b8', maxWidth: 300, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {clipboardPrompt}
            </div>
          </div>
          <button 
            className="btn-primary" 
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => {
              setNewUrl(clipboardPrompt);
              setShowAddModal(true);
              setClipboardPrompt(null);
            }}
          >
            Download
          </button>
          <button className="titlebar-btn" onClick={() => setClipboardPrompt(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
