import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../lib/api';
import toast from 'react-hot-toast';

type Role = 'USER' | 'VEX' | 'STAFF' | 'ADMIN';

export function UserManagementPage() {
  const queryClient = useQueryClient();
  // track which user's fachrichtung input is being edited: userId -> draft value
  const [fachrichtungDrafts, setFachrichtungDrafts] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => adminApi.users(),
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: Role }) =>
      adminApi.updateRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Rolle geändert');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const changeFachrichtungMutation = useMutation({
    mutationFn: ({ userId, pkorgFachrichtung }: { userId: number; pkorgFachrichtung: string | null }) =>
      adminApi.updateFachrichtung(userId, pkorgFachrichtung),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // clear draft after save
      setFachrichtungDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.userId];
        return next;
      });
      toast.success('Fachrichtung gespeichert');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => adminApi.deleteUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Benutzer gelöscht');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Benutzerverwaltung</h1>

      {isLoading ? (
        <div className="text-center py-12">Lade...</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left">ID</th>
                <th className="px-4 py-3 text-left">E-Mail</th>
                <th className="px-4 py-3 text-left">Rolle</th>
                <th className="px-4 py-3 text-left">Fachrichtung</th>
                <th className="px-4 py-3 text-left">PKOrg-Typ</th>
                <th className="px-4 py-3 text-left">Registriert</th>
                <th className="px-4 py-3 text-left">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {data?.users?.map((user: any) => {
                const draft = fachrichtungDrafts[user.id];
                const currentFachrichtung = user.pkorgFachrichtung ?? '';
                const isDirty = draft !== undefined && draft !== currentFachrichtung;

                return (
                  <tr key={user.id} className="border-t dark:border-gray-700">
                    <td className="px-4 py-2">{user.id}</td>
                    <td className="px-4 py-2">{user.email}</td>
                    <td className="px-4 py-2">
                      <select
                        value={user.role}
                        onChange={(e) =>
                          changeRoleMutation.mutate({
                            userId: user.id,
                            role: e.target.value as Role,
                          })
                        }
                        className="px-2 py-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
                      >
                        <option value="USER">USER</option>
                        <option value="VEX">VEX</option>
                        <option value="STAFF">STAFF</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={draft ?? currentFachrichtung}
                          onChange={(e) =>
                            setFachrichtungDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))
                          }
                          placeholder="z.B. Api"
                          className="px-2 py-1 border rounded text-sm w-24 dark:bg-gray-700 dark:border-gray-600"
                        />
                        {isDirty && (
                          <button
                            onClick={() =>
                              changeFachrichtungMutation.mutate({
                                userId: user.id,
                                pkorgFachrichtung: draft || null,
                              })
                            }
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            ✓
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {user.pkorgRoleType ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString('de-CH')}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => {
                          if (confirm(`Benutzer ${user.email} wirklich löschen?`)) {
                            deleteUserMutation.mutate(user.id);
                          }
                        }}
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
