import { useQuery } from '@tanstack/react-query';
import { itemsApi } from '../lib/api';

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => itemsApi.dashboardStats(),
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="text-center py-12">Lade Dashboard...</div>;
  if (!data) return null;

  const stats = [
    { label: 'Alle IPA', total: data.numIpaAll, open: data.numIpaAllVis, color: 'bg-gray-500' },
    { label: 'Ungenügend (≤3.9)', total: data.numIpaUng, open: data.numIpaUngVis, color: 'bg-red-500' },
    { label: 'Knapp (4.0–4.3)', total: data.numIpaKnapp, open: data.numIpaKnappVis, color: 'bg-yellow-500' },
    { label: 'Gut (4.4–5.7)', total: data.numIpaGut, open: data.numIpaGutVis, color: 'bg-green-500' },
    { label: 'Sehr gut (5.8–6.0)', total: data.numIpaSehr, open: data.numIpaSehrVis, color: 'bg-blue-500' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className={`w-3 h-3 rounded-full ${s.color} mb-2`}></div>
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className="text-2xl font-bold">{s.total}</p>
            <p className="text-sm text-gray-400">Offen: {s.open}</p>
          </div>
        ))}
      </div>

      {/* Working On */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-3">In Bearbeitung ({data.workingOn?.length ?? 0})</h2>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-2 text-left">Kandidat</th>
                <th className="px-4 py-2 text-left">Fachrichtung</th>
                <th className="px-4 py-2 text-left">PEX</th>
                <th className="px-4 py-2 text-left">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.workingOn?.map((item: any) => (
                <tr key={item.id} className="border-t dark:border-gray-700">
                  <td className="px-4 py-2">{item.kandidat?.vorname} {item.kandidat?.nachname}</td>
                  <td className="px-4 py-2">{item.fachrichtung}</td>
                  <td className="px-4 py-2">{item.pexUser?.email}</td>
                  <td className="px-4 py-2 font-medium">{item.notePaErrechnet ?? '–'}</td>
                </tr>
              ))}
              {(!data.workingOn || data.workingOn.length === 0) && (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-500">Keine</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visiert */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Visiert ({data.visiert?.length ?? 0})</h2>
        <p className="text-sm text-gray-500">
          {data.visiert?.length ?? 0} von {data.numIpaAll} IPA abgeschlossen.
        </p>
      </div>
    </div>
  );
}
