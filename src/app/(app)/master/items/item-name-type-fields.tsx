'use client';

import { useEffect, useRef, useState } from 'react';
import { detectItemType, type RegisterItem } from '@/domain/item-classify';
import { STOCK_CATEGORIES } from '@/domain/stock';

const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm';

/**
 * Name and category of a new item. The category fills itself from the name as it is typed
 * (an item already in the register, else words such as สังกะสี → งานสถาปัตยกรรม) until it is
 * chosen by hand.
 */
export function ItemNameTypeFields({ register }: { register: RegisterItem[] }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  // The form clears itself after saving; start the next item fresh
  useEffect(() => {
    const form = nameRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setName('');
      setCategory('');
      setPicked(false);
    };
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, []);
  const found = detectItemType(name, register);
  const auto = !picked && found !== null;
  const shown = picked ? category : (found?.category ?? '');

  return (
    <>
      <div className="sm:col-span-2">
        <label className="block text-xs font-medium text-slate-700 mb-1">ชื่อสินค้า/วัสดุ *</label>
        <input ref={nameRef} name="name" required value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">หมวด</label>
        <select
          name="category"
          value={shown}
          onChange={(e) => {
            setCategory(e.target.value);
            setPicked(true);
          }}
          className={field}
        >
          <option value="">— ไม่ระบุ —</option>
          {STOCK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {auto && (
          <p className="mt-1 text-[11px] text-emerald-700" aria-live="polite">
            ระบบตรวจพบ: {found.category}
            {found.group ? ` › ${found.group}` : ''}
          </p>
        )}
      </div>
    </>
  );
}
