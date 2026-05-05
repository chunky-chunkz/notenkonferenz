import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import { Pagination } from '../components/Pagination';

export function LogsPage() {
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['logs', page],
    queryFn: () => adminApi.logs(page, 50),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Audit-Logs</h1>

      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">Zeitstempel</th>
                  <th className="px-4 py-3 text-left">Benutzer</th>
                  <th className="px-4 py-3 text-left">Aktion</th>
                  <th className="px-4 py-3 text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {data?.items?.map((log: any) => (
                  <tr key={log.id} className="border-t dark:border-gray-700">
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('de-CH')}
                    </td>
                    <td className="px-4 py-2">{log.user?.email ?? '–'}</td>
                    <td className="px-4 py-2">
                      <span className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500 max-w-md truncate">{log.details}</td>
                  </tr>
                ))}
                {(!data?.items || data.items.length === 0) && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Keine Logs vorhanden</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <Pagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              onPageChange={setPage}
            />
          </div>
        </>
      )}
    </div>
  );
}
