import {unzipSync,strFromU8} from './fflate.js';
import {cardKey,sum} from './core.js';

const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const fold=text=>String(text ?? '').trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'');
const name=text=>String(text ?? '').trim().replace(/\s+/g,' ').slice(0,250);
const number=value=>typeof value==='number' && Number.isFinite(value);
const cent=value=>Math.round(value*100);
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(value=>value.toString(16).padStart(2,'0')).join('').slice(0,24);

function xml(zip,path) {
  if (!zip[path]) throw new Error('Planilha inválida ou incompatível.');
  const document=new DOMParser().parseFromString(strFromU8(zip[path]),'application/xml');
  if (document.querySelector('parsererror')) throw new Error('XML inválido na planilha.');
  return document;
}
function sheetCells(document,strings) {
  const cells=new Map();
  for (const cell of document.getElementsByTagNameNS('*','c')) {
    const type=cell.getAttribute('t');
    const raw=cell.getElementsByTagNameNS('*','v')[0]?.textContent;
    const formula=cell.getElementsByTagNameNS('*','f')[0]?.textContent;
    let value=raw === undefined ? undefined : Number(raw);
    if (type==='s') value=strings[Number(raw)];
    if (type==='inlineStr') value=cell.getElementsByTagNameNS('*','is')[0]?.textContent;
    if (type==='str') value=raw;
    if (['e','b','d'].includes(type)) value=undefined;
    cells.set(cell.getAttribute('r'),{value,formula});
  }
  return cells;
}
function rangeOfSum(formula,column,fallback) {
  const match=new RegExp('SUM\\(\\$?'+column+'\\$?(\\d+):\\$?'+column+'\\$?(\\d+)\\)','i').exec(formula ?? '');
  return match ? match.slice(1).map(Number) : fallback;
}

