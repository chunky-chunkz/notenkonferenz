import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { filesApi } from '../lib/api';
import toast from 'react-hot-toast';

export function MissingPortfoliosPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['missing-portfolios'],
    queryFn: () => filesApi.missingPortfolios(),
  });

  const [file, setFile] = useState<File | null>(null);

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Keine Datei ausgewählt');
      const fd = new FormData();
      fd.append('file', file);
      return filesApi.uploadMissingPortfolios(fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['missing-portfolios'] });
      toast.success('Portfolio hochgeladen');
      setFile(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Fehlende Portfolios</h1>

      {/* Upload */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <h2 className="font-semibold mb-3">Portfolio-ZIP hochladen</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <input
              type="file"
              accept=".zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border rounded p-2 dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <button
            onClick={() => uploadMutation.mutate()}
            disabled={!file || uploadMutation.isPending}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {uploadMutation.isPending ? 'Wird hochgeladen...' : 'Hochladen'}
          </button>
        </div>
      </div>

      {/* Missing List */}
      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left">Kandidat ID</th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Fachrichtung</th>
              </tr>
            </thead>
            <tbody>
              {data?.missing?.map((item: any) => (
                <tr key={item.kandidatId} className="border-t dark:border-gray-700">
                  <td className="px-4 py-2">{item.kandidatId}</td>
                  <td className="px-4 py-2">{item.vorname} {item.nachname}</td>
                  <td className="px-4 py-2">{item.fachrichtung}</td>
                </tr>
              ))}
              {(!data?.missing || data.missing.length === 0) && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    Alle Portfolios vorhanden ✓
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {(data?.missing?.length ?? 0) > 0 && (
            <div className="px-4 py-3 border-t dark:border-gray-700 text-sm text-gray-500">
              {data?.missingCount} fehlende Portfolios von {data?.total} Kandidaten
            </div>
          )}
        </div>
      )}
    </div>
  );
}
