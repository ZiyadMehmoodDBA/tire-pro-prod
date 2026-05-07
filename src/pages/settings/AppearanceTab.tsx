import { useState } from 'react';
import { CheckCircle2, Paintbrush } from 'lucide-react';
import { THEMES, getTheme, applyTheme, type Theme } from '../../lib/theme';
import { cn } from '../../lib/utils';

export default function AppearanceTab() {
  const [confirmed, setConfirmed] = useState<Theme>(getTheme);
  const [pending,   setPending]   = useState<Theme>(getTheme);

  const hasChanges = pending !== confirmed;

  function handleApply() {
    applyTheme(pending);
    setConfirmed(pending);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-sm font-bold text-slate-800">Colour Theme</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select a skin — changes apply instantly across the entire application when you click Apply.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {THEMES.map(theme => {
          const isConfirmed = confirmed === theme.id;
          const isSelected  = pending   === theme.id;

          return (
            <button
              key={theme.id}
              onClick={() => setPending(theme.id)}
              className={cn(
                'relative flex flex-col gap-3 p-4 rounded-2xl border-2 text-left transition-all duration-200',
                isSelected
                  ? 'border-teal-500 bg-teal-50/60 shadow-sm shadow-teal-100'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm',
              )}
            >
              {/* Swatch strip */}
              <div
                className="w-full h-10 rounded-xl shadow-inner"
                style={{ background: theme.gradient }}
              />

              {/* Colour dots */}
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full ring-2 ring-white shadow" style={{ background: theme.primary }} />
                <span className="w-5 h-5 rounded-full ring-2 ring-white shadow" style={{ background: theme.mid }} />
                <span className="w-5 h-5 rounded-full ring-2 ring-white shadow" style={{ background: theme.light }} />

                {isConfirmed && !isSelected && (
                  <span className="ml-auto text-[10px] font-bold text-slate-400 uppercase tracking-wide">Active</span>
                )}
              </div>

              {/* Label */}
              <div>
                <p className="text-sm font-bold text-slate-900">{theme.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{theme.description}</p>
              </div>

              {/* Selected check */}
              {isSelected && (
                <CheckCircle2 size={18} className="absolute top-3 right-3 text-teal-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Apply bar */}
      <div className={cn(
        'flex items-center justify-between gap-4 px-4 py-3 rounded-xl border transition-all duration-200',
        hasChanges
          ? 'bg-teal-50 border-teal-200'
          : 'bg-slate-50 border-slate-200',
      )}>
        <p className="text-xs text-slate-600">
          {hasChanges
            ? <>Selected: <span className="font-bold text-teal-700">{THEMES.find(t => t.id === pending)?.name}</span> — click Apply to activate</>
            : <span className="text-slate-400">No pending changes</span>
          }
        </p>
        <button
          onClick={handleApply}
          disabled={!hasChanges}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all',
            hasChanges
              ? 'bg-teal-600 text-white hover:bg-teal-700 shadow-sm'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed',
          )}
        >
          <Paintbrush size={14} />
          Apply Theme
        </button>
      </div>

      <p className="text-xs text-slate-400">
        Theme is saved in this browser. Each device keeps its own preference.
      </p>
    </div>
  );
}
