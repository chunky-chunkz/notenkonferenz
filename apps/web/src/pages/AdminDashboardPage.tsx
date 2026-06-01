import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, jobsApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const {
    hasPkorgSession,
    activePkorgRole,
    pkorgRoles,
    activePkorgFachrichtung,
    refreshMe,
  } = useAuth();

  // Fetch PKOrg roles (saves them to session + auto-selects first)
  const { isLoading: rolesLoading } = useQuery({
    queryKey: ['pkorg-roles'],
    queryFn: async () => {
      const data = await adminApi.pkorgRoles();
      await refreshMe(); // sync activePkorgRole into context
      return data;
    },
    retry: false,
    enabled: hasPkorgSession,
  });

  // Last ping
  const { data: pingData } = useQuery({
    queryKey: ['last-ping'],
    queryFn: () => adminApi.lastPing(),
    refetchInterval: 30000,
  });

  // Switch PKOrg role
  const switchPkorgRoleMutation = useMutation({
    mutationFn: (roleUrl: string) => adminApi.switchPkorgRole(roleUrl),
    onSuccess: async () => {
      await refreshMe();
      // Invalidate all item-related queries so candidates reload for the new account/fachrichtung
      await queryClient.invalidateQueries({ queryKey: ['items'] });
      await queryClient.invalidateQueries({ queryKey: ['items-overview'] });
      await queryClient.invalidateQueries({ queryKey: ['items-my'] });
      await queryClient.invalidateQueries({ queryKey: ['my-items'] });
      await queryClient.invalidateQueries({ queryKey: ['missing-grades'] });
      await queryClient.invalidateQueries({ queryKey: ['missing-portfolios'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast.success('PKOrg-Rolle gewechselt & Datenbank geleert – starte Imports automatisch…');
      // Auto-start imports after role switch
      prevJobStatus.current = null;
      setAutoImportStep('nu');
      importNuMutation.mutate();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Import mutations (no roleUrl needed — session.activePkorgRole is used server-side)
  const importNuMutation = useMutation({
    mutationFn: () => adminApi.importNotenuebersicht(),
    onSuccess: (data: any) => { toast.success(`Import-Job gestartet: ${data.jobId}`); setActiveJobId(data.jobId); },
    onError: (err: any) => toast.error(err.message),
  });

  const importDfMutation = useMutation({
    mutationFn: () => adminApi.importDurchfuehrung(),
    onSuccess: (data: any) => { toast.success(`Import-Job gestartet: ${data.jobId}`); setActiveJobId(data.jobId); },
    onError: (err: any) => toast.error(err.message),
  });

  const downloadPortfoliosMutation = useMutation({
    mutationFn: () => adminApi.downloadPortfolios(),
    onSuccess: (data: any) => { toast.success(`Download-Job gestartet: ${data.jobId}`); setActiveJobId(data.jobId); },
    onError: (err: any) => toast.error(err.message),
  });

  const keepaliveMutation = useMutation({
    mutationFn: () => adminApi.keepalive(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['last-ping'] }); toast.success('Keepalive gesendet'); },
    onError: (err: any) => toast.error(err.message),
  });

  // Konferenz-Status
  const { data: konferenzData, refetch: refetchKonferenz } = useQuery({
    queryKey: ['konferenz-status'],
    queryFn: () => adminApi.getKonferenzStatus(),
  });
  const konferenzStatus = konferenzData?.status ?? 'vorbereitung';

  const setKonferenzMutation = useMutation({
    mutationFn: (status: 'vorbereitung' | 'durchfuehrung') => adminApi.setKonferenzStatus(status),
    onSuccess: () => { refetchKonferenz(); toast.success('Konferenz-Status geändert'); },
    onError: (err: any) => toast.error(err.message),
  });
  void setKonferenzMutation;

  const emptyDbMutation = useMutation({
    mutationFn: () => adminApi.emptyDatabase(),
    onSuccess: () => toast.success('Datenbank geleert'),
    onError: (err: any) => toast.error(err.message),
  });

  const drainQueueMutation = useMutation({
    mutationFn: () => adminApi.drainQueue(),
    onSuccess: (data: any) =>
      toast.success(`Warteschlange geleert: ${data.removed.failed} fehlgeschlagen, ${data.removed.waiting} wartend entfernt`),
    onError: (err: any) => toast.error(err.message),
  });

  // Job management mutations
  const cancelJobMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.cancel(jobId),
    onSuccess: (_data, jobId) => {
      toast.success(`Job ${jobId} abgebrochen`);
      queryClient.invalidateQueries({ queryKey: ['jobs-list'] });
      if (jobId === activeJobId) setActiveJobId(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeJobMutation = useMutation({
    mutationFn: (jobId: string) => jobsApi.remove(jobId),
    onSuccess: (_data, jobId) => {
      toast.success(`Job ${jobId} gelöscht`);
      queryClient.invalidateQueries({ queryKey: ['jobs-list'] });
      if (jobId === activeJobId) setActiveJobId(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // All jobs list (polls every 5s)
  const { data: allJobsData, refetch: refetchJobs } = useQuery({
    queryKey: ['jobs-list'],
    queryFn: () => jobsApi.list(),
    refetchInterval: 5000,
  });

  // Job progress polling
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const { data: jobData } = useQuery({
    queryKey: ['job', activeJobId],
    queryFn: () => jobsApi.status(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: 2000,
  });

  // ── Auto-Import: NU → DF sequentiell ────────────────────────────────────────
  // autoImportStep: null = idle, 'nu' = warte auf NU-Job, 'df' = warte auf DF-Job, 'done' = fertig
  const [autoImportStep, setAutoImportStep] = useState<null | 'nu' | 'df' | 'done'>(null);
  const prevJobStatus = useRef<string | null>(null);

  useEffect(() => {
    if (!autoImportStep || !jobData) return;
    const status = jobData.status;
    if (status === prevJobStatus.current) return;
    prevJobStatus.current = status;

    if (status === 'completed') {
      if (autoImportStep === 'nu') {
        toast.success('Notenübersicht importiert – starte Durchführung…');
        setAutoImportStep('df');
        importDfMutation.mutate();
      } else if (autoImportStep === 'df') {
        toast.success('✅ Alle Imports abgeschlossen!');
        setAutoImportStep('done');
      }
    } else if (status === 'failed') {
      toast.error(`Import fehlgeschlagen (Schritt: ${autoImportStep})`);
      setAutoImportStep(null);
    }
  }, [jobData?.status, autoImportStep]);

  const startAutoImport = () => {
    prevJobStatus.current = null;
    setAutoImportStep('nu');
    importNuMutation.mutate();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Rollen (PKOrg + App) ─────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b dark:border-gray-700">
            <h2 className="font-semibold">Rollen</h2>
          </div>
          <div className="p-6 space-y-6">

            {/* PKOrg status bar */}
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">PKOrg-Status:</span>
              {hasPkorgSession ? (
                <span className="text-green-600 font-medium">✓ Verbunden</span>
              ) : (
                <span className="text-yellow-600 font-medium">✗ Nicht verbunden</span>
              )}
            </div>

            {hasPkorgSession && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Letzter Ping:</span>
                <span className="font-medium">
                  {pingData?.lastPing ? new Date(pingData.lastPing).toLocaleString('de-CH') : 'Noch nie'}
                </span>
              </div>
            )}

            {/* PKOrg Rolle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">PKOrg-Rolle</h3>
                {activePkorgFachrichtung && (
                  <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                    Fachrichtung: {activePkorgFachrichtung}
                  </span>
                )}
              </div>

              {!hasPkorgSession ? (
                <p className="text-sm text-gray-400">PKOrg-Login erforderlich</p>
              ) : rolesLoading ? (
                <p className="text-sm text-gray-400">Lade Rollen…</p>
              ) : pkorgRoles.length === 0 ? (
                <p className="text-sm text-gray-400">Keine Rollen verfügbar</p>
              ) : (
                <div className="space-y-1">
                  {pkorgRoles.map((r, i) => {
                    const isActive = activePkorgRole?.url === r.url;
                    const isSwitching = switchPkorgRoleMutation.isPending &&
                      switchPkorgRoleMutation.variables === r.url;
                    return (
                      <label
                        key={i}
                        className={`flex items-center gap-2 text-sm cursor-pointer px-3 py-2 rounded-lg transition-colors ${
                          isActive
                            ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 font-medium'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="pkorg-role"
                          value={r.url}
                          checked={isActive}
                          disabled={switchPkorgRoleMutation.isPending}
                          onChange={() => switchPkorgRoleMutation.mutate(r.url)}
                          className="accent-primary-600"
                        />
                        <span className="flex-1">{r.text}</span>
                        {isSwitching && <span className="text-xs text-gray-400">Wechsle…</span>}
                        {isActive && !isSwitching && <span className="text-xs">✓</span>}
                      </label>
                    );
                  })}
                </div>
              )}

              {hasPkorgSession && (
                <button
                  onClick={() => keepaliveMutation.mutate()}
                  disabled={keepaliveMutation.isPending}
                  className="mt-3 w-full px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-sm rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {keepaliveMutation.isPending ? 'Sende…' : 'Keepalive senden'}
                </button>
              )}
            </div>

          </div>
        </div>

        {/* ── Imports & Downloads ──────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
          <div className="px-6 py-4 border-b dark:border-gray-700">
            <h2 className="font-semibold">Imports & Downloads</h2>
          </div>
          <div className="p-6 space-y-4">

            {activePkorgRole && (
              <div className="text-xs text-gray-500 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg">
                Aktive PKOrg-Rolle: <span className="font-medium text-gray-700 dark:text-gray-300">{activePkorgRole.text}</span>
              </div>
            )}

            {/* Auto-Import Button (nur Vorbereitung) */}
            {konferenzStatus === 'vorbereitung' && (
              <button
                onClick={startAutoImport}
                disabled={!!autoImportStep && autoImportStep !== 'done' || importNuMutation.isPending || importDfMutation.isPending || !hasPkorgSession || !activePkorgRole}
                className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {autoImportStep === 'nu' ? (
                  <><span className="animate-spin">⏳</span> Notenübersicht wird importiert…</>
                ) : autoImportStep === 'df' ? (
                  <><span className="animate-spin">⏳</span> Durchführung wird importiert…</>
                ) : (
                  <>⚡ Alle Imports starten (NU → DF)</>
                )}
              </button>
            )}

            {konferenzStatus === 'vorbereitung' && <hr className="border-gray-200 dark:border-gray-700" />}

            {konferenzStatus === 'vorbereitung' && (
              <button
                onClick={() => importNuMutation.mutate()}
                disabled={importNuMutation.isPending || !hasPkorgSession || !activePkorgRole}
                className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importNuMutation.isPending ? 'Wird importiert…' : '📊 Notenübersicht importieren'}
              </button>
            )}

            {konferenzStatus === 'vorbereitung' && (
              <button
                onClick={() => importDfMutation.mutate()}
                disabled={importDfMutation.isPending || !hasPkorgSession || !activePkorgRole}
                className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importDfMutation.isPending ? 'Wird importiert…' : '📋 Durchführung importieren'}
              </button>
            )}

            <button
              onClick={() => downloadPortfoliosMutation.mutate()}
              disabled={downloadPortfoliosMutation.isPending || !hasPkorgSession || !activePkorgRole}
              className="w-full px-4 py-2 bg-accent-600 hover:bg-accent-700 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloadPortfoliosMutation.isPending ? 'Wird heruntergeladen…' : '📁 Portfolios herunterladen'}
            </button>

            <hr className="border-gray-200 dark:border-gray-700" />

            <button
              onClick={() => drainQueueMutation.mutate()}
              disabled={drainQueueMutation.isPending}
              className="w-full px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {drainQueueMutation.isPending ? 'Wird geleert…' : '🧹 Warteschlange leeren (fehlgeschlagene Jobs)'}
            </button>

            {konferenzStatus === 'vorbereitung' ? (
              <button
                onClick={() => {
                  if (confirm('Wirklich die gesamte Datenbank leeren? Dieser Vorgang kann nicht rückgängig gemacht werden!')) {
                    emptyDbMutation.mutate();
                  }
                }}
                disabled={emptyDbMutation.isPending}
                className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
              >
                {emptyDbMutation.isPending ? 'Wird geleert…' : '🗑 Datenbank leeren'}
              </button>
            ) : (
              <div className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-400 rounded-lg text-sm text-center cursor-not-allowed">
                🔒 Datenbank leeren gesperrt (Durchführung aktiv)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Job Progress */}
      {activeJobId && jobData && (
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Aktiver Job: <span className="font-mono text-sm">{activeJobId}</span></h2>
            <div className="flex gap-2">
              {(jobData.status === 'active' || jobData.status === 'waiting' || jobData.status === 'delayed') && (
                <button
                  onClick={() => { if (confirm('Job wirklich abbrechen?')) cancelJobMutation.mutate(activeJobId); }}
                  disabled={cancelJobMutation.isPending}
                  className="px-3 py-1 text-sm bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg disabled:opacity-50"
                >
                  {cancelJobMutation.isPending ? '…' : '⏹ Stoppen'}
                </button>
              )}
              <button
                onClick={() => { if (confirm('Job aus Historie löschen?')) removeJobMutation.mutate(activeJobId); }}
                disabled={removeJobMutation.isPending}
                className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                {removeJobMutation.isPending ? '…' : '🗑 Löschen'}
              </button>
              <button
                onClick={() => setActiveJobId(null)}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                ✕ Schliessen
              </button>
            </div>
          </div>
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
            {jobData.error && (
              <p className="text-xs text-red-500 mt-1">Fehler: {jobData.error}</p>
            )}
          </div>
        </div>
      )}

      {/* Job-Übersicht */}
      <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold">Job-Übersicht</h2>
          <button
            onClick={() => refetchJobs()}
            className="text-xs text-primary-600 hover:underline"
          >
            ↻ Aktualisieren
          </button>
        </div>
        <div className="overflow-x-auto">
          {!allJobsData?.jobs?.length ? (
            <p className="px-6 py-4 text-sm text-gray-400">Keine Jobs vorhanden</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">ID</th>
                  <th className="px-4 py-2 text-left">Typ</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Fortschritt</th>
                  <th className="px-4 py-2 text-left">Erstellt</th>
                  <th className="px-4 py-2 text-left">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {allJobsData.jobs.map((job) => (
                  <tr key={job.jobId} className={`border-t dark:border-gray-700 ${activeJobId === job.jobId ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                    <td className="px-4 py-2 font-mono text-xs">{job.jobId}</td>
                    <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{job.type}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        job.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                        job.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                        job.status === 'active' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                        'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                      }`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-600" style={{ width: `${job.progress}%` }} />
                        </div>
                        <span className="text-xs text-gray-500">{job.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {job.createdAt ? new Date(job.createdAt).toLocaleString('de-CH') : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => setActiveJobId(job.jobId ?? null)}
                          className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                        >
                          Details
                        </button>
                        {(job.status === 'active' || job.status === 'waiting' || job.status === 'delayed') && (
                          <button
                            onClick={() => { if (confirm('Job abbrechen?')) cancelJobMutation.mutate(job.jobId!); }}
                            disabled={cancelJobMutation.isPending}
                            className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded disabled:opacity-50"
                          >
                            ⏹
                          </button>
                        )}
                        <button
                          onClick={() => { if (confirm('Job löschen?')) removeJobMutation.mutate(job.jobId!); }}
                          disabled={removeJobMutation.isPending}
                          className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

