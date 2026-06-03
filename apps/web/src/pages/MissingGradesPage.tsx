import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi, ItemsFilter } from '../lib/api';
import { Pagination } from '../components/Pagination';
import toast from 'react-hot-toast';

export function MissingGradesPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ItemsFilter>({ page: 1, pageSize: 25 });

  const { data, isLoading } = useQuery({
    queryKey: ['missing-grades', filters],
    queryFn: () => itemsApi.missingGrades(filters),
    refetchInterval: 30_000,
  });

  const gradeMutation = useMutation({
    mutationFn: ({ kandidatId, note }: { kandidatId: number; note: number }) =>
      itemsApi.saveGrade(kandidatId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['missing-grades'] });
      toast.success('Note gespeichert');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState('');

  const handleSave = (kandidatId: number) => {
    const note = parseFloat(noteInput);
    if (isNaN(note) || note < 0 || note > 6) {
      toast.error('Note muss zwischen 0 und 6 liegen');
      return;
    }
    gradeMutation.mutate({ kandidatId, note });
    setEditingId(null);
    setNoteInput('');
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Fehlende Noten</h1>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input
            placeholder="ID"
            value={filters.kandidatId ?? ''}
            onChange={(e) => setFilters((p) => ({ ...p, kandidatId: e.target.value, page: 1 }))}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
          <input
            placeholder="Name"
            value={filters.name ?? ''}
            onChange={(e) => setFilters((p) => ({ ...p, name: e.target.value, page: 1 }))}
            className="px-3 py-2 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
          />
        </div>
      </div>

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
                  <th className="px-4 py-3 text-left">Note eingeben</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((item: any) => (
                  <tr key={item.id} className="border-t dark:border-gray-700">
                    <td className="px-4 py-2">{item.kandidatId}</td>
                    <td className="px-4 py-2">{item.kandidat?.vorname} {item.kandidat?.nachname}</td>
                    <td className="px-4 py-2">{item.fachrichtung}</td>
                    <td className="px-4 py-2">{item.hauptexperte?.vorname} {item.hauptexperte?.nachname}</td>
                    <td className="px-4 py-2">
                      {editingId === item.kandidatId ? (
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="6"
                            value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-sm dark:bg-gray-700"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSave(item.kandidatId)}
                            className="px-2 py-1 text-xs bg-green-600 text-white rounded"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-1 text-xs border rounded"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingId(item.kandidatId);
                            setNoteInput('');
                          }}
                          className="px-3 py-1 text-xs border rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          Note eingeben
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>{data?.total ?? 0} Einträge ohne Note</span>
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
