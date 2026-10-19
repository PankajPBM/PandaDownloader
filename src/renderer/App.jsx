import React, { useState, useEffect } from 'react';
import { 
  Play, Pause, X, Folder, File, Plus, Download, 
  Trash2, ShieldCheck, Activity, Globe, HardDrive, 
  Minus, Square, Copy, CheckCircle, Settings, Layers,
  ExternalLink, Zap, Check, Music, Video, Archive,
  FileText, Cpu, AlertCircle, Sun, Moon, Phone, MessageCircle,
  Clock
} from 'lucide-react';

function fixMojibake(str) {
  if (!str || typeof str !== 'string') return str || '';
  if (/[\u00C2\u00C3\u00C4\u00C5\u00E0-\u00EF]/.test(str)) {
    try {
      const fixed = decodeURIComponent(escape(str));
      if (fixed && fixed.length > 0) return fixed;
    } catch (e) {}
  }
  return str;
}

export default function App() {
  const isStatusWindow = typeof window !== 'undefined' && window.location.hash.includes('status');
  const isPromptWindow = typeof window !== 'undefined' && window.location.hash.includes('prompt');
  const [theme, setTheme] = useState(() => localStorage.getItem('panda_theme') || 'dark');
  const [tasks, setTasks] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Prompt Window State (IDM Download File Info popup)
  const [promptInfo, setPromptInfo] = useState(null);
  const [promptName, setPromptName] = useState('');
  const [promptDir, setPromptDir] = useState('');
  const [promptInstantCheck, setPromptInstantCheck] = useState(false);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('storage');
  const [activePopupTaskId, setActivePopupTaskId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }
  const [deleteFileFromDisk, setDeleteFileFromDisk] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());
  const [expandedTaskIds, setExpandedTaskIds] = useState(new Set());
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearDeleteFromDisk, setClearDeleteFromDisk] = useState(false);

  // Sync theme with document root & body
  useEffect(() => {
    try {
      document.documentElement.setAttribute('data-theme', theme);
      if (document.body) {
        document.body.setAttribute('data-theme', theme);
        document.body.style.backgroundColor = theme === 'light' ? '#f1f5f9' : '#070a12';
        document.body.style.color = theme === 'light' ? '#0f172a' : '#f8fafc';
      }
      localStorage.setItem('panda_theme', theme);
    } catch (e) {}
  }, [theme]);

  // Derive popup task directly from active tasks or completion task only when activePopupTaskId is set
  const activePopupTask = activePopupTaskId 
    ? (tasks.find(t => t.id === activePopupTaskId) || (completionTask && completionTask.id === activePopupTaskId ? completionTask : null) || history.find(t => t.id === activePopupTaskId))
    : null;

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
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
    showCompletionDialog: true,
    openFolderOnCompletion: false,
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
        setTasks(prev => {
          const updated = prev.map(t => {
            if (t.id === prog.id) {
              return { ...t, ...prog };
            }
            return t;
          });
          const total = updated.reduce((acc, t) => acc + (t.status === 'downloading' ? (t.speed || 0) : 0), 0);
          setTotalSpeed(total);
          return updated;
        });
      });

      const unsubSpeed = window.pandaAPI.onSpeed((data) => {
        setTasks(prev => {
          const updated = prev.map(t => {
            if (t.id === data.progress.id) {
              return { ...t, ...data.progress };
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
            return prev.map(t => t.id === data.id ? { ...t, status: data.status, ...(data.task || {}) } : t);
          }
          if (data.task) {
            return [data.task, ...prev];
          }
          return prev;
        });
      });

      const unsubCompleted = window.pandaAPI.onCompleted((data) => {
        setTasks(prev => {
          const remaining = prev.filter(t => t.id !== data.id);
          const total = remaining.reduce((acc, t) => acc + (t.status === 'downloading' ? (t.speed || 0) : 0), 0);
          setTotalSpeed(total);
          return remaining;
        });
        setHistory(prev => {
          const exists = prev.some(h => h.id === data.id);
          if (exists) return prev.map(h => h.id === data.id ? { ...h, ...data, status: 'completed' } : h);
          return [{ ...data, status: 'completed' }, ...prev];
        });
        if (settings.openFolderOnCompletion && data.filePath) {
          handleOpenFolder(data.filePath);
        }
        setActivePopupTaskId(curr => curr === data.id ? null : curr);
      });

      let unsubActiveStatusTask = null;
      if (window.pandaAPI.onActiveStatusTask) {
        unsubActiveStatusTask = window.pandaAPI.onActiveStatusTask((taskId) => {
          if (taskId && isStatusWindow) setActivePopupTaskId(taskId);
        });
      }

      let unsubPromptInfo = null;
      if (window.pandaAPI.onPromptInfo) {
        unsubPromptInfo = window.pandaAPI.onPromptInfo((info) => {
          if (info) {
            setPromptInfo(info);
            setPromptName(fixMojibake(info.filename) || 'download_file');
            setPromptDir(info.saveDirectory || '');
          }
        });
      }

      const unsubClipboard = window.pandaAPI.onClipboardDetected((data) => {
        setClipboardPrompt(data.url);
        setTimeout(() => {
          setClipboardPrompt(prev => prev === data.url ? null : prev);
        }, 6000);
      });

      const unsubBrowser = window.pandaAPI.onBrowserIntercepted((data) => {
        if (data && data.original) {
          setNewUrl(data.original.url || '');
          setCustomTitle(data.original.filename || '');
          setShowAddModal(true);
        } else if (data && data.task) {
          setTasks(prev => [data.task, ...prev]);
        }
      });

      const unsubDeleted = window.pandaAPI.onTaskDeleted((data) => {
        setTasks(prev => {
          const remaining = prev.filter(t => t.id !== data.id);
          const total = remaining.reduce((acc, t) => acc + (t.status === 'downloading' ? (t.speed || 0) : 0), 0);
          setTotalSpeed(total);
          return remaining;
        });
        setHistory(prev => prev.filter(t => t.id !== data.id));
        setActivePopupTaskId(curr => curr === data.id ? null : curr);
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
        if (unsubPromptInfo) unsubPromptInfo();
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
        saveDirectory: (targetSaveDir.trim() && targetSaveDir.trim() !== settings.defaultSaveDir) ? targetSaveDir.trim() : undefined
      });
      if (task) {
        setTasks(prev => {
          const exists = prev.some(t => t.id === task.id);
          return exists ? prev : [task, ...prev];
        });
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
        saveDirectory: (targetSaveDir.trim() && targetSaveDir.trim() !== settings.defaultSaveDir) ? targetSaveDir.trim() : undefined
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
  };

  const handleResume = (id) => {
    if (window.pandaAPI) window.pandaAPI.resumeTask(id);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'downloading' } : t));
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
    if (activePopupTaskId === deleteTarget.id) {
      setActivePopupTaskId(null);
    }
    setDeleteTarget(null);
  };

  const toggleExpandTask = (id) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectTask = (id) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedTaskIds.size === filteredTasks.length && filteredTasks.length > 0) {
      setSelectedTaskIds(new Set());
    } else {
      setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)));
    }
  };

  const handleClearConfirm = async (deleteFiles) => {
    const idsToClear = selectedTaskIds.size > 0 
      ? Array.from(selectedTaskIds) 
      : filteredTasks.map(t => t.id);

    if (window.pandaAPI) {
      for (const id of idsToClear) {
        await window.pandaAPI.deleteTask(id, deleteFiles);
      }
    }

    setTasks(prev => prev.filter(t => !idsToClear.includes(t.id)));
    setHistory(prev => prev.filter(t => !idsToClear.includes(t.id)));
    setSelectedTaskIds(new Set());
    setShowClearModal(false);
    setClearDeleteFromDisk(false);
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

  // IDM Download File Info Prompt Window (Standalone Topmost Floating Dialog)
  if (isPromptWindow) {
    const handleStart = async () => {
      if (promptInstantCheck && window.pandaAPI) {
        await window.pandaAPI.saveSettings({ ...settings, autoAcceptDownloads: true });
      }
      if (window.pandaAPI && promptInfo) {
        await window.pandaAPI.startDownloadFromPrompt({
          ...promptInfo,
          filename: promptName,
          saveDirectory: promptDir
        });
      }
    };

    const handleQueue = async () => {
      if (window.pandaAPI && promptInfo) {
        await window.pandaAPI.queueDownloadFromPrompt({
          ...promptInfo,
          filename: promptName,
          saveDirectory: promptDir
        });
      }
    };

    const handleCancel = async () => {
      if (window.pandaAPI) {
        await window.pandaAPI.closePromptWindow();
      }
    };

    const handleBrowse = async () => {
      if (window.pandaAPI) {
        const dir = await window.pandaAPI.selectDirectory();
        if (dir) setPromptDir(dir);
      }
    };

    return (
      <div data-theme={theme} style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 14, background: 'var(--bg-secondary)', color: 'var(--text-main)', userSelect: 'none', border: '1px solid var(--border-focus)', borderRadius: 10, boxSizing: 'border-box', overflow: 'hidden' }}>
        {/* Titlebar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)', WebkitAppRegion: 'drag', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🐼</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
                Download File Info
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Panda Downloader Accelerated Capture</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
            <button className="titlebar-btn close" onClick={handleCancel} title="Cancel / Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body Form */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10, overflowY: 'auto', paddingRight: 2 }}>
          {/* URL row */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>URL / Source:</div>
            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={promptInfo?.url}>
              {promptInfo?.url || 'Waiting for download stream...'}
            </div>
          </div>

          {/* File Name */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>File Name:</div>
            <input 
              type="text" 
              className="form-input" 
              value={promptName}
              onChange={e => setPromptName(e.target.value)}
              placeholder="Filename..."
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {/* Save Directory */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Save To Folder:</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input 
                type="text" 
                className="form-input" 
                value={promptDir}
                onChange={e => setPromptDir(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn-secondary" onClick={handleBrowse} style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}>
                <Folder size={14} />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          {/* Details Pill Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-tertiary)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Category: <strong style={{ color: 'var(--text-main)', textTransform: 'capitalize' }}>{promptInfo?.category || 'General'}</strong>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              File Size: <strong style={{ color: '#06b6d4' }}>{promptInfo?.fileSize ? formatBytes(promptInfo.fileSize) : 'Detecting...'}</strong>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Acceleration: <strong style={{ color: '#10b981' }}>16 Connections</strong>
            </div>
          </div>

          {/* Instant download checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input 
              type="checkbox" 
              id="instantCheckPrompt"
              checked={promptInstantCheck}
              onChange={e => setPromptInstantCheck(e.target.checked)}
              style={{ cursor: 'pointer', width: 15, height: 15, accentColor: '#10b981' }}
            />
            <label htmlFor="instantCheckPrompt" style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
              Don't ask again (Enable Instant Download / Auto-Start for future downloads)
            </label>
          </div>
        </div>

        {/* Pinned Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border-subtle)', flexShrink: 0, marginTop: 8 }}>
          <button className="btn-secondary" style={{ padding: '7px 16px', fontSize: 12 }} onClick={handleCancel}>
            <X size={14} />
            <span>Cancel</span>
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ padding: '7px 16px', fontSize: 12 }} onClick={handleQueue}>
              <Clock size={14} />
              <span>Download Later</span>
            </button>
            <button className="btn-primary" style={{ padding: '7px 20px', fontSize: 12, fontWeight: 700 }} onClick={handleStart}>
              <Download size={14} />
              <span>Start Download</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isStatusWindow) {
    const task = activePopupTask || tasks[0] || (history.length > 0 ? history[0] : null) || {
      filename: 'Starting Download...',
      status: 'downloading',
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      speed: 0,
      supportsRange: true,
      segments: Array.from({ length: 16 }, (_, i) => ({ id: i, percent: 0, status: 'downloading' }))
    };

    const isDone = task.status === 'completed';

    return (
      <div data-theme={theme} style={{ height: '100vh', display: 'flex', flexDirection: 'column', padding: 12, background: 'var(--bg-secondary)', color: 'var(--text-main)', userSelect: 'none', border: '1px solid var(--border-focus)', borderRadius: 10, boxSizing: 'border-box', overflow: 'hidden' }}>
        {/* Pinned Draggable Titlebar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)', WebkitAppRegion: 'drag', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', maxWidth: 460, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {isDone ? `Download Complete: ${task.filename || 'File'}` : `Download Status: ${task.filename || 'File'}`}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Dynamic Range Segmentation Engine</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' }}>
            <button className="titlebar-btn" onClick={() => window.pandaAPI && window.pandaAPI.minimize()} title="Minimize to Taskbar">
              <Minus size={15} />
            </button>
            <button className="titlebar-btn close" onClick={() => window.pandaAPI && window.pandaAPI.closeStatusWindow()} title="Close / Hide to Background">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable Body Container - always 100% visible and smoothly scrollable at any window size */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 8, margin: '6px 0' }}>
          {/* Grid info */}
          <div className="idm-grid" style={{ marginTop: 2 }}>
            <span className="idm-grid-label">File Name:</span>
            <span className="idm-grid-value" title={task.filename} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.filename || task.url}</span>

            <span className="idm-grid-label">Status:</span>
            <span className="idm-grid-value" style={{ textTransform: 'capitalize', color: isDone ? '#10b981' : task.status === 'downloading' ? '#06b6d4' : '#f59e0b', fontWeight: 700 }}>
              {task.status}
            </span>

            <span className="idm-grid-label">File Size:</span>
            <span className="idm-grid-value">{formatBytes(task.totalBytes)}</span>

            <span className="idm-grid-label">Downloaded:</span>
            <span className="idm-grid-value">{formatBytes(task.downloadedBytes)} ({Math.floor(task.percent || 0)}%)</span>

            <span className="idm-grid-label">Transfer Rate:</span>
            <span className="idm-grid-value" style={{ color: '#06b6d4', fontWeight: 700 }}>
              {task.status === 'downloading' ? formatSpeed(task.speed) : '0 KB/s'}
            </span>

            <span className="idm-grid-label">Time Left (ETA):</span>
            <span className="idm-grid-value">{isDone ? '--' : formatETA(task.eta)}</span>

            <span className="idm-grid-label">Resume Capability:</span>
            <span className="idm-grid-value" style={{ color: task.supportsRange ? '#10b981' : '#f59e0b' }}>
              {task.supportsRange ? '✓ Yes (HTTP Range)' : 'Limited / Single Stream'}
            </span>

            {task.filePath && (
              <>
                <span className="idm-grid-label">Save To:</span>
                <span className="idm-grid-value" title={task.filePath} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.filePath}</span>
              </>
            )}
          </div>

          {/* Master Shimmer Progress Bar */}
          <div className="idm-shimmer-track">
            <div 
              className="idm-shimmer-fill" 
              style={{ width: `${Math.min(100, task.percent || 0)}%` }}
            />
            <div className="idm-shimmer-text">
              {Math.floor(task.percent || 0)}% Completed
            </div>
          </div>

          {/* Active Connections Dynamic Streams (2-column IDM style) */}
          {task.segments && task.segments.length > 0 && (
            <div className="idm-segments-panel" style={{ padding: '6px 10px', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                  Active Segment Streams ({task.segments.length} Threads)
                </span>
                <span style={{ fontSize: 10, color: '#10b981', fontWeight: 600 }}>
                  {isDone ? 'All Segments Merged & Verified' : 'Dynamic Range Chunking'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 14, rowGap: 2 }}>
                {task.segments.map((seg, idx) => (
                  <div key={idx} className="idm-segment-row" style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '1px 0' }}>
                    <span style={{ width: 56, whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>Conn {idx + 1}:</span>
                    <div className="idm-segment-bar" style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                      <div className="idm-segment-fill" style={{ width: `${Math.min(100, isDone ? 100 : (seg.percent || 0))}%`, height: '100%', background: '#10b981' }} />
                    </div>
                    <span style={{ width: 34, textAlign: 'right', color: 'var(--text-main)', fontSize: 10, fontWeight: 600, flexShrink: 0 }}>
                      {Math.floor(isDone ? 100 : (seg.percent || 0))}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pinned Bottom Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isDone ? (
              <>
                {task.filePath && (
                  <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => {
                    handleOpenFile(task.filePath);
                    window.pandaAPI && window.pandaAPI.closeStatusWindow();
                  }}>
                    <File size={14} />
                    <span>Open File</span>
                  </button>
                )}
                {task.filePath && (
                  <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => handleOpenFolder(task.filePath)}>
                    <Folder size={14} />
                    <span>Open Folder</span>
                  </button>
                )}
              </>
            ) : task.status === 'downloading' ? (
              <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => handlePause(task.id)}>
                <Pause size={14} />
                <span>Pause</span>
              </button>
            ) : (
              <button className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => handleResume(task.id)}>
                <Play size={14} />
                <span>Resume</span>
              </button>
            )}

            {task.filePath && !isDone && (
              <button className="btn-secondary" style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => handleOpenFolder(task.filePath)}>
                <Folder size={14} />
                <span>Open Folder</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ padding: '6px 16px', fontSize: 12 }} onClick={() => window.pandaAPI && window.pandaAPI.closeStatusWindow()}>
              {isDone ? 'Close' : 'Hide to Background'}
            </button>
            {!isDone && (
              <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, color: 'var(--accent-rose)', borderColor: 'rgba(244, 63, 94, 0.3)' }} onClick={async () => {
                if (window.pandaAPI) {
                  await window.pandaAPI.deleteTask(task.id, true);
                  window.pandaAPI.closeStatusWindow();
                }
              }}>
                <Trash2 size={14} />
                <span>Cancel</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                title={settings.autoAcceptDownloads ? "Instant Download: ON (Downloads start immediately without confirmation)" : "Instant Download: OFF (Shows IDM Download File Info prompt)"}
              >
                <Zap size={14} color={settings.autoAcceptDownloads ? '#10b981' : '#94a3b8'} />
                <span>Instant Download: {settings.autoAcceptDownloads ? 'ON' : 'OFF'}</span>
              </button>

              {selectedTaskIds.size > 0 ? (
                <button 
                  className="btn-secondary" 
                  style={{ color: '#f43f5e', borderColor: 'rgba(244, 63, 94, 0.4)' }} 
                  onClick={() => setShowClearModal(true)}
                  title="Delete selected downloads"
                >
                  <Trash2 size={14} />
                  <span>Delete Selected ({selectedTaskIds.size})</span>
                </button>
              ) : filteredTasks.length > 0 ? (
                <button 
                  className="btn-secondary" 
                  style={{ color: '#f43f5e', borderColor: 'rgba(244, 63, 94, 0.4)' }} 
                  onClick={() => setShowClearModal(true)} 
                  title="Clear all downloads from history or disk"
                >
                  <Trash2 size={14} />
                  <span>Clear All</span>
                </button>
              ) : null}
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
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 10px 4px', fontSize: 12, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }} onClick={selectAllFiltered}>
                    <input 
                      type="checkbox" 
                      checked={filteredTasks.length > 0 && selectedTaskIds.size === filteredTasks.length} 
                      onChange={selectAllFiltered}
                      style={{ cursor: 'pointer', width: 15, height: 15, accentColor: '#10b981' }}
                    />
                    <span style={{ fontWeight: 600 }}>Select All ({filteredTasks.length})</span>
                  </div>
                  {selectedTaskIds.size > 0 && (
                    <span style={{ color: '#10b981', fontWeight: 600 }}>{selectedTaskIds.size} of {filteredTasks.length} selected</span>
                  )}
                </div>

                {filteredTasks.map((task) => (
                  <div 
                    key={task.id} 
                    className="download-card"
                    onClick={() => setActivePopupTaskId(task.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="card-header">
                      <div className="card-title-group">
                        <input 
                          type="checkbox"
                          checked={selectedTaskIds.has(task.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleSelectTask(task.id);
                          }}
                          style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#10b981', marginRight: 2 }}
                        />
                        <div className="file-icon">
                          <Download size={20} />
                        </div>
                        <div className="file-meta-col">
                          <div className="file-name" title={task.filename || task.url}>
                            {fixMojibake(task.filename) || task.url}
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

                        {task.segments && task.segments.length > 0 && (
                          <button 
                            className={`action-btn ${expandedTaskIds.has(task.id) ? 'active' : ''}`} 
                            title={expandedTaskIds.has(task.id) ? "Hide Connection Details" : "View Connection Details"} 
                            onClick={() => toggleExpandTask(task.id)}
                            style={{ color: expandedTaskIds.has(task.id) ? '#10b981' : 'inherit' }}
                          >
                            <Layers size={14} />
                          </button>
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

                    {/* Segments Preview Mini - ONLY shown on demand when user clicks details toggle! */}
                    {expandedTaskIds.has(task.id) && task.segments && task.segments.length > 0 && (
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
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 1. ICONIC IDM DOWNLOAD PROGRESS POPUP WINDOW */}
      {/* ============================================================== */}
      {activePopupTask && (
        <div className="modal-backdrop" onClick={() => setActivePopupTaskId(null)}>
          <div className="idm-popup-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚡</span>
                <div>
                  <div className="modal-title">Download Status: {activePopupTask.filename || 'File'}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Dynamic Range Segmentation Engine</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="titlebar-btn" onClick={() => setActivePopupTaskId(null)} title="Hide to Background">
                  <Minus size={16} />
                </button>
                <button className="titlebar-btn close" onClick={() => setActivePopupTaskId(null)} title="Close Details">
                  <X size={16} />
                </button>
              </div>
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
                <button className="btn-secondary" onClick={() => setActivePopupTaskId(null)}>
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
          <div className="settings-modal-card" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="settings-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ 
                  width: 32, 
                  height: 32, 
                  borderRadius: 8, 
                  background: 'rgba(16, 185, 129, 0.15)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: 'var(--accent-emerald)'
                }}>
                  <Settings size={18} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.2px' }}>
                    Preferences
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Panda Downloader v1.1.0 Configuration
                  </div>
                </div>
              </div>
              <button className="titlebar-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={16} />
              </button>
            </div>

            {/* Body: Sidebar + Content */}
            <div className="settings-body">
              {/* Left Navigation Sidebar */}
              <div className="settings-sidebar">
                <button 
                  className={`settings-nav-btn ${activeSettingsTab === 'storage' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('storage')}
                >
                  <Folder size={15} />
                  <span>Storage & Folders</span>
                </button>

                <button 
                  className={`settings-nav-btn ${activeSettingsTab === 'engine' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('engine')}
                >
                  <Zap size={15} />
                  <span>Download Engine</span>
                </button>

                <button 
                  className={`settings-nav-btn ${activeSettingsTab === 'browser' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('browser')}
                >
                  <Globe size={15} />
                  <span>Browser Extension</span>
                </button>

                <button 
                  className={`settings-nav-btn ${activeSettingsTab === 'window' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('window')}
                >
                  <HardDrive size={15} />
                  <span>Window & System</span>
                </button>

                <button 
                  className={`settings-nav-btn ${activeSettingsTab === 'about' ? 'active' : ''}`}
                  onClick={() => setActiveSettingsTab('about')}
                >
                  <ShieldCheck size={15} />
                  <span>About & Support</span>
                </button>
              </div>

              {/* Right Content Panel */}
              <div className="settings-content">
                {/* 1. Storage & Folders Tab */}
                {activeSettingsTab === 'storage' && (
                  <>
                    <div>
                      <div className="settings-panel-title">Storage & Directories</div>
                      <div className="settings-panel-desc">Configure where your downloads are stored and how files are organized.</div>
                    </div>

                    <div className="settings-section-card">
                      <div className="settings-row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                        <div>
                          <div className="settings-row-title">Default Save Directory</div>
                          <div className="settings-row-desc">Downloaded files will be placed into this location by default</div>
                        </div>
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

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Auto-Categorize into Subfolders</div>
                          <div className="settings-row-desc">Automatically sorts completed downloads into Video/, Audio/, Compressed/, Programs/, and Documents/</div>
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
                  </>
                )}

                {/* 2. Download Engine Tab */}
                {activeSettingsTab === 'engine' && (
                  <>
                    <div>
                      <div className="settings-panel-title">Download Engine & Interception</div>
                      <div className="settings-panel-desc">Tune acceleration streams, automatic start behavior, and file interception.</div>
                    </div>

                    <div className="settings-section-card">
                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Instant Download (Auto-Start)</div>
                          <div className="settings-row-desc">
                            When ON, browser downloads start immediately without prompt. When OFF, shows the IDM Download File Info dialog to customize filename and folder.
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

                      <div className="settings-row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                        <div>
                          <div className="settings-row-title">Default Acceleration Connections</div>
                          <div className="settings-row-desc">Number of parallel segmented TCP connections used per download</div>
                        </div>
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

                      <div className="settings-row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                        <div>
                          <div className="settings-row-title">Captured File Types & Extensions</div>
                          <div className="settings-row-desc">Comma-separated file extensions intercepted automatically from browser navigation</div>
                        </div>
                        <input 
                          type="text" 
                          className="form-input" 
                          value={extensionsInput}
                          onChange={e => setExtensionsInput(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* 3. Browser Extension Tab */}
                {activeSettingsTab === 'browser' && (
                  <>
                    <div>
                      <div className="settings-panel-title">Browser Integration</div>
                      <div className="settings-panel-desc">Universal media sniffer & 1-click accelerated download capture for all modern browsers.</div>
                    </div>

                    <div className="settings-section-card">
                      <div style={{ padding: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{ 
                              width: 42, 
                              height: 42, 
                              borderRadius: 10, 
                              background: 'rgba(16, 185, 129, 0.15)', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              fontSize: 22 
                            }}>
                              🐼
                            </div>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-main)' }}>
                                Panda Downloader Browser Extension
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                Supports Chrome, Microsoft Edge, Brave, Opera, and Vivaldi
                              </div>
                            </div>
                          </div>
                          <button 
                            className="btn-primary" 
                            style={{ padding: '8px 16px', fontSize: 13 }}
                            onClick={async () => {
                              if (window.pandaAPI && window.pandaAPI.openExtensionFolder) {
                                await window.pandaAPI.openExtensionFolder();
                              }
                            }}
                          >
                            <Download size={15} />
                            <span>Install in Browser</span>
                          </button>
                        </div>

                        <div style={{ 
                          marginTop: 18, 
                          paddingTop: 16, 
                          borderTop: '1px solid var(--border-subtle)', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          gap: 12 
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                            Quick 10-Second Setup:
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            <div className="step-number-badge">1</div>
                            <div>Click <strong>"Install in Browser"</strong> above to open <code>chrome://extensions</code> and reveal the extension folder in Explorer.</div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            <div className="step-number-badge">2</div>
                            <div>Turn ON the <strong>"Developer mode"</strong> toggle switch in the top-right corner of your browser.</div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12, color: 'var(--text-main)', lineHeight: 1.5 }}>
                            <div className="step-number-badge">3</div>
                            <div>Drag and drop the opened <code>extension</code> folder directly into the browser page (or click <strong>"Load unpacked"</strong> and select it).</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* 4. Window & System Tab */}
                {activeSettingsTab === 'window' && (
                  <>
                    <div>
                      <div className="settings-panel-title">Window & System Behavior</div>
                      <div className="settings-panel-desc">Manage system tray notifications, completion alerts, and window close actions.</div>
                    </div>

                    <div className="settings-section-card">
                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Minimize to System Tray</div>
                          <div className="settings-row-desc">Keep running in background when window is closed</div>
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

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Show Completion Popup Dialog</div>
                          <div className="settings-row-desc">Display floating notification window when download finishes</div>
                        </div>
                        <label className="switch">
                          <input 
                            type="checkbox" 
                            checked={settings.showCompletionDialog}
                            onChange={e => setSettings(prev => ({ ...prev, showCompletionDialog: e.target.checked }))}
                          />
                          <span className="slider"></span>
                        </label>
                      </div>

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Open Folder Automatically When Done</div>
                          <div className="settings-row-desc">Automatically open download directory in Explorer after completion</div>
                        </div>
                        <label className="switch">
                          <input 
                            type="checkbox" 
                            checked={settings.openFolderOnCompletion}
                            onChange={e => setSettings(prev => ({ ...prev, openFolderOnCompletion: e.target.checked }))}
                          />
                          <span className="slider"></span>
                        </label>
                      </div>
                    </div>
                  </>
                )}

                {/* 5. About & Support Tab */}
                {activeSettingsTab === 'about' && (
                  <>
                    <div>
                      <div className="settings-panel-title">About & Support</div>
                      <div className="settings-panel-desc">Version details, theme settings, and developer contact support.</div>
                    </div>

                    <div className="settings-section-card">
                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">App Version</div>
                          <div className="settings-row-desc">v1.1.0 Production Release (IDM Multi-Segment Engine)</div>
                        </div>
                        <div style={{ 
                          padding: '3px 8px', 
                          borderRadius: 6, 
                          fontSize: 11, 
                          fontWeight: 700, 
                          background: 'rgba(16, 185, 129, 0.15)', 
                          color: 'var(--accent-emerald)', 
                          border: '1px solid rgba(16, 185, 129, 0.3)' 
                        }}>
                          v1.1.0
                        </div>
                      </div>

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Interface Theme</div>
                          <div className="settings-row-desc">Active: {theme === 'dark' ? 'Dark Mode (Obsidian)' : 'Light Mode (Clean Slate)'}</div>
                        </div>
                        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={toggleTheme}>
                          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                          <span>Switch to {theme === 'dark' ? 'Light' : 'Dark'}</span>
                        </button>
                      </div>

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Publisher / Developer</div>
                          <div className="settings-row-desc">PB Tech Zone · Prakash Bhatt</div>
                        </div>
                        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => handleOpenLink('https://prakash77.com.np')}>
                          <Globe size={13} />
                          <span>Website</span>
                        </button>
                      </div>

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">WhatsApp Direct Support</div>
                          <div className="settings-row-desc">+977 9814891277 (Fast Response)</div>
                        </div>
                        <button 
                          className="btn-secondary" 
                          style={{ padding: '6px 12px', fontSize: 12, color: 'var(--accent-emerald)', borderColor: 'rgba(16, 185, 129, 0.3)' }} 
                          onClick={() => handleOpenLink('https://wa.me/9779814891277')}
                        >
                          <MessageCircle size={13} />
                          <span>WhatsApp</span>
                        </button>
                      </div>

                      <div className="settings-row-item">
                        <div>
                          <div className="settings-row-title">Source Repository</div>
                          <div className="settings-row-desc">github.com/PankajPBM/PandaDownloader</div>
                        </div>
                        <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => handleOpenLink('https://github.com/PankajPBM/PandaDownloader')}>
                          <ExternalLink size={13} />
                          <span>GitHub</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="settings-footer">
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

            <div style={{ fontSize: 13, color: 'var(--text-main)', lineHeight: 1.5 }}>
              Are you sure you want to remove <strong style={{ color: 'var(--accent-emerald)', wordBreak: 'break-all' }}>{fixMojibake(deleteTarget.name)}</strong>?
            </div>

            <div className="delete-confirm-box">
              <input 
                type="checkbox" 
                id="delFileCheck" 
                checked={deleteFileFromDisk} 
                onChange={e => setDeleteFileFromDisk(e.target.checked)}
                style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#f43f5e' }}
              />
              <label htmlFor="delFileCheck" style={{ fontSize: 12, color: 'var(--text-main)', cursor: 'pointer', fontWeight: 500 }}>
                Also permanently delete downloaded file from hard disk
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button 
                className="btn-primary" 
                style={{ background: '#f43f5e', borderColor: '#f43f5e' }}
                onClick={confirmDelete}
              >
                <Trash2 size={15} />
                <span>{deleteFileFromDisk ? 'Delete from Disk & History' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 6B. CLEAR ALL / DELETE SELECTED CONFIRMATION MODAL */}
      {/* ============================================================== */}
      {showClearModal && (
        <div className="modal-backdrop" onClick={() => setShowClearModal(false)}>
          <div className="modal-card" style={{ width: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f43f5e' }}>
                <AlertCircle size={20} />
                <div className="modal-title" style={{ color: '#f43f5e' }}>
                  {selectedTaskIds.size > 0 ? `Delete Selected (${selectedTaskIds.size})` : `Clear All Downloads (${filteredTasks.length})`}
                </div>
              </div>
              <button className="titlebar-btn" onClick={() => setShowClearModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-main)', lineHeight: 1.5 }}>
              {selectedTaskIds.size > 0 
                ? `You have selected ${selectedTaskIds.size} downloads to clear.` 
                : `Are you sure you want to clear all ${filteredTasks.length} downloads from the list?`}
            </div>

            <div className="delete-confirm-box">
              <input 
                type="checkbox" 
                id="clearDiskCheck" 
                checked={clearDeleteFromDisk} 
                onChange={e => setClearDeleteFromDisk(e.target.checked)}
                style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#f43f5e' }}
              />
              <label htmlFor="clearDiskCheck" style={{ fontSize: 12, color: 'var(--text-main)', cursor: 'pointer', fontWeight: 500 }}>
                Also permanently delete downloaded files from hard disk
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button className="btn-secondary" onClick={() => setShowClearModal(false)}>
                Cancel
              </button>
              {clearDeleteFromDisk ? (
                <button 
                  className="btn-primary" 
                  style={{ background: '#f43f5e', borderColor: '#f43f5e' }}
                  onClick={() => handleClearConfirm(true)}
                >
                  <Trash2 size={14} />
                  <span>Delete from Disk & History</span>
                </button>
              ) : (
                <button 
                  className="btn-primary" 
                  onClick={() => handleClearConfirm(false)}
                >
                  <Trash2 size={14} />
                  <span>Remove from History Only</span>
                </button>
              )}
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
