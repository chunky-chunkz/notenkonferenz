import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { itemsApi } from '../lib/api';
import toast from 'react-hot-toast';

const NOTE_RANGES = [
  { label: '< 4.0', noteMin: 0,   noteMax: 3.9,  color: 'bg-red-600 hover:bg-red-700' },
  { label: '4.0 – 4.3', noteMin: 4.0, noteMax: 4.3, color: 'bg-orange-500 hover:bg-orange-600' },
  { label: '4.4 – 5.6', noteMin: 4.4, noteMax: 5.6, color: 'bg-yellow-500 hover:bg-yellow-600' },
  { label: '> 5.6', noteMin: 5.7, noteMax: 6.0, color: 'bg-green-600 hover:bg-green-700' },
];

export function IndexPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const collectTyp = searchParams.get('typ');

  const { data, isLoading } = useQuery({
    queryKey: ['my-items'],
    queryFn: () => itemsApi.my(),
    refetchInterval: 30_000,
  });

  const collectMutation = useMutation({
    mutationFn: (typ: string) => itemsApi.collect(typ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      toast.success('IPA übernommen');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const collectRandomMutation = useMutation({
    mutationFn: (range?: { noteMin?: number; noteMax?: number }) => itemsApi.collectRandom(range),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      const k = data?.item?.kandidat;
      toast.success(`Dossier übernommen: ${k?.vorname ?? ''} ${k?.nachname ?? ''}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Auto-collect if typ param present
  if (collectTyp && !collectMutation.isPending) {
    collectMutation.mutate(collectTyp);
    // Clear params after triggering
    window.history.replaceState({}, '', '/');
  }

  if (isLoading) {
    return <div className="text-center py-12">Lade...</div>;
  }

  const items = data?.items ?? [];
  // "offen" = zugewiesen, noch nicht bestätigt, noch nicht validiert
  const openItems = items.filter((i: any) => !i.nkAbgegeben && !i.nkVisiert);
  // "bestätigt" = bestätigt durch EXP, wartet auf CEX-Validierung
  const submittedItems = items.filter((i: any) => i.nkAbgegeben && !i.nkVisiert);
  const doneItems = items.filter((i: any) => i.nkVisiert);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Meine IPA</h1>

      {openItems.length === 0 && doneItems.length === 0 && submittedItems.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8">
          <p className="text-gray-500 mb-5 text-center">Keine IPA zugewiesen.</p>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">Dossier nach Notenbereich holen:</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {NOTE_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => collectRandomMutation.mutate({ noteMin: r.noteMin, noteMax: r.noteMax })}
                disabled={collectRandomMutation.isPending}
                className={`px-4 py-3 ${r.color} text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => collectRandomMutation.mutate(undefined)}
            disabled={collectRandomMutation.isPending}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {collectRandomMutation.isPending ? 'Wird geholt…' : '🎲 Beliebiges Dossier holen'}
          </button>
        </div>
      )}

      {(openItems.length > 0 || doneItems.length > 0 || submittedItems.length > 0) && (
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Weiteres Dossier holen:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            {NOTE_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => collectRandomMutation.mutate({ noteMin: r.noteMin, noteMax: r.noteMax })}
                disabled={collectRandomMutation.isPending}
                className={`px-3 py-2 ${r.color} text-white rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => collectRandomMutation.mutate(undefined)}
            disabled={collectRandomMutation.isPending}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            {collectRandomMutation.isPending ? 'Wird geholt…' : '🎲 Beliebiges Dossier holen'}
          </button>
        </div>
      )}

      {openItems.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">🔴 Offen ({openItems.length})</h2>
          <div className="grid gap-4">
            {openItems.map((item: any) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {submittedItems.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">⏳ Bestätigt – wartet auf Validierung ({submittedItems.length})</h2>
          <div className="grid gap-4 opacity-80">
            {submittedItems.map((item: any) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function ItemCard({ item }: { item: any }) {
  const kandidat = item.kandidat;

  return (
    <Link
      to={`/details/${kandidat?.id}`}
      className="block bg-white dark:bg-gray-800 rounded-lg shadow hover:shadow-md transition-shadow p-4"
    >
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-medium">
            {kandidat?.vorname} {kandidat?.nachname}
          </h3>
          <p className="text-sm text-gray-500">{item.fachrichtung}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-primary-600">{item.notePaErrechnet ?? '–'}</span>
          {item.nkVisiert && (
            <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800">Visiert</span>
          )}
          {item.nkChange && (
            <span className="px-2 py-1 text-xs rounded bg-yellow-100 text-yellow-800">Angepasst</span>
          )}
        </div>
      </div>
    </Link>
  );
}
