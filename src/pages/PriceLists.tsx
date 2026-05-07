import { useState, useEffect, useMemo } from 'react';
import {
  Tag, Download, Search, Loader2, CheckCircle, TrendingUp, TrendingDown,
  Info, ChevronDown, ChevronUp, Link2, Link2Off, X,
} from 'lucide-react';
import { api } from '../api/client';
import { formatCurrency } from '../lib/utils';

const CATEGORIES = [
  'All','Passenger Radial','Light Truck Bias','Light Truck Radial',
  'Truck/Bus','Tractor Front','Tractor Rear',
];
const CAT_LABEL: Record<string, string> = {
  'All':'All','Passenger Radial':'Passenger','Light Truck Bias':'LT Bias',
  'Light Truck Radial':'LT Radial','Truck/Bus':'Truck/Bus',
  'Tractor Front':'Tractor Front','Tractor Rear':'Tractor Rear',
};

function LinkDialog({
  item, onSave, onClose,
}: {
  item: any;
  onSave: (itemId: number, tireId: number | null) => Promise<void>;
  onClose: () => void;
}) {
  const [search,   setSearch]   = useState('');
  const [tires,    setTires]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [selected, setSelected] = useState<number | null>(item.linked_tire_id ?? null);

  useEffect(() => {
    api.inventory.list().then(data => { setTires(data); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) {
      const sizeMatch = tires.filter(t => t.size === item.size);
      const rest      = tires.filter(t => t.size !== item.size);
      return [...sizeMatch, ...rest].slice(0, 60);
    }
    const q = search.toLowerCase();
    return tires.filter(t =>
      t.size.toLowerCase().includes(q) ||
      t.model.toLowerCase().includes(q) ||
      t.brand.toLowerCase().includes(q)
    ).slice(0, 60);
  }, [tires, search, item.size]);

  async function handleSave() {
    setSaving(true);
    try { await onSave(item.id, selected); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Link to Inventory SKU</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-mono bg-slate-100 rounded px-1">{item.size}</span>
              {' '}{item.design}{item.category !== 'Passenger Radial' ? ` ${item.ply_rating}PR` : ''}
              {' · '}Dealer: {formatCurrency(item.dealer_price)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by size, brand, or model..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          {!search && (
            <p className="text-xs text-slate-500 mt-1.5 px-1">
              Showing matching size first. Search to find others.
            </p>
          )}
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-slate-50">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-teal-400" size={20} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-slate-400 text-sm py-10">No tires found.</p>
          ) : (
            filtered.map(tire => {
              const isSelected = selected === tire.id;
              const isSameSize = tire.size === item.size;
              return (
                <button
                  key={tire.id}
                  onClick={() => setSelected(isSelected ? null : tire.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? 'bg-teal-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    isSelected ? 'border-teal-500 bg-teal-500' : 'border-slate-300'
                  }`}>
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 truncate">
                        {tire.brand} {tire.model}
                      </span>
                      {isSameSize && (
                        <span className="text-[10px] font-bold bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          Same Size
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="font-mono text-xs text-slate-600 bg-slate-100 rounded px-1">{tire.size}</span>
                      <span className="text-xs font-medium text-slate-600">Cost: {formatCurrency(tire.cost_price)}</span>
                      <span className="text-xs font-medium text-slate-600">Stock: {tire.stock}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex-shrink-0">
          <button
            onClick={() => setSelected(null)}
            disabled={!item.linked_tire_id && selected === null}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Link2Off size={12} /> Clear Link
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl transition-colors"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
              {selected ? 'Save Link' : 'Clear Link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PriceLists() {
  const [priceList,  setPriceList]  = useState<any | null>(null);
  const [items,      setItems]      = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [category,   setCategory]   = useState('All');
  const [margin,     setMargin]     = useState(12);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState<{ imported: number; updated: number } | null>(null);
  const [notesOpen,  setNotesOpen]  = useState(false);
  const [linkingItem,setLinkingItem]= useState<any | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const lists = await api.priceLists.list();
      if (!lists.length) { setLoading(false); return; }
      const list = lists[0];
      setPriceList(list);
      const data = await api.priceLists.items(list.id);
      setItems(data);
    } catch { /* empty state handles it */ }
    finally { setLoading(false); }
  }

  const filtered = useMemo(() => {
    let rows = items;
    if (category !== 'All') rows = rows.filter(i => i.category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(i => i.size.toLowerCase().includes(q) || i.design.toLowerCase().includes(q));
    }
    return rows;
  }, [items, category, search]);

  const catCounts = useMemo(() => {
    const c: Record<string,number> = { All: items.length };
    for (const cat of CATEGORIES.slice(1)) c[cat] = items.filter(i => i.category === cat).length;
    return c;
  }, [items]);

  const inInventory = items.filter(i => i.tire_id != null || i.lt_id != null).length;
  const notAdded    = items.length - inInventory;

  const selInFiltered = filtered.filter(i => selected.has(i.id));
  const selNew        = selInFiltered.filter(i => !i.tire_id && !i.lt_id).length;
  const selUpdate     = selInFiltered.filter(i => !!i.tire_id || !!i.lt_id).length;
  const allSel        = filtered.length > 0 && filtered.every(i => selected.has(i.id));

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function clearSel() { setSelected(new Set()); }
  function selectAllFiltered() { setSelected(new Set(filtered.map(i => i.id))); }
  function selectNewOnly() { setSelected(new Set(filtered.filter(i => !i.tire_id && !i.lt_id).map(i => i.id))); }

  async function handleImport() {
    if (!priceList || !selected.size) return;
    setImporting(true); setResult(null);
    try {
      const res = await api.priceLists.import(priceList.id, { item_ids: Array.from(selected), margin });
      setResult(res); clearSel(); loadData();
    } catch (err: any) { alert(err.message || 'Import failed'); }
    finally { setImporting(false); }
  }

  async function handleSaveLink(itemId: number, tireId: number | null) {
    await api.priceLists.link(itemId, tireId);
    setLinkingItem(null);
    loadData();
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-teal-500" size={28} />
    </div>
  );
  if (!priceList) return (
    <div className="p-8 text-center text-slate-400 text-sm">No price lists found.</div>
  );

  const noteItems   = priceList.notes?.split('|||').filter(Boolean) ?? [];
  const dateLabel   = new Date(priceList.effective_date)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto pb-28">

      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Tag size={18} className="text-teal-600" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                {priceList.supplier_name} Dealers' Price List
              </h1>
              <p className="text-xs text-slate-500">Effective {dateLabel} · 18% GST included</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-center px-3 py-2 bg-slate-50 rounded-xl border border-slate-100">
              <div className="text-base font-bold text-slate-800">{items.length}</div>
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">SKUs</div>
            </div>
            <div className="text-center px-3 py-2 bg-emerald-50 rounded-xl border border-emerald-100">
              <div className="text-base font-bold text-emerald-700">{inInventory}</div>
              <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide">Linked</div>
            </div>
            <div className="text-center px-3 py-2 bg-amber-50 rounded-xl border border-amber-100">
              <div className="text-base font-bold text-amber-700">{notAdded}</div>
              <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">New</div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes / conditions banner */}
      {noteItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setNotesOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          >
            <div className="flex items-center gap-2 text-amber-800">
              <Info size={14} className="flex-shrink-0" />
              <span className="text-xs font-semibold">
                {notesOpen ? 'Price Conditions' : noteItems[1]}
              </span>
            </div>
            {notesOpen
              ? <ChevronUp size={14} className="text-amber-600 flex-shrink-0" />
              : <ChevronDown size={14} className="text-amber-600 flex-shrink-0" />}
          </button>
          {notesOpen && (
            <div className="px-4 pb-3 border-t border-amber-200/60">
              <ol className="mt-2 space-y-1">
                {noteItems.map((note: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-amber-800">
                    <span className="font-bold flex-shrink-0 text-amber-600">{i + 1}.</span>
                    {note}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Success banner */}
      {result && (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-emerald-700 text-sm font-semibold">
            <CheckCircle size={15} />
            {result.imported > 0 && <span>{result.imported} new tire{result.imported !== 1 ? 's' : ''} added</span>}
            {result.imported > 0 && result.updated > 0 && <span>·</span>}
            {result.updated  > 0 && <span>{result.updated} cost price{result.updated !== 1 ? 's' : ''} updated</span>}
          </div>
          <button onClick={() => setResult(null)} className="text-emerald-600 hover:text-emerald-800 text-xs px-2">✕</button>
        </div>
      )}

      {/* Catalog card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

        {/* Category tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-slate-100 overflow-x-auto">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => { setCategory(cat); clearSel(); }}
              className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                category === cat ? 'bg-teal-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {CAT_LABEL[cat]}{catCounts[cat] ? ` (${catCounts[cat]})` : ''}
            </button>
          ))}
        </div>

        {/* Search + margin + quick select */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/40">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search size or design..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-semibold text-slate-500">Margin</span>
            <input
              type="number" min={0} max={200} step={1}
              value={margin}
              onChange={e => setMargin(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-14 text-sm font-bold border border-slate-200 rounded-lg px-2 py-1.5 text-center bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <span className="text-xs font-semibold text-slate-500">%</span>
          </div>
          <button
            onClick={selectNewOnly}
            disabled={filtered.filter(i => !i.tire_id && !i.lt_id).length === 0}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap flex-shrink-0"
          >
            Select {filtered.filter(i => !i.tire_id && !i.lt_id).length} New
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100">
                <th className="w-8 px-3 py-2.5">
                  <input type="checkbox" checked={allSel}
                    onChange={() => allSel ? clearSel() : selectAllFiltered()}
                    className="rounded text-teal-500 cursor-pointer" />
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-600 uppercase tracking-wider">Size</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-600 uppercase tracking-wider">Design</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-bold text-slate-600 uppercase tracking-wider">PLY</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-bold text-slate-600 uppercase tracking-wider hidden lg:table-cell">Category</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-emerald-600 uppercase tracking-wider whitespace-nowrap">SET Price</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-bold text-teal-600 uppercase tracking-wider hidden sm:table-cell whitespace-nowrap">Retail @{margin}%</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-bold text-slate-600 uppercase tracking-wider">Status</th>
                <th className="w-8 px-2 py-2.5 text-center text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <Link2 size={11} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(item => {
                const isSel        = selected.has(item.id);
                const autoLinked   = item.tire_id != null;
                const manualLinked = item.lt_id   != null;
                const anyLinked    = autoLinked || manualLinked;
                const retailPrice  = Math.round(item.dealer_price * (1 + margin / 100));
                const refCost      = manualLinked ? item.linked_cost : autoLinked ? item.current_cost : null;
                const priceDiff    = refCost != null ? item.dealer_price - refCost : 0;
                const hasDiff      = Math.abs(priceDiff) > 0.99;
                const hasTube      = item.tube_total != null;
                const hasFlap      = item.flap_total != null;
                return (
                  <tr
                    key={item.id}
                    onClick={() => toggle(item.id)}
                    className={`cursor-pointer transition-colors ${
                      isSel        ? 'bg-teal-50' :
                      manualLinked ? 'bg-blue-50/20 hover:bg-blue-50/40' :
                      autoLinked   ? 'bg-emerald-50/20 hover:bg-emerald-50/40' :
                                     'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-3 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(item.id)}
                        className="rounded text-teal-500 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 rounded px-1.5 py-0.5 whitespace-nowrap">
                        {item.size}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-sm font-medium text-slate-900">{item.design}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                        {item.ply_rating}PR
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden lg:table-cell">
                      <span className="text-xs font-medium text-slate-600">{CAT_LABEL[item.category] ?? item.category}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-sm font-bold text-slate-900">{formatCurrency(item.dealer_price)}</span>
                      {(hasTube || hasFlap) && (
                        <div className="text-[10px] font-semibold text-teal-600 mt-0.5 whitespace-nowrap">
                          T:{formatCurrency(item.tyre_total)}
                          {hasTube && <> +≡{formatCurrency(item.tube_total)}</>}
                          {hasFlap && <> +F{formatCurrency(item.flap_total)}</>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                      <span className="text-sm font-semibold text-teal-700">{formatCurrency(retailPrice)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {manualLinked ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Linked
                          </span>
                          <span className="text-xs font-semibold text-blue-700 truncate max-w-[80px]">
                            {item.linked_brand} {item.linked_model}
                          </span>
                          {hasDiff && (
                            <span className={`flex items-center gap-0.5 text-xs font-bold ${priceDiff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                              {priceDiff > 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                              {formatCurrency(Math.abs(priceDiff))}
                            </span>
                          )}
                        </div>
                      ) : autoLinked ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                            In Inventory
                          </span>
                          {hasDiff && (
                            <span className={`flex items-center gap-0.5 text-xs font-bold ${priceDiff > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                              {priceDiff > 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                              {formatCurrency(Math.abs(priceDiff))}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">New</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setLinkingItem(item)}
                        title={anyLinked ? 'Change link' : 'Link to SKU'}
                        className={`p-1.5 rounded-lg transition-colors ${
                          manualLinked
                            ? 'text-blue-500 hover:bg-blue-100'
                            : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Link2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-16 text-center text-slate-400 text-sm">No items match your search.</div>
          )}
        </div>

        {/* Table footer */}
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">{filtered.length} SKUs</span>
          <span className="text-xs font-medium text-slate-500">SET = Tyre + Tube + Flap · incl. 18% GST</span>
        </div>
      </div>

      {/* Floating import bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 text-white rounded-2xl px-5 py-3.5 shadow-2xl ring-1 ring-white/10">
          <div className="text-sm">
            <span className="font-bold">{selected.size}</span>
            <span className="text-slate-400 text-xs ml-1.5">selected</span>
            <span className="text-slate-400 text-xs ml-2">
              ({selNew > 0 && <span className="text-amber-400">{selNew} new</span>}
              {selNew > 0 && selUpdate > 0 && <span className="text-slate-500"> · </span>}
              {selUpdate > 0 && <span className="text-teal-400">{selUpdate} updates</span>})
            </span>
          </div>
          <div className="w-px h-5 bg-white/20" />
          <span className="text-xs text-slate-400">at {margin}% margin</span>
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
          >
            {importing ? <><Loader2 size={13} className="animate-spin"/> Importing...</> : <><Download size={13}/> Import to Inventory</>}
          </button>
          <button onClick={clearSel} className="text-slate-500 hover:text-white text-sm transition-colors">✕</button>
        </div>
      )}

      {/* SKU Link Dialog */}
      {linkingItem && (
        <LinkDialog
          item={linkingItem}
          onSave={handleSaveLink}
          onClose={() => setLinkingItem(null)}
        />
      )}
    </div>
  );
}
