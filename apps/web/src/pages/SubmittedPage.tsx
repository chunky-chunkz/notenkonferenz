import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { itemsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

type Filter = 'alle' | 'visiert' | 'angepasst';

export function SubmittedPage() {
  const { isCex, isAdmin, isStaff } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('alle');

  const { data, isLoading } = useQuery({
    queryKey: ['submitted-items'],
    queryFn: () => itemsApi.submitted(),
    refetchInterval: 30_000,
  });

  const visierenMutation = useMutation({
    mutationFn: (kandidatId: number) => itemsApi.visieren(kandidatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submitted-items'] });
    },
  });

  const allItems: any[] = data?.items ?? [];

  const filteredItems = allItems.filter((item) => {
    if (filter === 'visiert') return item.nkVisiert && !item.nkChange;
    if (filter === 'angepasst') return item.nkChange;
    return true;
  });

  const countVisiert = allItems.filter((i) => i.nkVisiert && !i.nkChange).length;
  const countAngepasst = allItems.filter((i) => i.nkChange).length;

  const canVisieren = isCex || isAdmin || isStaff;
  const title = isCex ? 'Visierte Dossiers (Fachrichtung)' : 'Abgegebene Dossiers';

  const tabCls = (t: Filter) =>
    `px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
      filter === t
        ? 'bg-primary-600 text-white'
        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
    }`;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {isCex
          ? 'Alle visierten Dossiers Ihrer Fachrichtung.'
          : 'Dossiers, die abgegeben, visiert oder angepasst wurden.'}
      </p>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        <button className={tabCls('alle')} onClick={() => setFilter('alle')}>
          Alle ({allItems.length})
        </button>
        <button className={tabCls('visiert')} onClick={() => setFilter('visiert')}>
          ✅ Visiert ({countVisiert})
        </button>
        <button className={tabCls('angepasst')} onClick={() => setFilter('angepasst')}>
          ✎ Angepasst ({countAngepasst})
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">Keine Dossiers vorhanden.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">Kandidat</th>
                <th className="px-4 py-3 text-left">Fachrichtung</th>
                <th className="px-4 py-3 text-left">Note</th>
                <th className="px-4 py-3 text-left">Experte</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item: any) => {
                const k = item.kandidat;
                const isVisiert = item.nkVisiert;
                const isAngepasst = item.nkChange;
                const isAbgegeben = item.nkAbgegeben;
                return (
                  <tr key={item.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2">
                      <Link to={`/details/${item.kandidatId}`} className="text-primary-600 hover:underline">
                        {item.kandidatId}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-medium">{k?.vorname} {k?.nachname}</td>
                    <td className="px-4 py-2 text-gray-500">{item.fachrichtung}</td>
                    <td className="px-4 py-2 font-semibold">{item.notePaErrechnet ?? '–'}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{item.pexUser?.email ?? '–'}</td>
                    <td className="px-4 py-2">
                      {isAngepasst ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          ✎ Angepasst
                        </span>
                      ) : isVisiert ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          ✅ Visiert
                        </span>
                      ) : isAbgegeben ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          📤 Abgegeben
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          🔄 Offen
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/details/${item.kandidatId}`}
                          className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                        >
                          📄 Ansehen
                        </Link>
                        {canVisieren && !isVisiert && (
                          <button
                            onClick={() => visierenMutation.mutate(item.kandidatId)}
                            disabled={visierenMutation.isPending}
                            className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                          >
                            ✅ Visieren
                          </button>
                        )}
                        {canVisieren && (
                          <Link
                            to={`/change/${item.kandidatId}`}
                            className="px-3 py-1 text-xs rounded bg-yellow-500 hover:bg-yellow-600 text-white"
                          >
                            ✎ Anpassen
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t dark:border-gray-700 text-sm text-gray-500 flex justify-between items-center flex-wrap gap-2">
            <span>{filteredItems.length} Dossier{filteredItems.length !== 1 ? 's' : ''}</span>
            <div className="flex gap-4">
              <span className="text-green-600 dark:text-green-400 font-medium">{countVisiert} visiert</span>
              <span className="text-yellow-600 dark:text-yellow-400 font-medium">{countAngepasst} angepasst</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
