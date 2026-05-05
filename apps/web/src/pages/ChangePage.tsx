import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { itemsApi } from '../lib/api';
import toast from 'react-hot-toast';

export function ChangePage() {
  const { kandidatId } = useParams<{ kandidatId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = parseInt(kandidatId!, 10);
  const [file, setFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['item', id],
    queryFn: () => itemsApi.get(id),
  });

  const changeMutation = useMutation({
    mutationFn: () => {
      const formData = new FormData();
      if (file) formData.append('pdf', file);
      return itemsApi.change(id, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-items'] });
      toast.success('Anpassung registriert');
      navigate('/');
    },
    onError: (err: any) => toast.error(err.message),
  });

  if (isLoading) return <div className="text-center py-12">Lade...</div>;
  if (!data?.item) return <div className="text-center py-12">Nicht gefunden</div>;

  const item = data.item;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">
        Anpassung: {item.kandidat?.vorname} {item.kandidat?.nachname}
      </h1>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="mb-6">
          <p className="text-sm text-gray-500">Fachrichtung</p>
          <p className="font-medium">{item.fachrichtung}</p>
        </div>
        <div className="mb-6">
          <p className="text-sm text-gray-500">Errechnete Note</p>
          <p className="text-2xl font-bold text-primary-600">{item.notePaErrechnet ?? '–'}</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            changeMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium mb-2">PDF-Datei (Anpassungsformular)</label>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm border rounded-lg p-2 dark:bg-gray-700 dark:border-gray-600"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={changeMutation.isPending}
              className="px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {changeMutation.isPending ? 'Wird gespeichert...' : 'Anpassung einreichen'}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="px-6 py-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
