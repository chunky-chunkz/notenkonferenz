import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, jobsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { hasPkorgSession } = useAuth();
  const [selectedRoleUrl, setSelectedRoleUrl] = useState<string | undefined>(undefined);

  // PKOrg roles (only fetch when we have a PKOrg session)
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['pkorg-roles'],
    queryFn: () => adminApi.pkorgRoles(),
    retry: false,
    enabled: hasPkorgSession,
    // Auto-select the first role when roles load
    select: (data) => {
      if (data?.roles?.length && !selectedRoleUrl) {
        setSelectedRoleUrl(data.roles[0].url);
      }
      return data;
    },
  });

  // Last ping
  const { data: pingData } = useQuery({
    queryKey: ['last-ping'],
    queryFn: () => adminApi.lastPing(),
    refetchInterval: 30000,
  });

  // Import mutations
  const importNuMutation = useMutation({
    mutationFn: (roleUrl?: string) => adminApi.importNotenuebersicht(roleUrl),
    onSuccess: (data: any) => {
      toast.success(`Import-Job gestartet: ${data.jobId}`);
      setActiveJobId(data.jobId);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const importDfMutation = useMutation({
    mutationFn: (roleUrl?: string) => adminApi.importDurchfuehrung(roleUrl),
    onSuccess: (data: any) => {
      toast.success(`Import-Job gestartet: ${data.jobId}`);
      setActiveJobId(data.jobId);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const downloadPortfoliosMutation = useMutation({
    mutationFn: () => adminApi.downloadPortfolios(),
    onSuccess: (data: any) => {
      toast.success(`Download-Job gestartet: ${data.jobId}`);
      setActiveJobId(data.jobId);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const keepaliveMutation = useMutation({
    mutationFn: () => adminApi.keepalive(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['last-ping'] });
      toast.success('Keepalive gesendet');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const emptyDbMutation = useMutation({
    mutationFn: () => adminApi.emptyDatabase(),
    onSuccess: () => toast.success('Datenbank geleert'),
    onError: (err: any) => toast.error(err.message),
  });

  // Job progress polling
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { data: jobData } = useQuery({
    queryKey: ['job', activeJobId],
    queryFn: () => jobsApi.status(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: 2000,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PKOrg Status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b dark:border-gray-700">
            <h2 className="font-semibold">PKOrg Status</h2>
          </div>
          <div className="p-6 space-y-3">
            {!hasPkorgSession && (
              <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <p className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">Nicht mit PKOrg verbunden</p>
                <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                  Melden Sie sich mit 2FA an, um PKOrg-Funktionen zu nutzen.
                </p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Letzter Ping:</span>
              <span className="text-sm font-medium">
                {pingData?.lastPing
                  ? new Date(pingData.lastPing).toLocaleString('de-CH')
                  : 'Noch nie'}
              </span>
            </div>
            <button
              onClick={() => keepaliveMutation.mutate()}
              disabled={keepaliveMutation.isPending || !hasPkorgSession}
              className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keepalive senden
            </button>

            <div className="mt-4">
              <h3 className="text-sm font-medium mb-2">Rollen</h3>
              {rolesLoading ? (
                <p className="text-sm text-gray-500">Lade...</p>
              ) : (
                <div className="space-y-1">
                  {rolesData?.roles?.map((r: any, i: number) => (
                    <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="pkorg-role"
                        value={r.url}
                        checked={selectedRoleUrl === r.url}
                        onChange={() => setSelectedRoleUrl(r.url)}
                        className="text-primary-600"
                      />
                      <span className="text-gray-700 dark:text-gray-300">{r.text}</span>
                    </label>
                  ))}
                  {(!rolesData?.roles || rolesData.roles.length === 0) && (
                    <p className="text-sm text-gray-500">Keine Rollen verfügbar (nicht eingeloggt?)</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Import Actions */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b dark:border-gray-700">
            <h2 className="font-semibold">Imports & Downloads</h2>
          </div>
          <div className="p-6 space-y-4">
            {/* Notenübersicht Import (from PKOrg) */}
            <button
              onClick={() => importNuMutation.mutate(selectedRoleUrl)}
              disabled={importNuMutation.isPending || !hasPkorgSession}
              className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importNuMutation.isPending ? 'Wird importiert...' : '📊 Notenübersicht importieren'}
            </button>

            {/* Durchführung Import (from PKOrg) */}
            <button
              onClick={() => importDfMutation.mutate(selectedRoleUrl)}
              disabled={importDfMutation.isPending || !hasPkorgSession}
              className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importDfMutation.isPending ? 'Wird importiert...' : '📋 Durchführung importieren'}
            </button>

            {/* Portfolio Download */}
            <button
              onClick={() => downloadPortfoliosMutation.mutate()}
              disabled={downloadPortfoliosMutation.isPending || !hasPkorgSession}
              className="w-full px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Portfolios herunterladen
            </button>

            {/* Empty Database */}
            <button
              onClick={() => {
                if (confirm('Wirklich die gesamte Datenbank leeren? Dieser Vorgang kann nicht rückgängig gemacht werden!')) {
                  emptyDbMutation.mutate();
                }
              }}
              disabled={emptyDbMutation.isPending}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
            >
              🗑 Datenbank leeren
            </button>
          </div>
        </div>
      </div>

      {/* Job Progress */}
      {activeJobId && jobData && (
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="font-semibold mb-3">Job: {activeJobId}</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">Status:</span>
              <span className={`text-sm font-medium ${
                jobData.status === 'completed' ? 'text-green-600' :
                jobData.status === 'failed' ? 'text-red-600' :
                'text-yellow-600'
              }`}>
                {jobData.status}
              </span>
            </div>
            {jobData.progress != null && (
              <div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-600 transition-all"
                    style={{ width: `${jobData.progress}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">{jobData.progress}%</p>
              </div>
            )}
            {jobData.logs && jobData.logs.length > 0 && (
              <div className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono max-h-48 overflow-y-auto">
                {jobData.logs.map((log: string, i: number) => (
                  <div key={i}>{log}</div>
                ))}
              </div>
            )}
            {(jobData.status === 'completed' || jobData.status === 'failed') && (
              <button
                onClick={() => setActiveJobId(null)}
                className="text-sm text-primary-600 hover:underline"
              >
                Schliessen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
