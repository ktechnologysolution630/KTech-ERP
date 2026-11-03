import { getDb } from '@/db/client';
import { requireUser } from '@/server/auth/current-user';
import { can } from '@/server/policy';
import { listProjects, listUsersWithRoles, MIN_PASSWORD_LENGTH } from '@/server/services/master';
import { UsersClient } from './users-client';

export default async function UsersMasterPage() {
  const actor = await requireUser();
  if (!can(actor, 'users.manage')) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        หน้านี้สำหรับผู้ดูแลระบบหรือเจ้าของเท่านั้น
      </div>
    );
  }
  const db = await getDb();
  const [userList, projectList] = await Promise.all([listUsersWithRoles(db, actor), listProjects(db, actor)]);
  return (
    <UsersClient
      users={userList}
      projects={projectList.map((p) => ({ id: p.id, label: `${p.code} - ${p.name}` }))}
      me={actor.id}
      minPasswordLength={MIN_PASSWORD_LENGTH}
    />
  );
}
