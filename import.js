import {unzipSync,strFromU8} from './fflate.js';
import {cardKey,sum,installments} from './core.js';

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

export async function importWorkbook(file,year,existingCards=[]) {
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
  const sheets=[...workbook.getElementsByTagNameNS('*','sheet')];
  const targets=new Map([...relations.getElementsByTagNameNS('*','Relationship')].map(rel=>[rel.getAttribute('Id'),rel.getAttribute('Target')]));
  const readSheet=sheet=>{
    const target=targets.get(sheet.getAttribute('r:id'));
    if (!target) throw new Error('Não foi possível localizar a aba '+sheet.getAttribute('name')+'.');
    return sheetCells(xml(zip,target.startsWith('/')?target.slice(1):'xl/'+target),strings);
  };
  const guide=sheets.find(sheet=>fold(sheet.getAttribute('name'))==='como preencher');
  const guideCells=guide ? readSheet(guide) : new Map();
  const modern=fold(guideCells.get('A17')?.value)==='ano da planilha';
  const validYear=value=>Number.isInteger(value) && value>=1900 && value<=9998;
  if (modern) {
    const workbookYear=Number(guideCells.get('B17')?.value);
    if (!validYear(workbookYear)) throw new Error('Preencha o ano na aba Como preencher, na célula B17, e salve a planilha.');
    if (year!==undefined && year!==workbookYear) throw new Error('O ano informado é diferente do ano da planilha ('+workbookYear+').');
    year=workbookYear;
  }
  if (!validYear(year)) throw new Error('Informe o ano das abas no campo Ano (para planilhas antigas).');
  const changes=new Map(), notes=[];
  const knownCards=new Map([
    ['nubank',{id:'nubank',name:'Nubank',day:20}],
    ['mercado pago',{id:'mercado-pago',name:'Mercado Pago',day:20}]
  ]);
  for (const card of existingCards) {
    const key=fold(card.name);
    if (!knownCards.has(key) || knownCards.get(key).id===card.id) knownCards.set(key,card);
  }
  const recognized=new Set();
  for (const sheet of sheets) {
    const label=sheet.getAttribute('name');
    const index=months.indexOf(fold(label).slice(0,3));
    if (index<0 || recognized.has(index)) continue;
    const cells=readSheet(sheet);
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
        const group=modern ? name(value((day===5?'C':'H')+row)).slice(0,100) : undefined;
        const item={type:'fixed',series,month,amount:cent(amount),name:description,day,recurring:false,removed:false,
          ...(group!==undefined ? {group} : {})};
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
  const supplementary=modern ? sheets.filter(sheet=>['cartoes adicionais','lancamentos programados'].includes(fold(sheet.getAttribute('name')))) : [];
  const existingIds=new Set(existingCards.map(card=>card.id));
  const explicitDays=new Map();
  for (const additional of supplementary) {
    const scheduled=fold(additional.getAttribute('name'))==='lancamentos programados';
    const cells=readSheet(additional);
    const rows=[...new Set([...cells.keys()].filter(address=>/^[A-I]\d+$/.test(address)).map(address=>Number(address.slice(1))))]
      .filter(row=>row>=6).sort((a,b)=>a-b);
    const types={'compra a vista':'purchase','assinatura':'subscription','parcelamento':'installment',
      ...(scheduled ? {unica:'purchase',mensal:'subscription'} : {})};
    for (const row of rows) {
      const [period,cardName,description,amount,type,part,count,day,group]=[...'ABCDEFGHI'].map(col=>cells.get(col+row)?.value);
      if ([period,cardName,description,amount,type,part,count,day,group].every(value=>value===undefined || value==='')) continue;
      const key=fold(cardName);
      const isAccount=scheduled && key==='conta';
      const monthIndex=Number.isInteger(period) ? period-1 : months.indexOf(fold(period).slice(0,3));
      const kind=types[fold(type)];
      const error=message=>new Error(additional.getAttribute('name')+', linha '+row+'. '+message);
      if (monthIndex<0 || monthIndex>11 || !key || !name(description) || !number(amount) || !Object.hasOwn(types,fold(type))) {
        throw error('Preencha mês, destino, descrição, valor e tipo.');
      }
      if (day!==undefined && day!=='' && ![5,20].includes(Number(day))) throw error('O dia deve ser 5 ou 20.');
      if (kind==='installment' && (!Number.isInteger(part) || !Number.isInteger(count) || part<1 || count<part || count>600)) {
        throw error('Preencha o número da parcela e o total de parcelas.');
      }
      const month=year+'-'+String(monthIndex+1).padStart(2,'0');
      const money=cent(amount);
      const series='sched-'+source+'-'+year+'-'+row;
      const recurring=scheduled && kind==='subscription';
      let slices=[{month,amount:money,...(kind==='installment'?{part,count}:{})}];
      if (scheduled && kind==='installment') {
        try {slices=installments(money,part,count,month).map(slice=>({...slice,installmentId:series}));}
        catch (cause) {throw error(cause.message);}
      }
      if (isAccount) {
        for (const slice of slices) {
          const item={type:'fixed',series,name:name(description),day:Number(day || 5),
            group:name(group).slice(0,100),recurring,removed:false,...slice};
          changes.set('fixed:'+series+':'+slice.month+(recurring?':rec':''),item);
        }
        continue;
      }
      let card=knownCards.get(key);
      if (!card) {
        const id='import-'+await hash(new TextEncoder().encode(key));
        card={id,name:name(cardName),day:day ? Number(day):20,archived:false};
        knownCards.set(key,card);
      }
      if (!existingIds.has(card.id) && day) {
        const selectedDay=Number(day);
        if (explicitDays.has(card.id) && explicitDays.get(card.id)!==selectedDay) {
          throw error('Use o mesmo dia de pagamento para todos os lançamentos desse cartão.');
        }
        explicitDays.set(card.id,selectedDay);
        card={...card,day:selectedDay};
        knownCards.set(key,card);
      }
      changes.set(cardKey(card.id),{type:'card',...card,archived:card.archived ?? false});
      for (const slice of slices) {
        const entry={type:'entry',card:card.id,date:'',name:name(description),kind,...slice,
          ...(recurring?{series,recurring:true,removed:false}:{})};
        const entryKey=recurring ? 'entry:sub:'+series+':'+slice.month+':rec' :
          scheduled ? 'entry:'+series+':'+slice.month : 'entry:'+source+':'+year+':card:'+row;
        changes.set(entryKey,entry);
      }
    }
  }
  const key='import:'+year+':'+source;
  changes.set(key,{type:'import',name:file.name.slice(0,300)});
  return {key,changes,year,months:recognized.size,notes};
}
