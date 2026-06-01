import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { itemsApi } from '../lib/api';

export function SubmittedPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['submitted-items'],
    queryFn: () => itemsApi.submitted(),
  });

  const items = data?.items ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Abgegebene Dossiers</h1>

      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <p className="text-gray-500">Keine abgegebenen Dossiers vorhanden.</p>
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
                <th className="px-4 py-3 text-left">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => {
                const k = item.kandidat;
                return (
                  <tr key={item.id} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-2">
                      <Link to={`/details/${item.kandidatId}`} className="text-primary-600 hover:underline">
                        {item.kandidatId}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-medium">{k?.vorname} {k?.nachname}</td>
                    <td className="px-4 py-2">{item.fachrichtung}</td>
                    <td className="px-4 py-2 font-semibold">{item.notePaErrechnet ?? '–'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{item.pexUser?.email ?? '–'}</td>
                    <td className="px-4 py-2">
                      <Link
                        to={`/details/${item.kandidatId}`}
                        className="px-3 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        📄 Ansehen
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t dark:border-gray-700 text-sm text-gray-500">
            {items.length} Dossier{items.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
