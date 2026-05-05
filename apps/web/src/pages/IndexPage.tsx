import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { itemsApi } from '../lib/api';
import toast from 'react-hot-toast';

export function IndexPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const collectTyp = searchParams.get('typ');

  const { data, isLoading } = useQuery({
    queryKey: ['my-items'],
    queryFn: () => itemsApi.my(),
  });

  const collectMutation = useMutation({
    mutationFn: (typ: string) => itemsApi.collect(typ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      toast.success('IPA übernommen');
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
  const openItems = items.filter((i: any) => !i.nkVisiert);
  const doneItems = items.filter((i: any) => i.nkVisiert);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Meine IPA</h1>

      {openItems.length === 0 && doneItems.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">Keine IPA zugewiesen.</p>
          <p className="text-sm text-gray-400">
            Verwenden Sie die Kategorien in der Navigation, um eine IPA zu übernehmen.
          </p>
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

      {doneItems.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">✅ Erledigt ({doneItems.length})</h2>
          <div className="grid gap-4 opacity-70">
            {doneItems.map((item: any) => (
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
