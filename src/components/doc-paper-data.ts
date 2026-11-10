import type { CompanyHeader, VendorRef } from './doc-paper';

/** Letterhead for a document form, from the company settings */
export function companyHeaderFrom(s: { companyName: string; companyAddress: string; companyTaxId: string; logoUrl: string | null }): CompanyHeader {
  return { name: s.companyName, address: s.companyAddress, taxId: s.companyTaxId, logoUrl: s.logoUrl };
}

/** Active vendors with what a document form shows under the chosen one */
export function vendorRefsFrom(
  rows: { id: string; code: string; name: string; address: string; taxId: string | null; contactPerson: string; phone: string; email: string; active: boolean }[],
): VendorRef[] {
  return rows
    .filter((v) => v.active)
    .map((v) => ({ id: v.id, code: v.code, name: v.name, address: v.address, taxId: v.taxId, contactPerson: v.contactPerson, phone: v.phone, email: v.email }));
}
