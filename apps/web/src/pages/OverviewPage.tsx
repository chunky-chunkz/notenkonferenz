import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { itemsApi, ItemsFilter } from '../lib/api';
import { Pagination } from '../components/Pagination';

export function OverviewPage() {
  const [filters, setFilters] = useState<ItemsFilter>({ page: 1, pageSize: 25 });
  const [noteRange, setNoteRange] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['items-overview', filters],
    queryFn: () => itemsApi.list(filters),
  });

  const updateFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value, page: 1 }));
  };

  const handleNoteRange = (value: string) => {
    setNoteRange(value);
    // Parse formats: "4.5-5.0", "4.5 - 5.0", "4.5", ">4.5", "<5.0"
    const trimmed = value.trim();
    if (!trimmed) {
      setFilters((prev) => { const f = { ...prev, page: 1 }; delete f.noteMin; delete f.noteMax; delete f.note; return f; });
      return;
    }
    const rangeMatch = trimmed.match(/^([0-9.]+)\s*[-–]\s*([0-9.]+)$/);
    if (rangeMatch) {
      setFilters((prev) => ({ ...prev, noteMin: rangeMatch[1], noteMax: rangeMatch[2], note: undefined, page: 1 }));
      return;
    }
    const gtMatch = trimmed.match(/^>\s*([0-9.]+)$/);
    if (gtMatch) {
      setFilters((prev) => ({ ...prev, noteMin: gtMatch[1], noteMax: undefined, note: undefined, page: 1 }));
      return;
    }
    const ltMatch = trimmed.match(/^<\s*([0-9.]+)$/);
    if (ltMatch) {
      setFilters((prev) => ({ ...prev, noteMax: ltMatch[1], noteMin: undefined, note: undefined, page: 1 }));
      return;
    }
    // Single value
    setFilters((prev) => ({ ...prev, note: trimmed, noteMin: undefined, noteMax: undefined, page: 1 }));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Übersicht</h1>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input
            placeholder="ID"
            value={filters.kandidatId ?? ''}
            onChange={(e) => updateFilter('kandidatId', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="Name"
            value={filters.name ?? ''}
            onChange={(e) => updateFilter('name', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="Note (z.B. 4.5-5.0, >4.0, <5.5, 4.5)"
            value={noteRange}
            onChange={(e) => handleNoteRange(e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="Hauptexperte"
            value={filters.hauptexperte ?? ''}
            onChange={(e) => updateFilter('hauptexperte', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="VF"
            value={filters.vf ?? ''}
            onChange={(e) => updateFilter('vf', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="Nebenexperte"
            value={filters.nebenexperte ?? ''}
            onChange={(e) => updateFilter('nebenexperte', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <select
            value={filters.nkVisiert ?? ''}
            onChange={(e) => updateFilter('nkVisiert', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">Visiert: Alle</option>
            <option value="true">Ja</option>
            <option value="false">Nein</option>
          </select>
          <select
            value={filters.nkChange ?? ''}
            onChange={(e) => updateFilter('nkChange', e.target.value)}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          >
            <option value="">Angepasst: Alle</option>
            <option value="true">Ja</option>
            <option value="false">Nein</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">ID</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Fachrichtung</th>
                  <th className="px-4 py-3 text-left">HEX</th>
                  <th className="px-4 py-3 text-left">NEX</th>
                  <th className="px-4 py-3 text-left">VF</th>
                  <th className="px-4 py-3 text-left">Note</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item: any) => (
                  <tr key={item.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-4 py-2">
                      <Link to={`/details/${item.kandidatId}`} className="text-primary-600 hover:underline">
                        {item.kandidatId}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{item.kandidat?.vorname} {item.kandidat?.nachname}</td>
                    <td className="px-4 py-2">{item.fachrichtung}</td>
                    <td className="px-4 py-2">{item.hauptexperte?.vorname} {item.hauptexperte?.nachname}</td>
                    <td className="px-4 py-2">{item.nebenexperte?.vorname} {item.nebenexperte?.nachname}</td>
                    <td className="px-4 py-2">{item.vf?.vorname} {item.vf?.nachname}</td>
                    <td className="px-4 py-2 font-medium">{item.notePaErrechnet ?? '–'}</td>
                    <td className="px-4 py-2">
                      {item.nkVisiert && <span className="text-green-600">✓</span>}
                      {item.nkChange && <span className="text-yellow-600 ml-1">✎</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{data?.total ?? 0} Einträge gesamt</span>
            <Pagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
