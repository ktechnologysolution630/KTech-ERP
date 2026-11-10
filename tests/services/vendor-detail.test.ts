import { describe, expect, test } from 'vitest';

describe('vendor profile', () => {
  test('saves the full profile; the primary bank account and contact fill the flat columns; status drives active', async () => {
    const { createTestDb: mk } = await import('../helpers/test-db');
    const { seedBasics: seed } = await import('../helpers/fixtures');
    const { updateVendor: save, getVendorDetail: read } = await import('@/server/services/vendor-detail');
    const db = await mk();
    const f = await seed(db);
    await save(db, f.users.admin, f.vendorCo, {
      name: 'บริษัท ทดสอบ จำกัด',
      type: 'COMPANY',
      taxId: '0105555555555',
      branch: '00000',
      address: '99/1',
      phone: '',
      bankName: '',
      bankAccountNo: '',
      bankAccountName: '',
      defaultCreditDays: 45,
      defaultWhtRate: 3,
      tradeName: 'ทดสอบวัสดุ',
      status: 'SUSPENDED',
      province: 'ชัยภูมิ',
      leadTimeDays: 7,
      minOrderValue: '5000',
      creditLimit: '200000',
      depositRequired: true,
      depositPercent: '30',
      category: 'DISTRIBUTOR',
      contacts: [
        { kind: 'SALES', name: 'คุณเอ', position: '', department: '', phone: '02-111', mobile: '', email: 'a@x.co', lineId: '', primary: false, receivesPo: false, receivesAccounting: false },
        { kind: 'PO', name: 'คุณบี', position: 'จัดซื้อ', department: '', phone: '', mobile: '081', email: 'b@x.co', lineId: '', primary: true, receivesPo: true, receivesAccounting: false },
      ],
      bankAccounts: [
        { bank: 'ธนาคารกรุงไทย จำกัด (มหาชน)', branch: 'ชัยภูมิ', accountName: 'บจก. ทดสอบ', accountNo: '123-4-56789-0', accountType: 'ออมทรัพย์', promptPay: '', primary: true },
      ],
    });
    const { vendor } = await read(db, f.users.admin, f.vendorCo);
    expect(vendor).toMatchObject({
      tradeName: 'ทดสอบวัสดุ',
      status: 'SUSPENDED',
      active: false,
      province: 'ชัยภูมิ',
      leadTimeDays: 7,
      minOrderValue: '5000.00',
      creditLimit: '200000.00',
      depositPercent: '30.00',
      category: 'DISTRIBUTOR',
      contactPerson: 'คุณบี',
      phone: '081',
      email: 'b@x.co',
      bankName: 'ธนาคารกรุงไทย จำกัด (มหาชน)',
      bankAccountNo: '123-4-56789-0',
      bankAccountName: 'บจก. ทดสอบ',
    });
    expect(vendor.contacts).toHaveLength(2);
  });
});
