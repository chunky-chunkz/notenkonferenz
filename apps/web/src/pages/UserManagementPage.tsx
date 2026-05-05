import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '../lib/api';
import toast from 'react-hot-toast';

type Role = 'USER' | 'STAFF' | 'ADMIN';

export function UserManagementPage() {
  const queryClient = useQueryClient();

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
                <th className="px-4 py-3 text-left">Registriert</th>
                <th className="px-4 py-3 text-left">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {data?.users?.map((user: any) => (
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
                      <option value="STAFF">STAFF</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
