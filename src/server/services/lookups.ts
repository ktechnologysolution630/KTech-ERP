import { asc, eq } from 'drizzle-orm';
import { type Db } from '@/db/client';
import { customers, pos, projects, users, vendors } from '@/db/schema';

export async function listProjectOptions(db: Db) {
  return db.select({ id: projects.id, name: projects.name }).from(projects);
}

export async function listUserNameOptions(db: Db) {
  return db.select({ id: users.id, name: users.name }).from(users);
}

export async function listUserContactOptions(db: Db) {
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users);
}

export async function listVendorOptions(db: Db) {
  return db.select({ id: vendors.id, name: vendors.name }).from(vendors);
}

/** Active customers for pickers (project billing customer); names are not finance-restricted. */
export async function listCustomerOptions(db: Db) {
  return db
    .select({ id: customers.id, code: customers.code, name: customers.name })
    .from(customers)
    .where(eq(customers.active, true))
    .orderBy(asc(customers.code));
}

export async function listPoOptions(db: Db) {
  return db
    .select({
      id: pos.id,
      number: pos.number,
      projectId: pos.projectId,
      vendorId: pos.vendorId,
      gross: pos.gross,
    })
    .from(pos);
}
