export const money = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});
export const monthLabel = new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'});
export const currentMonth = () => {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
};
export function shiftMonth(month, offset) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);
}
export function cents(input) {
  const clean = String(input).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(clean)) {
    throw new Error('Use um valor em reais, como 120,50.');
  }
  const value = Math.round(Number(clean.replaceAll('.','').replace(',','.'))*100);
  if (!Number.isSafeInteger(value) || Math.abs(value)>1e12) throw new Error('Valor fora do intervalo.');
  return value;
}
export const inputMoney = amount => (amount/100).toFixed(2).replace('.',',');
export const kinds = {subscription:'Assinaturas',purchase:'Compras à vista',installment:'Parcelamentos',review:'Para revisar'};
export const sum = items => items.reduce((total, item) => total + item.amount, 0);
export const cardKey = id => 'card:'+id;
export const newId = () => crypto.randomUUID();
export const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function revisions(operations) {
  const byKey = new Map();
  const superseded = new Set(operations.flatMap(op => op.parents));
  for (const op of operations) {
    if (superseded.has(op.id)) continue;
    if (!byKey.has(op.key)) byKey.set(op.key,[]);
    byKey.get(op.key).push(op);
  }
  for (const list of byKey.values()) list.sort((a,b) => b.id.localeCompare(a.id));
  return byKey;
}
export function project(heads, month) {
  const records = [...heads.values()].map(list => list[0].value).filter(Boolean);
  const byType = type => records.filter(record => record.type === type);
  const cards = byType('card').sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
  const fixedBySeries = new Map();
  for (const item of byType('fixed').filter(item => item.month <= month)) {
    if (!item.recurring && item.month !== month) continue;
    const previous = fixedBySeries.get(item.series);
    if (!previous || item.month > previous.month ||
      (item.month === previous.month && !item.recurring)) fixedBySeries.set(item.series,item);
  }
  const fixed = [...fixedBySeries.values()].filter(item => !item.removed)
    .map(item => item.group===undefined && item.series.startsWith('import-') && /\bd[eé]b\.?\s*$/i.test(item.name)
      ? {...item,group:'Débitos'} : item)
    .sort((a,b) => a.day-b.day || a.name.localeCompare(b.name,'pt-BR'));
  const entries = byType('entry').filter(item => item.month === month)
    .sort((a,b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name,'pt-BR'));
  const income = key => heads.get('income:'+month+':'+key)?.[0].value?.amount;
  return {cards,fixed,entries,payment:income('payment'),advance:income('advance'),extra5:income('extra5'),extra20:income('extra20')};
}
export function distribute(total, count, month) {
  const base = Math.trunc(total/count);
  const remainder = total - base*count;
  return Array.from({length:count}, (_,index) => ({
    amount:base + (index < Math.abs(remainder) ? Math.sign(remainder) : 0),
    month:shiftMonth(month,index),part:index+1,count
  }));
}
export function openDatabase() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('contas-ccs',1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('batches',{keyPath:'id'});
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function read(db, store, key) {
  return new Promise((resolve,reject) => {
    const objectStore = db.transaction(store).objectStore(store);
    const request = key === undefined ? objectStore.getAll() : objectStore.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function write(db, store, records) {
  return new Promise((resolve,reject) => {
    const tx = db.transaction(store,'readwrite');
    const objectStore = tx.objectStore(store);
    for (const [value,key] of records) key === undefined ? objectStore.put(value) : objectStore.put(value,key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}
export function bindAccount(db, profile) {
  return new Promise((resolve,reject) => {
    const tx=db.transaction('settings','readwrite');
    const settings=tx.objectStore('settings');
    const request=settings.get('account');
    let mismatch=false;
    request.onsuccess=()=>{
      if (request.result && request.result.sub!==profile.sub) {
        mismatch=true;
        tx.abort();
        return;
      }
      settings.put(profile,'account');
    };
    tx.oncomplete=()=>resolve(profile);
    tx.onabort=()=>reject(mismatch ? new Error('Este perfil local já está vinculado a outra conta Google.') : tx.error);
  });
}
const TYPES = new Set(['card','fixed','entry','income','import']);
export function validateBatch(batch) {
  const str = (value,max=300) => typeof value === 'string' && value.length>0 && value.length<=max;
  const amount = value => Number.isSafeInteger(value) && Math.abs(value)<=1e12;
  if (batch?.schema !== 1 || !str(batch.id,80) || !Array.isArray(batch.ops) || batch.ops.length>20000) return false;
  return batch.ops.every(op => {
    if (!op || !str(op.id,100) || !str(op.key,300) || !Array.isArray(op.parents) ||
      !op.parents.every(parent => str(parent,100))) return false;
    const v = op.value;
    if (v === null) return true;
    if (!v || !TYPES.has(v.type) || !op.key.startsWith(v.type+':')) return false;
    if (v.type==='import') return str(v.name);
    if (v.type==='income') return amount(v.amount);
    if (v.type==='card') return str(v.id,100) && str(v.name) && [5,20].includes(v.day) && typeof v.archived==='boolean';
    if (!str(v.name) || !amount(v.amount) || !validMonth(v.month)) return false;
    if (v.type==='fixed') return str(v.series,100) && [5,20].includes(v.day) &&
      typeof v.recurring==='boolean' && typeof v.removed==='boolean' &&
      (v.group===undefined || typeof v.group==='string' && v.group.length<=100);
    return str(v.card,100) && Object.hasOwn(kinds,v.kind) &&
      (v.date === '' || (typeof v.date==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date))) &&
      (v.kind!=='installment' || (Number.isInteger(v.part) && Number.isInteger(v.count) &&
        v.part>=1 && v.count>=v.part && v.count<=600));
  });
}
