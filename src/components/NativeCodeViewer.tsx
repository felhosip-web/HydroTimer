import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Copy, Check, FileCode, Download, Smartphone, Terminal, GitBranch, Github, Play, ArrowDownToLine, Loader2, Sparkles } from 'lucide-react';
import { nativeAndroidProject, AndroidFile, generateFullProjectZip } from '../services/nativeAndroidCode';

interface NativeCodeViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NativeCodeViewer: React.FC<NativeCodeViewerProps> = ({ isOpen, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<AndroidFile>(nativeAndroidProject[0]);
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipSuccess, setZipSuccess] = useState(false);

  if (!isOpen) return null;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([selectedFile.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedFile.path.split('/').pop() || 'file.kt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadFullZip = async () => {
    try {
      setIsZipping(true);
      const zipBlob = await generateFullProjectZip();
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'HydroTimer-Android-GitHub-Ready.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setZipSuccess(true);
      setTimeout(() => setZipSuccess(false), 3500);
    } catch (err) {
      console.error('ZIP generation error:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-5xl h-[92vh] bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20 shrink-0">
              <Github className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>GitHub APK Fordítási Csomag &amp; Workflows</span>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                  GitHub Actions CI Ready
                </span>
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Teljes mappa- és fájlszerkezet: push után a GitHub automatikusan lefordítja és letölthetővé teszi az APK-t
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="download-full-project-zip-btn"
              onClick={handleDownloadFullZip}
              disabled={isZipping}
              className="hidden sm:flex items-center gap-2 py-2 px-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-900/30 border border-emerald-500/30 transition-all active:scale-95 disabled:opacity-50"
            >
              {isZipping ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>ZIP Készítése...</span>
                </>
              ) : zipSuccess ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Letöltve!</span>
                </>
              ) : (
                <>
                  <ArrowDownToLine className="w-4 h-4" />
                  <span>Teljes Projekt ZIP</span>
                </>
              )}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Workflow Info Bar */}
        <div className="bg-slate-950 px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <GitBranch className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400">CI Munkafolyamat:</span>
            <span className="font-mono text-sky-300 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/50">.github/workflows/build-apk.yml</span>
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Java 17 Zulu + Gradle 8.4</span>
            </span>
            <span className="text-slate-600">•</span>
            <span>Target: <strong className="text-slate-300">Android 14 (API 34)</strong></span>
          </div>
        </div>

        {/* Content Area: Sidebar + Code Display */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* File Explorer Sidebar */}
          <div className="w-full md:w-80 bg-slate-950/90 border-r border-slate-800 p-3 overflow-y-auto space-y-1.5 shrink-0">
            {/* Mobile download zip button */}
            <div className="sm:hidden mb-2">
              <button
                onClick={handleDownloadFullZip}
                disabled={isZipping}
                className="w-full py-2 px-3 bg-emerald-600 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
              >
                <ArrowDownToLine className="w-4 h-4" />
                <span>Teljes Projekt ZIP Letöltése</span>
              </button>
            </div>

            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-2 py-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5 text-sky-400" />
                <span>Mappa- &amp; Fájlszerkezet</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">{nativeAndroidProject.length} fájl</span>
            </div>

            {nativeAndroidProject.map((file) => {
              const isSelected = selectedFile.path === file.path;
              const isWorkflow = file.path.includes('.github');
              const isGradle = file.path.includes('gradle');
              const isKotlin = file.path.endsWith('.kt');

              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start gap-2.5 ${
                    isSelected
                      ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium'
                      : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="mt-0.5 text-slate-400 shrink-0">
                    {isWorkflow ? (
                      <Play className="w-4 h-4 text-emerald-400" />
                    ) : isGradle ? (
                      <Terminal className="w-4 h-4 text-amber-400" />
                    ) : isKotlin ? (
                      <Smartphone className="w-4 h-4 text-sky-400" />
                    ) : (
                      <FileCode className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-white">{file.name}</div>
                    <div className="truncate text-[10px] text-slate-400 font-mono">{file.path}</div>
                  </div>
                </button>
              );
            })}

            {/* Quick GitHub Guide Box */}
            <div className="mt-4 p-3.5 bg-slate-900/90 border border-slate-800 rounded-2xl">
              <div className="text-xs font-bold text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Hogyan fordul le az APK?</span>
              </div>
              <ol className="text-[11px] text-slate-400 space-y-1.5 list-decimal list-inside leading-relaxed">
                <li>Töltsd le a <strong className="text-slate-200">ZIP csomagot</strong> a fenti gombbal.</li>
                <li>Hozd létre a GitHub tárolót és pushold fel a fájlokat (<code className="text-sky-300 font-mono text-[10px]">git push</code>).</li>
                <li>A GitHubon lépj az <strong className="text-slate-200">Actions</strong> fülre.</li>
                <li>A zöld pipa után kattints a futásra, és az <strong className="text-emerald-400 font-medium">Artifacts &gt; HydroTimer-Debug-APK</strong> linkről töltsd le az APK-t!</li>
              </ol>
            </div>
          </div>

          {/* Code Viewer Panel */}
          <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
            {/* Action Bar */}
            <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <div className="text-xs font-bold text-white truncate flex items-center gap-2">
                  <span>{selectedFile.name}</span>
                  <span className="font-mono text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                    {selectedFile.path}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">{selectedFile.description}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  id="copy-android-code-btn"
                  onClick={handleCopyCode}
                  className="py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-700 transition-all active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Másolva!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Kód Másolása</span>
                    </>
                  )}
                </button>

                <button
                  id="download-android-file-btn"
                  onClick={handleDownloadFile}
                  title="Csak ennek a fájlnak a letöltése"
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs border border-slate-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Code Body */}
            <div className="flex-1 p-4 overflow-auto font-['JetBrains_Mono',monospace] text-xs leading-relaxed text-slate-200 bg-slate-950 selection:bg-sky-500/30">
              <pre>
                <code>{selectedFile.code}</code>
              </pre>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
