import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi, filesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export function DetailPage() {
  const { kandidatId } = useParams<{ kandidatId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = parseInt(kandidatId!, 10);
  const { isStaff, isCex, isAdmin, isExp } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['item', id],
    queryFn: () => itemsApi.get(id),
    refetchInterval: 30_000,
  });

  const dropMutation = useMutation({
    mutationFn: () => itemsApi.drop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      toast.success('Rückgabe erfolgt');
      navigate('/');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const visierenMutation = useMutation({
    mutationFn: () => itemsApi.visieren(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', id] });
      toast.success('Dossier visiert');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const canVisieren = isExp || isAdmin || isStaff;
  const canAnpassen = !isCex && (isExp || isAdmin || isStaff);

  if (isLoading) return <div className="text-center py-12">Lade...</div>;
  if (!data?.item) return <div className="text-center py-12">Nicht gefunden</div>;

  const item = data.item;
  const kandidat = item.kandidat;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold">{kandidat?.vorname} {kandidat?.nachname}</h1>
            <span className="inline-block mt-2 px-3 py-1 text-sm rounded bg-primary-600 text-white">
              {item.fachrichtung}
            </span>
          </div>
          <a
            href={filesApi.portfolioUrl(id)}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            📥 Dossier downloaden
          </a>
        </div>
      </div>

      {/* Examiners & Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6">
        <div className="px-6 py-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Prüfer & Entscheidung</h2>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left px-3 py-2">HEX</th>
                <th className="text-left px-3 py-2">NEX</th>
                <th className="text-left px-3 py-2">VF</th>
                <th className="text-left px-3 py-2">Note</th>
                <th className="text-left px-3 py-2">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2">{item.hauptexperte?.vorname} {item.hauptexperte?.nachname}</td>
                <td className="px-3 py-2">{item.nebenexperte?.vorname} {item.nebenexperte?.nachname}</td>
                <td className="px-3 py-2">{item.vf?.vorname} {item.vf?.nachname}</td>
                <td className="px-3 py-2">
                  <span className="text-lg font-bold">{item.notePaErrechnet ?? '–'}</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 flex-wrap">
                    {item.nkChange ? (
                      <span className="px-3 py-1 text-sm rounded bg-yellow-100 text-yellow-800">✎ Angepasst</span>
                    ) : item.nkVisiert ? (
                      <span className="px-3 py-1 text-sm rounded bg-green-100 text-green-800">✅ Visiert</span>
                    ) : item.nkAbgegeben ? (
                      <span className="px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">📤 Abgegeben</span>
                    ) : null}
                    {canVisieren && !item.nkVisiert && (
                      <button
                        onClick={() => visierenMutation.mutate()}
                        disabled={visierenMutation.isPending}
                        className="px-3 py-1 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        ✅ Visieren
                      </button>
                    )}
                    {canAnpassen && (
                      <Link
                        to={`/change/${id}`}
                        className="px-3 py-1 text-sm rounded bg-yellow-500 text-white hover:bg-yellow-600"
                      >
                        ✎ Anpassen
                      </Link>
                    )}
                    {isStaff && (
                      <button
                        onClick={() => dropMutation.mutate()}
                        disabled={dropMutation.isPending}
                        className="px-3 py-1 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                      >
                        ↩ Rückgabe
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Scores */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="px-6 py-4 border-b dark:border-gray-700">
          <h2 className="font-semibold">Detaillierte Ergebnisse</h2>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm mb-6">
            <thead>
              <tr>
                <th className="text-left px-3 py-2"></th>
                <th className="text-center px-3 py-2 border-r" colSpan={2}>PEX Resultate</th>
                <th className="text-center px-3 py-2" colSpan={2}>VF Resultate</th>
              </tr>
              <tr>
                <th className="text-left px-3 py-2">Sektion</th>
                <th className="text-left px-3 py-2">Punkte</th>
                <th className="text-left px-3 py-2 border-r">Note</th>
                <th className="text-left px-3 py-2">Punkte</th>
                <th className="text-left px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t dark:border-gray-700">
                <th className="px-3 py-2 text-left">Teil 1</th>
                <td className="px-3 py-2">{item.punkteTeil1 ?? '–'}</td>
                <td className="px-3 py-2 border-r">{item.noteTeil1 ?? '–'}</td>
                <td className="px-3 py-2">{item.punkteTeil1Vf ?? '–'}</td>
                <td className="px-3 py-2">{item.noteTeil1Vf ?? '–'}</td>
              </tr>
              <tr className="border-t dark:border-gray-700">
                <th className="px-3 py-2 text-left">Teil 2</th>
                <td className="px-3 py-2">{item.punkteTeil2 ?? '–'}</td>
                <td className="px-3 py-2 border-r">{item.noteTeil2 ?? '–'}</td>
                <td className="px-3 py-2">{item.punkteTeil2Vf ?? '–'}</td>
                <td className="px-3 py-2">{item.noteTeil2Vf ?? '–'}</td>
              </tr>
              <tr className="border-t dark:border-gray-700">
                <th className="px-3 py-2 text-left">Teil 3</th>
                <td className="px-3 py-2">{item.punkteTeil3 ?? '–'}</td>
                <td className="px-3 py-2 border-r">{item.noteTeil3 ?? '–'}</td>
                <td className="px-3 py-2 text-gray-400">–</td>
                <td className="px-3 py-2 text-gray-400">–</td>
              </tr>
            </tbody>
          </table>

          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 text-center">
            <p className="text-sm text-gray-500">Errechnete Note</p>
            <p className="text-3xl font-bold text-primary-600">{item.notePaErrechnet ?? '–'}</p>
          </div>
        </div>
      </div>

      {/* Anpassungen */}
      {item.anpassungen?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mt-6">
          <div className="px-6 py-4 border-b dark:border-gray-700">
            <h2 className="font-semibold">Anpassungen</h2>
          </div>
          <div className="p-6">
            {item.anpassungen.map((a: any) => (
              <div key={a.id} className="flex items-center gap-3 py-2">
                <a
                  href={filesApi.anpassungUrl(a.id)}
                  className="text-primary-600 hover:underline text-sm"
                >
                  📄 PDF #{a.id}
                </a>
                <span className="text-xs text-gray-500">{new Date(a.createdAt).toLocaleString('de-CH')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template Download */}
      <div className="mt-6">
        <a
          href={filesApi.templateUrl(id)}
          className="text-sm text-primary-600 hover:underline"
        >
          📝 Korrekturvorlage herunterladen
        </a>
      </div>
    </div>
  );
}