export async function importWorkbook(file,year) {
  if (!Number.isInteger(year) || year<1900 || year>9998) throw new Error('Informe o ano das abas.');
  if (file.size>10_000_000) throw new Error('O arquivo XLSX ultrapassa 10 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  let expanded=0;
  const zip=unzipSync(bytes,{filter:entry=>{
    if (!/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(entry.name)) return false;
    expanded+=entry.originalSize;
    if (expanded>30_000_000) throw new Error('Planilha acima do limite de leitura.');
    return true;
  }});
  const source=await hash(bytes);
  const workbook=xml(zip,'xl/workbook.xml');
  const relations=xml(zip,'xl/_rels/workbook.xml.rels');
  const strings=zip['xl/sharedStrings.xml'] ? [...xml(zip,'xl/sharedStrings.xml').getElementsByTagNameNS('*','si')].map(item=>item.textContent) : [];
  const changes=new Map(), notes=[];
  const knownCards=new Map([
    ['nubank',{id:'nubank',name:'Nubank',day:20}],
    ['mercado pago',{id:'mercado-pago',name:'Mercado Pago',day:20}]
  ]);
  const recognized=new Set();
  for (const sheet of workbook.getElementsByTagNameNS('*','sheet')) {
    const label=sheet.getAttribute('name');
    const index=months.indexOf(fold(label).slice(0,3));
    if (index<0 || recognized.has(index)) continue;
    const relation=[...relations.getElementsByTagNameNS('*','Relationship')].find(rel=>rel.getAttribute('Id')===sheet.getAttribute('r:id'));
    const target=relation?.getAttribute('Target');
    if (!target) continue;
    const path=target.startsWith('/') ? target.slice(1) : 'xl/'+target;
    const cells=sheetCells(xml(zip,path),strings);
    const value=address=>cells.get(address)?.value;
    const formula=address=>cells.get(address)?.formula;
    const marker=(column,text)=>[...cells.keys()].find(address=>address.match(/^\D+/)?.[0]===column && fold(value(address))===text);
    const left=marker('A','total pagar'),right=marker('F','total pagar');
    if (!left || !right || fold(value('A5'))!=='pagamento' || fold(value('F5'))!=='vale') continue;
    recognized.add(index);
    const month=year+'-'+String(index+1).padStart(2,'0');
    for (const [key,address] of Object.entries({payment:'B1',advance:'G1',extra5:'B2',extra20:'G2'})) {
      if (number(value(address))) changes.set('income:'+month+':'+key,{type:'income',amount:cent(value(address))});
    }
    const parseCard=(id,markerAddress,columns) => {
      if (!markerAddress) return;
      const card=[...knownCards.values()].find(item=>item.id===id);
      changes.set(cardKey(id),{type:'card',...card,archived:false});
      const start=Number(markerAddress.slice(1));
      const items=[];
      for (const [labelCol,amountCol,firstRow,lastRow,subscriptionBlock] of columns) {
        for (let row=firstRow;row<=lastRow;row++) {
          const address=amountCol+row;
          const amount=value(address);
          if (!number(amount) || amount===0 || /^SUM\(/i.test(formula(address) ?? '')) continue;
          const description=name(value(labelCol+row));
          const match=description.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
          const part=Number(match?.[1]),count=Number(match?.[2]);
          const installment=part>0 && count>=part && count<=600;
          const knownSubscription=/youtube|wellhub|welhub|starlink|chat\s*gpt|google one|netflix|spotify|ultravioleta/i.test(description);
          const kind=installment ? 'installment' : (knownSubscription || subscriptionBlock) ? 'subscription' : 'review';
          const item={type:'entry',card:id,month,amount:cent(amount),name:description || 'Lançamento '+address,
            date:'',kind,...(installment ? {part,count} : {})};
          items.push(item);
          changes.set('entry:'+source+':'+month+':'+address,item);
        }
      }
      const expected=value('L'+start);
      if (number(expected) && sum(items)!==cent(expected)) {
        const difference=cent(expected)-sum(items);
        changes.set('entry:'+source+':'+month+':'+id+':ajuste',{type:'entry',card:id,month,amount:difference,
          name:'Ajuste do total da planilha',date:'',kind:'review'});
        notes.push(label+' · '+card.name+' tem um ajuste para revisão.');
      }
    };
    const nubank=marker('K','nubank'),mp=marker('K','mercado pago');
    if (nubank) {
      const start=Number(nubank.slice(1));
      const next=mp ? Number(mp.slice(1))-1 : 27;
      const totals=(formula('L'+start) ?? '').match(/^L(\d+)\+O(\d+)$/i);
      const main=totals ? Number(totals[1]) : next;
      const side=totals ? Number(totals[2]) : next;
      const mainRange=rangeOfSum(formula('L'+main),'L',[start+1,main-1]);
      const sideRange=rangeOfSum(formula('O'+side),'O',[start,side-1]);
      parseCard('nubank',nubank,[['K','L',...mainRange,false],['N','O',...sideRange,true]]);
    }
    if (mp) {
      const start=Number(mp.slice(1));
      const total=Number((formula('L'+start) ?? '').match(/^L(\d+)$/i)?.[1]);
      const range=rangeOfSum(formula('L'+total),'L',[start+1,(total || start+12)-1]);
      parseCard('mercado-pago',mp,[['K','L',...range,false]]);
    }
    for (const [day,labelCol,amountCol,totalAddress] of [[5,'A','B',left],[20,'F','G',right]]) {
      const items=[];
      const names=new Map();
      const totalRow=Number(totalAddress.slice(1));
      const amountTotal=amountCol+totalRow;
      for (let row=7;row<totalRow;row++) {
        const amount=value(amountCol+row),description=name(value(labelCol+row));
        const normalized=fold(description);
        if (!description || !number(amount) || amount===0 || normalized.startsWith('total') ||
          (nubank && normalized==='cartao nubank') || (mp && normalized==='cartao mercado pago')) continue;
        const occurrence=(names.get(normalized) || 0)+1;
        names.set(normalized,occurrence);
        const series='import-'+await hash(new TextEncoder().encode(day+':'+normalized+':'+occurrence));
        const item={type:'fixed',series,month,amount:cent(amount),name:description,day,recurring:false,removed:false};
        changes.set('fixed:'+series+':'+month,item);
        items.push(item);
      }
      const cards=day===20 ? (nubank ? cent(value('L'+nubank.slice(1)) || 0) : 0) +
        (mp ? cent(value('L'+mp.slice(1)) || 0) : 0) : 0;
      if (!number(value(amountTotal))) continue;
      const difference=cent(value(amountTotal))-sum(items)-cards;
      if (difference) {
        const series='ajuste-'+source+'-'+day;
        changes.set('fixed:'+series+':'+month,{type:'fixed',series,month,amount:difference,name:'Ajuste do total da planilha',
          day,recurring:false,removed:false});
        notes.push(label+' · dia '+day+' tem um ajuste para revisão.');
      }
    }
  }
  if (!recognized.size) throw new Error('Nenhuma aba do modelo Contas CCS foi encontrada.');
  const key='import:'+year+':'+source;
  changes.set(key,{type:'import',name:file.name.slice(0,300)});
  return {key,changes,months:recognized.size,notes};
}
