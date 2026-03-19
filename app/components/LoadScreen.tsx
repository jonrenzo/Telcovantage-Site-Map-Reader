"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DxfFile {
  name: string;
  path: string;
  size: number; // bytes
  modified: number; // unix timestamp
  folder: string; // "" = root
}

interface Folder {
  name: string;
  fileCount: number;
}

interface FilePlatformData {
  folders: Folder[];
  files: DxfFile[];
}

type UploadState = "idle" | "uploading" | "done" | "error";
type ViewMode = "grid" | "list";
type SortKey = "name" | "modified" | "size";

interface Props {
  onStartProcessing: (opts: {
    dxfPath: string;
    layer: string;
    allLayers: string[];
  }) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function DxfIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <rect width="40" height="40" rx="6" fill="#eff6ff" />
      <path
        d="M10 8h14l8 8v18a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2z"
        fill="#fff"
        stroke="#2563eb"
        strokeWidth="1.5"
      />
      <path d="M24 8v8h8" fill="none" stroke="#2563eb" strokeWidth="1.5" />
      <text
        x="20"
        y="28"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill="#2563eb"
        fontFamily="monospace"
      >
        DXF
      </text>
    </svg>
  );
}

function FolderIcon({
  size = 32,
  color = "#f59e0b",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <path
        d="M4 12a3 3 0 013-3h10l3 4h13a3 3 0 013 3v14a3 3 0 01-3 3H7a3 3 0 01-3-3V12z"
        fill={color}
        opacity="0.15"
      />
      <path
        d="M4 12a3 3 0 013-3h10l3 4h13a3 3 0 013 3v14a3 3 0 01-3 3H7a3 3 0 01-3-3V12z"
        fill="none"
        stroke={color}
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LoadScreen({ onStartProcessing }: Props) {
  // File platform state
  const [data, setData] = useState<FilePlatformData>({
    folders: [],
    files: [],
  });
  const [currentFolder, setCurrentFolder] = useState<string>(""); // "" = root
  const [selectedFile, setSelectedFile] = useState<DxfFile | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortKey, setSortKey] = useState<SortKey>("modified");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New folder modal
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Open file / layer picking
  const [openingFile, setOpeningFile] = useState(false);
  const [layers, setLayers] = useState<string[]>([]);
  const [selectedLayer, setSelectedLayer] = useState("");
  const [suggestedLayer, setSuggestedLayer] = useState("");
  const [modelOk, setModelOk] = useState<boolean | null>(null);
  const [showLayerPicker, setShowLayerPicker] = useState(false);

  // Rename / delete
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    file: DxfFile;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<DxfFile | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/files/list");
      if (res.ok) {
        const d = await res.json();
        setData(d);
      }
    } catch (_) {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // ── Derived display data ────────────────────────────────────────────────────

  const visibleFiles = data.files
    .filter((f) => f.folder === currentFolder)
    .filter(
      (f) =>
        !searchQuery ||
        f.name.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "size") return b.size - a.size;
      return b.modified - a.modified;
    });

  const visibleFolders =
    currentFolder === ""
      ? data.folders.filter(
          (f) =>
            !searchQuery ||
            f.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : [];

  // ── Upload handler ──────────────────────────────────────────────────────────

  const handleUploadFile = useCallback(
    async (file: File) => {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      if (!file.name.endsWith(".dxf") && !isPdf) {
        alert("Please select a DXF or PDF file.");
        return;
      }

      setUploadState("uploading");
      setUploadProgress(20);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", currentFolder);

      try {
        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: fd,
        });
        const d = await res.json();

        if (d.error) {
          setUploadState("error");
          alert(d.error);
          return;
        }

        setUploadProgress(100);
        setUploadState("done");
        await fetchFiles();

        // Auto-select the new file
        setTimeout(() => {
          setUploadState("idle");
          setUploadProgress(0);
        }, 1200);
      } catch (e) {
        setUploadState("error");
        alert("Upload failed: " + (e as Error).message);
      }
    },
    [currentFolder, fetchFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUploadFile(file);
    },
    [handleUploadFile],
  );

  // ── Open file flow ──────────────────────────────────────────────────────────

  const handleOpenFile = useCallback(async (file: DxfFile) => {
    setSelectedFile(file);
    setOpeningFile(true);
    setShowLayerPicker(false);
    setLayers([]);
    setModelOk(null);

    try {
      const [lRes, mRes] = await Promise.all([
        fetch("/api/layers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dxf_path: file.path }),
        }),
        fetch("/api/check_model"),
      ]);

      const lData = await lRes.json();
      const mData = await mRes.json();

      if (lData.error) {
        alert("Could not read layers: " + lData.error);
        setOpeningFile(false);
        return;
      }

      setLayers(lData.layers);
      const suggested =
        lData.layers.find(
          (l: string) =>
            l.toLowerCase().includes("strand") ||
            l.toLowerCase().includes("sttext"),
        ) ?? "";
      setSuggestedLayer(suggested);
      setSelectedLayer(suggested || lData.layers[0] || "");
      setModelOk(mData.ok);
      setShowLayerPicker(true);
    } catch (e) {
      alert("Error opening file: " + (e as Error).message);
    }
    setOpeningFile(false);
  }, []);

  // ── Folder management ───────────────────────────────────────────────────────

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await fetch("/api/files/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setNewFolderName("");
    setShowNewFolder(false);
    await fetchFiles();
  }, [newFolderName, fetchFiles]);

  const handleDeleteFile = useCallback(
    async (file: DxfFile) => {
      if (!confirm(`Delete "${file.name}"?`)) return;
      await fetch("/api/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path }),
      });
      if (selectedFile?.path === file.path) setSelectedFile(null);
      await fetchFiles();
      setContextMenu(null);
    },
    [selectedFile, fetchFiles],
  );

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameDraft.trim()) return;
    await fetch("/api/files/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: renameTarget.path,
        new_name: renameDraft.trim(),
      }),
    });
    setRenameTarget(null);
    setRenameDraft("");
    await fetchFiles();
  }, [renameTarget, renameDraft, fetchFiles]);

  // ── Breadcrumb ──────────────────────────────────────────────────────────────

  const breadcrumbs = currentFolder
    ? [
        { label: "My Drawings", folder: "" },
        { label: currentFolder, folder: currentFolder },
      ]
    : [{ label: "My Drawings", folder: "" }];

  // ── Render ──────────────────────────────────────────────────────────────────

  const isEmpty = visibleFiles.length === 0 && visibleFolders.length === 0;

  return (
    <main
      className="flex-1 flex overflow-hidden bg-[#f4f6fb]"
      onClick={() => setContextMenu(null)}
    >
      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 bg-surface border-r border-border flex flex-col py-4 gap-1">
        <div className="px-4 mb-2">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            Workspace
          </p>
        </div>

        {[{ icon: "🗂️", label: "My Drawings", folder: "" }].map(
          ({ icon, label, folder }) => (
            <button
              key={folder}
              onClick={() => {
                setCurrentFolder(folder);
                setSelectedFile(null);
                setShowLayerPicker(false);
              }}
              className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                currentFolder === folder &&
                !data.folders.find((f) => f.name === currentFolder)
                  ? "bg-accent-light text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-[#1e293b]"
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </button>
          ),
        )}

        <div className="px-4 mt-4 mb-1">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
            Folders
          </p>
        </div>

        {data.folders.map((f) => (
          <button
            key={f.name}
            onClick={() => {
              setCurrentFolder(f.name);
              setSelectedFile(null);
              setShowLayerPicker(false);
            }}
            className={`flex items-center gap-2.5 mx-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors
              ${
                currentFolder === f.name
                  ? "bg-[#fffbeb] text-[#d97706]"
                  : "text-muted hover:bg-surface-2 hover:text-[#1e293b]"
              }`}
          >
            <FolderIcon
              size={16}
              color={currentFolder === f.name ? "#d97706" : "#94a3b8"}
            />
            <span className="flex-1 text-left truncate">{f.name}</span>
            <span className="text-[10px] font-mono bg-surface-2 px-1.5 py-0.5 rounded text-muted-2">
              {f.fileCount}
            </span>
          </button>
        ))}

        <div className="mt-auto px-3">
          <button
            onClick={() => setShowNewFolder(true)}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-muted
              border border-dashed border-border rounded-lg hover:bg-surface-2 hover:text-[#1e293b] transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Folder
          </button>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-surface border-b border-border px-5 py-3 flex items-center gap-3 flex-shrink-0">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
            {breadcrumbs.map((b, i) => (
              <span key={b.folder} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-2 text-xs">/</span>}
                <button
                  onClick={() => {
                    setCurrentFolder(b.folder);
                    setSelectedFile(null);
                    setShowLayerPicker(false);
                  }}
                  className={`font-medium transition-colors ${
                    i === breadcrumbs.length - 1
                      ? "text-[#1e293b] cursor-default"
                      : "text-muted hover:text-accent"
                  }`}
                >
                  {b.label}
                </button>
              </span>
            ))}
          </nav>

          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-2"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search drawings…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-surface-2 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent/20 w-44"
            />
          </div>

          {/* Sort */}
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="bg-surface-2 border border-border rounded-lg px-2 py-1.5 text-xs text-muted focus:outline-none cursor-pointer"
          >
            <option value="modified">Last opened</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>

          {/* View toggle */}
          <div className="flex bg-surface-2 border border-border rounded-lg overflow-hidden">
            {(["grid", "list"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-2.5 py-1.5 transition-colors ${viewMode === v ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
              >
                {v === "grid" ? (
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                ) : (
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <circle cx="3" cy="6" r="1" fill="currentColor" />
                    <circle cx="3" cy="12" r="1" fill="currentColor" />
                    <circle cx="3" cy="18" r="1" fill="currentColor" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Upload button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf,.pdf"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && handleUploadFile(e.target.files[0])
            }
          />
        </div>

        {/* Upload progress bar (when uploading) */}
        {uploadState === "uploading" && (
          <div className="bg-accent-light border-b border-[#bfdbfe] px-5 py-2 flex items-center gap-3 flex-shrink-0">
            <div className="w-3 h-3 border-2 border-accent/30 border-t-accent rounded-full animate-spin-fast flex-shrink-0" />
            <div className="flex-1 h-1.5 bg-[#bfdbfe] rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <span className="text-[10px] text-accent font-semibold font-mono">
              {uploadProgress}%
            </span>
          </div>
        )}
        {uploadState === "done" && (
          <div className="bg-ok-light border-b border-[#bbf7d0] px-5 py-2 flex items-center gap-2 text-ok text-xs font-semibold flex-shrink-0">
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            File uploaded successfully
          </div>
        )}

        {/* File content area */}
        <div
          className="flex-1 overflow-y-auto p-5"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {/* Drop overlay */}
          {dragOver && (
            <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-4xl mb-2">📂</div>
                <p className="text-accent font-semibold text-sm">
                  Drop to upload
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-full gap-3">
              <div className="w-6 h-6 border-2 border-border border-t-accent rounded-full animate-spin-fast" />
              <p className="text-sm text-muted">Loading drawings…</p>
            </div>
          ) : isEmpty ? (
            /* Empty state */
            <div
              className={`flex flex-col items-center justify-center h-full gap-4 cursor-pointer select-none`}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-20 h-20 rounded-2xl bg-accent-light flex items-center justify-center">
                <svg
                  className="w-10 h-10 text-accent"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-[#1e293b] mb-1">
                  {searchQuery
                    ? "No files match your search"
                    : "Upload your first DXF drawing"}
                </p>
                <p className="text-xs text-muted">
                  {searchQuery
                    ? "Try a different search term"
                    : "Drag & drop a .dxf or .pdf file, or click to browse"}
                </p>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            /* Grid view */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {/* Folders */}
              {visibleFolders.map((folder) => (
                <div
                  key={folder.name}
                  onDoubleClick={() => {
                    setCurrentFolder(folder.name);
                    setSelectedFile(null);
                  }}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-surface
                    hover:bg-[#fffbeb] hover:border-[#fde68a] cursor-pointer transition-all select-none"
                >
                  <FolderIcon size={40} color="#f59e0b" />
                  <p className="text-xs font-medium text-[#1e293b] text-center truncate w-full">
                    {folder.name}
                  </p>
                  <p className="text-[9px] text-muted-2">
                    {folder.fileCount} file{folder.fileCount !== 1 ? "s" : ""}
                  </p>
                </div>
              ))}

              {/* Files */}
              {visibleFiles.map((file) => (
                <div
                  key={file.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(file);
                    setShowLayerPicker(false);
                  }}
                  onDoubleClick={() => handleOpenFile(file)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, file });
                  }}
                  className={`group flex flex-col items-center gap-2 p-3 rounded-xl border cursor-pointer transition-all select-none
                    ${
                      selectedFile?.path === file.path
                        ? "bg-accent-light border-accent shadow-sm"
                        : "border-border bg-surface hover:bg-surface-2 hover:border-[#c7d2fe]"
                    }`}
                >
                  <DxfIcon size={40} />
                  <p
                    className="text-xs font-medium text-[#1e293b] text-center truncate w-full"
                    title={file.name}
                  >
                    {file.name.replace(/\.dxf$/i, "")}
                  </p>
                  <p className="text-[9px] text-muted-2">
                    {formatSize(file.size)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            /* List view */
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 bg-surface-2 border-b border-border text-[10px] font-semibold text-muted uppercase tracking-wider">
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
                <span></span>
              </div>

              {/* Folders in list */}
              {visibleFolders.map((folder) => (
                <div
                  key={folder.name}
                  onDoubleClick={() => {
                    setCurrentFolder(folder.name);
                    setSelectedFile(null);
                  }}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-border/50 last:border-0
                    hover:bg-[#fffbeb] cursor-pointer transition-colors items-center"
                >
                  <div className="flex items-center gap-2.5">
                    <FolderIcon size={20} color="#f59e0b" />
                    <span className="text-sm font-medium text-[#1e293b]">
                      {folder.name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-2">—</span>
                  <span className="text-xs text-muted-2">
                    {folder.fileCount} files
                  </span>
                  <span />
                </div>
              ))}

              {/* Files in list */}
              {visibleFiles.map((file) => (
                <div
                  key={file.path}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(file);
                    setShowLayerPicker(false);
                  }}
                  onDoubleClick={() => handleOpenFile(file)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, file });
                  }}
                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 border-b border-border/50 last:border-0
                    cursor-pointer transition-colors items-center
                    ${selectedFile?.path === file.path ? "bg-accent-light" : "hover:bg-surface-2"}`}
                >
                  <div className="flex items-center gap-2.5">
                    <DxfIcon size={20} />
                    <span className="text-sm font-medium text-[#1e293b] truncate">
                      {file.name}
                    </span>
                    {selectedFile?.path === file.path && (
                      <span className="text-[9px] bg-accent text-white px-1.5 py-0.5 rounded font-semibold">
                        Selected
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-2 text-right">
                    {formatSize(file.size)}
                  </span>
                  <span className="text-xs text-muted-2 text-right whitespace-nowrap">
                    {formatDate(file.modified)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded flex items-center justify-center text-muted hover:text-danger hover:bg-danger-light transition-all"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6M14 11v6M9 6V4h6v2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: Open selected file ── */}
      {selectedFile && (
        <aside className="w-64 flex-shrink-0 bg-surface border-l border-border flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1e293b]">
              File Details
            </h3>
            <button
              onClick={() => {
                setSelectedFile(null);
                setShowLayerPicker(false);
              }}
              className="w-5 h-5 rounded-full bg-surface-2 flex items-center justify-center text-muted text-xs hover:bg-border transition-colors"
            >
              ✕
            </button>
          </div>

          <div className="p-4 flex flex-col items-center gap-3 border-b border-border">
            <DxfIcon size={56} />
            <p className="text-sm font-semibold text-[#1e293b] text-center break-all">
              {selectedFile.name}
            </p>
          </div>

          <div className="p-4 flex flex-col gap-2.5 text-xs border-b border-border">
            {[
              { label: "Size", value: formatSize(selectedFile.size) },
              {
                label: "Last modified",
                value: formatDate(selectedFile.modified),
              },
              {
                label: "Location",
                value: selectedFile.folder || "My Drawings",
              },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center">
                <span className="text-muted font-medium">{label}</span>
                <span className="text-[#1e293b] font-semibold">{value}</span>
              </div>
            ))}
          </div>

          {!showLayerPicker ? (
            <div className="p-4">
              <button
                onClick={() => handleOpenFile(selectedFile)}
                disabled={openingFile}
                className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {openingFile ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin-fast" />{" "}
                    Opening…
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>{" "}
                    Open Drawing
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Strand Layer
                </label>
                <select
                  value={selectedLayer}
                  onChange={(e) => setSelectedLayer(e.target.value)}
                  className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent/20 cursor-pointer"
                >
                  {layers.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                {suggestedLayer && (
                  <p className="text-[10px] text-ok font-semibold mt-1">
                    ✓ Auto-detected: {suggestedLayer}
                  </p>
                )}
              </div>

              <div>
                {modelOk === null ? (
                  <div className="px-3 py-2 rounded-lg text-xs bg-surface-2 text-muted-2 border border-border">
                    Checking model…
                  </div>
                ) : modelOk ? (
                  <div className="px-3 py-2 rounded-lg text-xs bg-ok-light text-ok border border-[#bbf7d0]">
                    ✓ Model ready
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg text-xs bg-danger-light text-danger border border-[#fecaca]">
                    ✗ cad_digit_model.pt not found
                  </div>
                )}
              </div>

              <button
                disabled={!selectedLayer || !modelOk}
                onClick={() =>
                  onStartProcessing({
                    dxfPath: selectedFile.path,
                    layer: selectedLayer,
                    allLayers: layers,
                  })
                }
                className="w-full py-2.5 bg-accent text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors
                  disabled:opacity-35 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polygon
                    points="5 3 19 12 5 21 5 3"
                    fill="currentColor"
                    stroke="none"
                  />
                </svg>
                Read Drawing
              </button>

              <button
                onClick={() => setShowLayerPicker(false)}
                className="text-xs text-muted hover:text-[#1e293b] transition-colors text-center"
              >
                ← Back
              </button>
            </div>
          )}
        </aside>
      )}

      {/* ── New Folder Modal ── */}
      {showNewFolder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowNewFolder(false)}
        >
          <div
            className="bg-surface rounded-2xl p-6 w-80 shadow-2xl border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-4">New Folder</h3>
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setShowNewFolder(false);
              }}
              placeholder="Folder name…"
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewFolder(false)}
                className="flex-1 py-2 border border-border rounded-xl text-sm text-muted hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Context Menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-surface border border-border rounded-xl shadow-2xl py-1.5 w-44 text-sm"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            {
              label: "Open",
              icon: "→",
              action: () => {
                handleOpenFile(contextMenu.file);
                setContextMenu(null);
              },
            },
            {
              label: "Rename",
              icon: "✏",
              action: () => {
                setRenameTarget(contextMenu.file);
                setRenameDraft(contextMenu.file.name.replace(/\.dxf$/i, ""));
                setContextMenu(null);
              },
            },
            {
              label: "Delete",
              icon: "🗑",
              action: () => handleDeleteFile(contextMenu.file),
              danger: true,
            },
          ].map(({ label, icon, action, danger }) => (
            <button
              key={label}
              onClick={action}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-2 transition-colors
                ${danger ? "text-danger" : "text-[#1e293b]"}`}
            >
              <span className="w-4 text-center">{icon}</span> {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renameTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setRenameTarget(null)}
        >
          <div
            className="bg-surface rounded-2xl p-6 w-80 shadow-2xl border border-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold mb-4">Rename File</h3>
            <input
              autoFocus
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setRenameTarget(null);
              }}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRenameTarget(null)}
                className="flex-1 py-2 border border-border rounded-xl text-sm text-muted hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRename}
                disabled={!renameDraft.trim()}
                className="flex-1 py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
