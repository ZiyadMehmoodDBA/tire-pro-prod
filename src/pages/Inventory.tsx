import { useState } from 'react';
import {
  Search, Plus, AlertTriangle, CheckCircle, Package,
  RefreshCw, Pencil, Trash2, FileSpreadsheet, Download,
} from 'lucide-react';
import { api } from '../api/client';
import { formatCurrency } from '../lib/utils';
import AddEditTireModal from '../components/AddEditTireModal';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ExcelImportModal from '../components/ExcelImportModal';
import CatalogImportModal from '../components/CatalogImportModal';
import { usePagination } from '../lib/usePagination';
import Pagination from '../components/Pagination';
import ErrorBanner from '../components/ErrorBanner';
import TableSkeleton from '../components/TableSkeleton';
import { useFetch } from '../lib/useFetch';
import { useAsyncAction } from '../lib/useAsyncAction';

export default function Inventory() {
  const { data: tires, loading, refreshing, error, refresh: fetchTires } = useFetch<any>(api.inventory.list);
  const deleteAction = useAsyncAction();

  const [search, setSearch]         = useState('');
  const [filterType, setFilterType] = useState('all');

  const [addModal, setAddModal]     = useState(false);
  const [editTire, setEditTire]     = useState<any>(null);
  const [deleteTire, setDeleteTire] = useState<any>(null);
  const [showImport, setShowImport]             = useState(false);
  const [showCatalogImport, setShowCatalogImport] = useState(false);

  const handleDelete = () => {
    if (!deleteTire) return;
    const tire = deleteTire;
    setDeleteTire(null);
    deleteAction.execute(
      () => api.inventory.delete(tire.id),
      fetchTires,
    );
  };

  const types    = ['all', ...Array.from(new Set(tires.map((t: any) => t.type).filter(Boolean)))];
  const q        = search.toLowerCase();
  const filtered = tires.filter((t: any) => {
    const matchSearch =
      (t.brand   || '').toLowerCase().includes(q) ||
      (t.model   || '').toLowerCase().includes(q) ||
      (t.size    || '').toLowerCase().includes(q) ||
      (t.pattern || '').toLowerCase().includes(q);
    const matchType = filterType === 'all' || t.type === filterType;
    return matchSearch && matchType;
  });
  const { paged, paginationProps } = usePagination(filtered);

  const totalValue = tires.reduce((s: number, t: any) => s + (Number(t.stock) * Number(t.cost_price)), 0);
  const totalItems = tires.reduce((s: number, t: any) => s + Number(t.stock), 0);
  const lowStock   = tires.filter((t: any) => Number(t.stock) <= Number(t.reorder_level)).length;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: 'Stock Value',  value: formatCurrency(totalValue), color: 'text-slate-900',
            help: 'Total inventory at cost price' },
          { label: 'Total Units',  value: `${totalItems} pcs`,        color: 'text-teal-600',
            help: 'Sum of all units in warehouse' },
          { label: 'Low Stock',    value: `${lowStock} SKUs`,
            color: lowStock > 0 ? 'text-red-600' : 'text-emerald-600',
            help: 'Items at or below reorder level' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 sm:p-4 border border-slate-100 shadow-sm">
            <p className="text-xs text-slate-500 font-medium truncate">{s.label}</p>
            <p className={`text-sm sm:text-xl font-bold mt-1 ${s.color} truncate`}>{s.value}</p>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block truncate">{s.help}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 p-4 sm:p-5 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">Tire SKU Catalog</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchTires}
                title="Refresh"
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowCatalogImport(true)}
                title="Import from Tire Catalog"
                className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 text-xs sm:text-sm font-medium px-2.5 sm:px-3 py-2 rounded-lg hover:bg-emerald-100 transition-colors border border-emerald-200"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Catalog Import</span>
              </button>
              <button
                onClick={() => setShowImport(true)}
                title="Import from Excel"
                className="flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs sm:text-sm font-medium px-2.5 sm:px-3 py-2 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <FileSpreadsheet size={14} />
                <span className="hidden sm:inline">Import Excel</span>
              </button>
              <button
                onClick={() => setAddModal(true)}
                title="Add new tire SKU"
                className="flex items-center gap-1.5 bg-teal-600 text-white text-xs sm:text-sm font-medium px-2.5 sm:px-3 py-2 rounded-lg hover:bg-teal-700 transition-colors"
              >
                <Plus size={14} />
                <span className="hidden sm:inline">Add SKU</span>
                <span className="sm:hidden">Add</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search brand, model, size, or pattern…"
                className="pl-8 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 w-full"
              />
            </div>
            <select
              value={filterType} onChange={e => setFilterType(e.target.value)}
              title="Filter by tire type"
              className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-2 sm:px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 flex-shrink-0"
            >
              {types.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>)}
            </select>
          </div>
        </div>

        {(error || deleteAction.error) && (
          <ErrorBanner error={error || deleteAction.error} className="mx-4 sm:mx-5 mt-4" />
        )}

        {loading && !error && <TableSkeleton rows={5} />}

        {!loading && <Pagination {...paginationProps} position="top" />}

        {!loading && (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Brand','Model / Pattern','Size & Spec','Type','Stock','Cost','Sale Price','Margin','Status',''].map(h => (
                      <th key={h} className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 text-left last:w-16">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {paged.map((tire: any) => {
                    const isLow  = Number(tire.stock) <= Number(tire.reorder_level);
                    const costP  = Number(tire.cost_price);
                    const saleP  = Number(tire.sale_price);
                    const margin = costP > 0 ? ((saleP - costP) / costP * 100).toFixed(1) : '0.0';
                    const spec   = [tire.load_index, tire.speed_index].filter(Boolean).join('');

                    return (
                      <tr key={tire.id} className="hover:bg-slate-50/50 transition-colors group">
                        {/* Brand */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <Package size={14} className="text-slate-500" />
                            </div>
                            <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">{tire.brand}</span>
                          </div>
                        </td>

                        {/* Model + Pattern */}
                        <td className="px-4 py-3">
                          <p className="text-sm text-slate-800 font-medium leading-tight">{tire.model}</p>
                          {tire.pattern && (
                            <p className="text-xs text-slate-400 mt-0.5 leading-tight">{tire.pattern}</p>
                          )}
                        </td>

                        {/* Size + Load/Speed */}
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded">{tire.size}</span>
                          {spec && (
                            <span className="ml-1 text-xs font-mono font-semibold text-slate-500">{spec}</span>
                          )}
                          {tire.dot && (
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">DOT {tire.dot}</p>
                          )}
                        </td>

                        {/* Type */}
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full whitespace-nowrap">{tire.type}</span>
                        </td>

                        {/* Stock */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-slate-900'}`}>{tire.stock}</span>
                            {isLow && <AlertTriangle size={12} className="text-red-500" aria-label={`Reorder at ${tire.reorder_level}`} />}
                          </div>
                          <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-1">
                            <div
                              className={`h-full rounded-full ${isLow ? 'bg-red-400' : 'bg-emerald-400'}`}
                              style={{ width: `${Math.min((Number(tire.stock) / 80) * 100, 100)}%` }}
                            />
                          </div>
                        </td>

                        {/* Cost */}
                        <td className="px-4 py-3 text-sm text-slate-500">{formatCurrency(costP)}</td>

                        {/* Sale Price */}
                        <td className="px-4 py-3 text-sm font-semibold text-slate-900">{formatCurrency(saleP)}</td>

                        {/* Margin */}
                        <td className="px-4 py-3">
                          <span className={`text-sm font-semibold ${Number(margin) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {Number(margin) >= 0 ? '+' : ''}{margin}%
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`flex items-center gap-1 text-xs font-semibold whitespace-nowrap ${isLow ? 'text-red-600' : 'text-emerald-600'}`}>
                            {isLow ? <AlertTriangle size={12} /> : <CheckCircle size={12} />}
                            {isLow ? 'Low Stock' : 'In Stock'}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditTire(tire)}
                              title="Edit"
                              className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => setDeleteTire(tire)}
                              title="Delete"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-50">
              {paged.map((tire: any) => {
                const isLow  = Number(tire.stock) <= Number(tire.reorder_level);
                const costP  = Number(tire.cost_price);
                const saleP  = Number(tire.sale_price);
                const margin = costP > 0 ? ((saleP - costP) / costP * 100).toFixed(1) : '0.0';
                const spec   = [tire.load_index, tire.speed_index].filter(Boolean).join('');

                return (
                  <div key={tire.id} className="p-4 flex items-start gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Package size={16} className="text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900 leading-tight">{tire.brand} {tire.model}</p>
                          {tire.pattern && (
                            <p className="text-xs text-slate-400 mt-0.5 leading-tight">{tire.pattern}</p>
                          )}
                          <p className="text-xs text-slate-500 mt-1 font-mono">
                            {tire.size}{spec ? ` ${spec}` : ''}
                            <span className="font-sans text-teal-600 ml-1.5">{tire.type}</span>
                          </p>
                          {tire.dot && (
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">DOT {tire.dot}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button onClick={() => setEditTire(tire)} title="Edit"
                            className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setDeleteTire(tire)} title="Delete"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2.5">
                        <div>
                          <p className="text-xs text-slate-400">Stock</p>
                          <p className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-slate-900'}`}>{tire.stock}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Sale Price</p>
                          <p className="text-sm font-semibold text-slate-900">{formatCurrency(saleP)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-400">Margin</p>
                          <p className={`text-sm font-semibold ${Number(margin) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {Number(margin) >= 0 ? '+' : ''}{margin}%
                          </p>
                        </div>
                      </div>
                      {isLow && (
                        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                          <AlertTriangle size={11} /> Low stock — reorder at {tire.reorder_level}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filtered.length === 0 && (
              <EmptyState
                icon={Package}
                message={tires.length === 0 ? 'No tire SKUs yet. Add your first tire.' : 'No items match your search.'}
              />
            )}
          </>
        )}

        <Pagination {...paginationProps} position="bottom" />
        {lowStock > 0 && (
          <span className="px-4 pb-3 flex items-center gap-1 text-xs text-red-600 font-semibold">
            <AlertTriangle size={11} /> {lowStock} need reorder
          </span>
        )}
      </div>

      {showImport && (
        <ExcelImportModal
          entity="inventory"
          onClose={() => setShowImport(false)}
          onImported={fetchTires}
        />
      )}

      {showCatalogImport && (
        <CatalogImportModal
          onClose={() => setShowCatalogImport(false)}
          onImported={fetchTires}
        />
      )}

      {(addModal || editTire) && (
        <AddEditTireModal
          tire={editTire ?? undefined}
          onClose={() => { setAddModal(false); setEditTire(null); }}
          onSaved={fetchTires}
        />
      )}

      {deleteTire && (
        <ConfirmDialog
          title="Delete Tire SKU"
          message={`Delete "${deleteTire.brand} ${deleteTire.model} ${deleteTire.size}"? This cannot be undone. Tires used in existing sales or purchases cannot be deleted.`}
          confirmLabel="Delete SKU"
          variant="danger"
          loading={deleteAction.loading}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTire(null)}
        />
      )}
    </div>
  );
}
