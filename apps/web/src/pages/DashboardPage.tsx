import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { itemsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

type Filter = 'alle' | 'visiert' | 'angepasst';

export function DashboardPage() {
  const { isCex, isAdmin, isStaff, isExp } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('alle');

  const showStats = isCex || isAdmin || isStaff;
  const showWorkingOn = isAdmin || isStaff;
  const canVisieren = isExp || isCex || isAdmin || isStaff;
  const canAnpassen = isAdmin || isStaff;

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => itemsApi.dashboardStats(),
    refetchInterval: 30_000,
    enabled: showStats,
  });

  const { data: submittedData, isLoading: submittedLoading } = useQuery({
    queryKey: ['submitted-items'],
    queryFn: () => itemsApi.submitted(),
    refetchInterval: 30_000,
  });

  const visierenMutation = useMutation({
    mutationFn: (kandidatId: number) => itemsApi.visieren(kandidatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submitted-items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('Dossier visiert');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const allItems: any[] = submittedData?.items ?? [];
  const filteredItems = allItems.filter((item) => {
    if (filter === 'visiert') return item.nkVisiert && !item.nkChange;
    if (filter === 'angepasst') return item.nkChange;
    return true;
  });
  const countVisiert = allItems.filter((i) => i.nkVisiert && !i.nkChange).length;
  const countAngepasst = allItems.filter((i) => i.nkChange).length;

  const tabCls = (t: Filter) =>
    `px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
      filter === t
        ? 'bg-primary-600 text-white'
        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
    }`;

  const title = isCex ? 'Visierte Dossiers (Fachrichtung)' : 'Dashboard';
  const subtitle = isCex
    ? 'Alle visierten Dossiers Ihrer Fachrichtung.'
    : 'Dossiers, die abgegeben, visiert oder angepasst wurden.';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{subtitle}</p>

      {/* Stats Cards — CEX / Staff / Admin only */}
      {showStats && !statsLoading && statsData && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            {[
              { label: 'Alle IPA',          total: statsData.numIpaAll,   open: statsData.numIpaAllVis,   color: 'bg-gray-500' },
              { label: 'Ungenügend (≤3.9)', total: statsData.numIpaUng,   open: statsData.numIpaUngVis,   color: 'bg-red-500' },
              { label: 'Knapp (4.0–4.3)',   total: statsData.numIpaKnapp, open: statsData.numIpaKnappVis, color: 'bg-yellow-500' },
              { label: 'Gut (4.4–5.7)',     total: statsData.numIpaGut,   open: statsData.numIpaGutVis,   color: 'bg-green-500' },
              { label: 'Sehr gut (5.8–6.0)',total: statsData.numIpaSehr,  open: statsData.numIpaSehrVis,  color: 'bg-blue-500' },
            ].map((s) => (
              <div key={s.label} className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
                <div className={`w-3 h-3 rounded-full ${s.color} mb-2`} />
                <p className="text-sm text-gray-500">{s.label}</p>
                <p className="text-2xl font-bold">{s.total}</p>
                <p className="text-sm text-gray-400">Offen: {s.open}</p>
              </div>
            ))}
          </div>

          {/* In Bearbeitung — Staff / Admin only */}
          {showWorkingOn && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-3">
                In Bearbeitung ({statsData.workingOn?.length ?? 0})
              </h2>
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
                    {statsData.workingOn?.map((item: any) => (
                      <tr key={item.id} className="border-t dark:border-gray-700">
                        <td className="px-4 py-2">{item.kandidat?.vorname} {item.kandidat?.nachname}</td>
                        <td className="px-4 py-2">{item.fachrichtung}</td>
                        <td className="px-4 py-2">{item.pexUser?.email}</td>
                        <td className="px-4 py-2 font-medium">{item.notePaErrechnet ?? '–'}</td>
                      </tr>
                    ))}
                    {(!statsData.workingOn || statsData.workingOn.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-4 py-4 text-center text-gray-500">Keine</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Submitted / Visiert Dossiers */}
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

      {submittedLoading ? (
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
                        {canAnpassen && (
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
