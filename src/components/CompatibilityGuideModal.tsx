import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle2, AlertCircle, Smartphone, Watch, Settings, Bell, ShieldCheck } from 'lucide-react';

interface CompatibilityGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CompatibilityGuideModal: React.FC<CompatibilityGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-7 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500/10 text-sky-400 rounded-2xl border border-sky-500/20">
              <Watch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Honor Okosóra Kompatibilitás (Honor Health)
              </h2>
              <p className="text-xs text-slate-400">
                Hogyan működik az ismétlődő időzítő Honor okosórákon és pántokon?
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 space-y-5 text-xs text-slate-300">
          {/* Answer Box */}
          <div className="p-4 bg-emerald-950/40 border border-emerald-800/40 rounded-2xl flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-sm text-emerald-300 mb-1">
                Igen, tökéletesen működik Honor órákkal is!
              </div>
              <p className="text-slate-300 leading-relaxed">
                A Honor okosórák (Honor Choice, Honor Watch 4, GS 3, Honor Band széria) a telefonos <strong>Honor Egészség (Honor Health)</strong> alkalmazáson keresztül kapják meg az értesítéseket. Amikor a HydroTimer időzítője jelez a telefonon, az <strong>azonnal átküldi az értesítést és megrezgeti a Honor órádat a csuklódon</strong>.
              </p>
            </div>
          </div>

          {/* Setup Steps for Honor */}
          <div className="space-y-3">
            <h3 className="font-bold text-sm text-white flex items-center gap-2">
              <Settings className="w-4 h-4 text-sky-400" />
              <span>Egyszerű beállítási lépések Honor órához:</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center mb-2">
                  1
                </div>
                <div className="font-bold text-slate-200 mb-1">Honor Egészség App</div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Nyisd meg a <strong>Honor Egészség</strong> (Honor Health) appot a telefonodon, és válaszd ki a csatlakoztatott órádat.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center mb-2">
                  2
                </div>
                <div className="font-bold text-slate-200 mb-1">Értesítések Bekapcsolása</div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Lépj az <strong>Értesítések (Notifications)</strong> menübe, és engedélyezd a <strong>HydroTimer</strong> (vagy a használt böngésző/Android app) értesítéseit.
                </p>
              </div>

              <div className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-2xl">
                <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold flex items-center justify-center mb-2">
                  3
                </div>
                <div className="font-bold text-slate-200 mb-1">Akkumulátorkímélő Kikapcsolása</div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  A telefon beállításaiban állítsd a HydroTimer / Honor Egészség app akkumulátorhasználatát <strong>"Korlátlan"</strong> vagy <strong>"Kézi kezelés"</strong> módra a megbízható háttérműködéshez.
                </p>
              </div>
            </div>
          </div>

          {/* Technology comparison table */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-2">
            <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Hogyan működnek a különböző okosóra típusok?</span>
            </h4>
            <div className="space-y-2 text-[11px]">
              <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 flex items-start justify-between gap-2">
                <div>
                  <strong className="text-sky-300">Honor / Huawei / Xiaomi / Amazfit órák (RTOS / MagicOS):</strong>
                  <div className="text-slate-400 mt-0.5">
                    A rendszerértesítéseken keresztül rezegnek a csuklón a beállított ismétlődő időközönként.
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold shrink-0">
                  Támogatott
                </span>
              </div>

              <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800/80 flex items-start justify-between gap-2">
                <div>
                  <strong className="text-sky-300">Google Wear OS órák (Samsung Galaxy Watch 4-7, Pixel Watch):</strong>
                  <div className="text-slate-400 mt-0.5">
                    Közvetlen külön óraalkalmazás és DataClient szinkronizáció is futtatható rajta.
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold shrink-0">
                  Támogatott
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-white rounded-xl text-xs font-bold transition-all shadow-md"
          >
            Értem, rendben
          </button>
        </div>
      </motion.div>
    </div>
  );
};
