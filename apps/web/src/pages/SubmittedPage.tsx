import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { itemsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function SubmittedPage() {
  const { isCex, isAdmin, isStaff } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['submitted-items'],
    queryFn: () => itemsApi.submitted(),
  });

  const visierenMutation = useMutation({
    mutationFn: (kandidatId: number) => itemsApi.visieren(kandidatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submitted-items'] });
    },
  });

  const items = data?.items ?? [];
  const canVisieren = isCex || isAdmin || isStaff;
  const title = isCex ? 'Visierte Dossiers (Fachrichtung)' : 'Abgegebene Dossiers';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {isCex
          ? 'Alle visierten Dossiers Ihrer Fachrichtung. Als CEX können Sie hier Dossiers erneut visieren, falls nötig.'
          : 'Dossiers, die Sie abgegeben oder visiert haben.'}
      </p>

      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : items.length === 0 ? (
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
              {items.map((item: any) => {
                const k = item.kandidat;
                const isVisiert = item.nkVisiert;
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
                      {isVisiert ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                          ✅ Visiert
                        </span>
                      ) : isAbgegeben ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                          📤 Abgegeben
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                          🔄 Offen
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 flex items-center gap-2">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t dark:border-gray-700 text-sm text-gray-500 flex justify-between items-center">
            <span>{items.length} Dossier{items.length !== 1 ? 's' : ''}</span>
            {isCex && (
              <span className="text-green-600 dark:text-green-400 font-medium">
                {items.filter((i: any) => i.nkVisiert).length} visiert
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
