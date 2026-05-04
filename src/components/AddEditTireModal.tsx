import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, Package } from 'lucide-react';
import { api } from '../api/client';
import ErrorBanner from './ErrorBanner';
import { formatCurrency } from '../lib/utils';
import { getCachedSettings } from '../lib/appSettings';
import ComboboxInput from './ComboboxInput';

interface Props {
  tire?: any;
  onClose: () => void;
  onSaved: () => void;
}

const SPEED_RATINGS = ['', 'N', 'P', 'Q', 'R', 'S', 'T', 'H', 'V', 'W', 'Y', 'ZR'];

export default function AddEditTireModal({ tire, onClose, onSaved }: Props) {
  const isEdit = !!tire;
  const currency = getCachedSettings().currency || 'PKR';
  const [tireTypes, setTireTypes] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<{
    brands: string[];
    models: { brand: string; model: string }[];
    sizes:  { brand: string; model: string; size: string }[];
    patterns:     string[];
    load_indexes: string[];
  }>({ brands: [], models: [], sizes: [], patterns: [], load_indexes: [] });

  useEffect(() => {
    api.lookups.tireTypes()
      .then(types => setTireTypes(types.map((t: any) => t.name)))
      .catch(() => setTireTypes(['Passenger', 'SUV', '4x4', 'LT', 'Performance', 'Motorcycle']));
    api.lookups.tireSuggestions().then(setSuggestions).catch(() => {});
  }, []);

  const [form, setForm] = useState({
    brand:         tire?.brand         ?? '',
    model:         tire?.model         ?? '',
    size:          tire?.size          ?? '',
    type:          tire?.type          ?? 'Passenger',
    pattern:       tire?.pattern       ?? '',
    load_index:    tire?.load_index    ?? '',
    speed_index:   tire?.speed_index   ?? '',
    dot:           tire?.dot           ?? '',
    stock:         tire?.stock         ?? 0,
    reorder_level: tire?.reorder_level ?? 10,
    cost_price:    tire?.cost_price    ?? 0,
    sale_price:    tire?.sale_price    ?? 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);

  const set = (field: string, val: string | number) =>
    setForm(f => ({ ...f, [field]: val }));

  // Cascade-aware handlers: changing brand resets model+size; changing model resets size
  const setBrand = (val: string) => setForm(f => ({ ...f, brand: val, model: '', size: '' }));
  const setModel = (val: string) => setForm(f => ({ ...f, model: val, size: '' }));

  // Derive combobox option lists client-side — cascade filter by brand/model
  const brandOptions = suggestions.brands;

  const modelOptions = (() => {
    const matched = suggestions.brands.find(b => b.toLowerCase() === form.brand.toLowerCase().trim());
    if (matched) {
      return suggestions.models
        .filter(m => m.brand.toLowerCase() === matched.toLowerCase())
        .map(m => m.model);
    }
    return [...new Set(suggestions.models.map(m => m.model))];
  })();

  const sizeOptions = (() => {
    const matchedBrand = suggestions.brands.find(b => b.toLowerCase() === form.brand.toLowerCase().trim());
    const matchedModel = matchedBrand
      ? suggestions.models.find(
          m => m.brand.toLowerCase() === matchedBrand.toLowerCase() &&
               m.model.toLowerCase() === form.model.toLowerCase().trim()
        )
      : undefined;
    if (matchedBrand && matchedModel) {
      return suggestions.sizes
        .filter(
          s => s.brand.toLowerCase() === matchedBrand.toLowerCase() &&
               s.model.toLowerCase() === matchedModel.model.toLowerCase()
        )
        .map(s => s.size);
    }
    return [...new Set(suggestions.sizes.map(s => s.size))];
  })();

  const costP  = Number(form.cost_price);
  const saleP  = Number(form.sale_price);
  const margin = costP > 0 ? (((saleP - costP) / costP) * 100).toFixed(1) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.brand.trim() || !form.model.trim() || !form.size.trim()) {
      return setError('Brand, model, and size are required.');
    }
    if (saleP > 0 && costP > saleP) {
      return setError('Sale price should not be less than cost price.');
    }
    setLoading(true);
    setError('');
    try {
      const payload = {
        brand:         form.brand.trim(),
        model:         form.model.trim(),
        size:          form.size.trim(),
        type:          form.type,
        pattern:       form.pattern.trim()     || null,
        load_index:    form.load_index.trim()  || null,
        speed_index:   form.speed_index        || null,
        dot:           form.dot.trim()         || null,
        stock:         Number(form.stock),
        reorder_level: Number(form.reorder_level),
        cost_price:    costP,
        sale_price:    saleP,
      };
      if (isEdit) {
        await api.inventory.update(tire.id, payload);
      } else {
        await api.inventory.create(payload);
      }
      setSuccess(true);
      setTimeout(() => { onSaved(); onClose(); }, 800);
    } catch (err: any) {
      setError(err.message || 'Failed to save tire');
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={e => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[94vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
              <Package size={15} className="text-emerald-600" />
            </div>
            <h2 className="text-base font-bold text-slate-900">
              {isEdit ? 'Edit Tire SKU' : 'Add Tire SKU'}
            </h2>
          </div>
          <button onClick={onClose} disabled={loading} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X size={18} className="text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
            <ErrorBanner error={error} />

            {/* ── Identification ─────────────────────────────────── */}
            <fieldset>
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Tire Identification
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Brand <span className="text-red-500">*</span>
                  </label>
                  <ComboboxInput
                    value={form.brand}
                    onChange={setBrand}
                    options={brandOptions}
                    placeholder="e.g. Bridgestone"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Model <span className="text-red-500">*</span>
                  </label>
                  <ComboboxInput
                    value={form.model}
                    onChange={setModel}
                    options={modelOptions}
                    placeholder="e.g. Ecopia EP150"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Size <span className="text-red-500">*</span>
                  </label>
                  <ComboboxInput
                    value={form.size}
                    onChange={val => set('size', val)}
                    options={sizeOptions}
                    placeholder="e.g. 205/55R16"
                    inputClassName="font-mono"
                  />
                  <p className="text-xs text-slate-400 mt-1">Width/Aspect R Rim</p>
                </div>
              </div>
            </fieldset>

            {/* ── Technical Specs ────────────────────────────────── */}
            <fieldset>
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Technical Specifications
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tread Pattern
                  </label>
                  <ComboboxInput
                    value={form.pattern}
                    onChange={val => set('pattern', val)}
                    options={suggestions.patterns}
                    placeholder="e.g. EfficientGrip, Alenza Sport"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Load Index
                  </label>
                  <ComboboxInput
                    value={form.load_index}
                    onChange={val => set('load_index', val)}
                    options={suggestions.load_indexes}
                    placeholder="e.g. 91"
                    inputClassName="text-center font-mono"
                    maxLength={3}
                  />
                  <p className="text-xs text-slate-400 mt-1">Max load rating</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Speed Index
                  </label>
                  <select
                    value={form.speed_index}
                    onChange={e => set('speed_index', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50 text-center font-mono"
                  >
                    {SPEED_RATINGS.map(r => (
                      <option key={r} value={r}>{r || '—'}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">Max speed rating</p>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  DOT Code
                </label>
                <div className="flex items-center gap-3">
                  <input
                    value={form.dot}
                    onChange={e => set('dot', e.target.value.replace(/[^0-9A-Za-z\s]/g, '').toUpperCase())}
                    placeholder="e.g. 4521"
                    maxLength={20}
                    className="w-40 text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50 font-mono tracking-widest"
                  />
                  <p className="text-xs text-slate-400 leading-snug">
                    Last 4 digits of DOT code.<br />
                    WWYY — e.g. <span className="font-mono">4521</span> = week 45, year 2021.
                  </p>
                </div>
              </div>
            </fieldset>

            {/* ── Category & Stock ───────────────────────────────── */}
            <fieldset>
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Category & Stock
              </legend>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Tire Type</label>
                  <select
                    value={form.type}
                    onChange={e => set('type', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50"
                  >
                    {tireTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Stock (units)</label>
                  <input
                    type="number" min={0}
                    value={form.stock}
                    onChange={e => set('stock', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50 text-center"
                  />
                  <p className="text-xs text-slate-400 mt-1">Current qty on hand</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Reorder At</label>
                  <input
                    type="number" min={0}
                    value={form.reorder_level}
                    onChange={e => set('reorder_level', e.target.value)}
                    className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50 text-center"
                  />
                  <p className="text-xs text-slate-400 mt-1">Low-stock alert level</p>
                </div>
              </div>
            </fieldset>

            {/* ── Pricing ────────────────────────────────────────── */}
            <fieldset>
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Pricing ({currency})
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">{currency}</span>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.cost_price}
                      onChange={e => set('cost_price', e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Your purchase cost per unit</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Sale Price</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">{currency}</span>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.sale_price}
                      onChange={e => set('sale_price', e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Default price on invoices</p>
                </div>
              </div>
            </fieldset>

            {/* Live margin preview */}
            {costP > 0 && saleP > 0 && (
              <div className={`rounded-xl p-3 flex items-center justify-between border ${
                Number(margin) >= 0 ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
              }`}>
                <div>
                  <p className="text-xs font-semibold text-slate-600">Calculated Margin</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatCurrency(costP)} cost → {formatCurrency(saleP)} sale
                  </p>
                </div>
                <span className={`text-lg font-bold ${Number(margin) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {Number(margin) >= 0 ? '+' : ''}{margin}%
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100 flex-shrink-0">
            <button
              type="button" onClick={onClose} disabled={loading}
              className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={loading || success}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-60 min-w-32 justify-center"
            >
              {loading  ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
              : success ? <><CheckCircle size={15} /> Saved!</>
              : isEdit  ? 'Update SKU'
              : 'Add SKU'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
