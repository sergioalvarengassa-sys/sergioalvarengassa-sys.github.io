import {money,currentMonth,shiftMonth,cents,inputMoney,kinds,sum,cardKey,newId,validMonth,revisions,project,cardEntries,installments,
  openDatabase,read,write,bindAccount,validateBatch} from './core.js';
import * as drive from './drive.js';
import {googleClientId} from './config.js';

const $ = selector => document.querySelector(selector);
const dialog = $('#dialog');
const view = $('#view');
const cash = value => money.format(value/100);
const text = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const month = $('#month');
month.value=currentMonth();
let db, batches=[], heads=new Map(), account, active='monthly', syncing, connectedAccount, reviewCount=0;
let authorizing=false;
const channel=typeof BroadcastChannel==='function' ? new BroadcastChannel('contas-ccs-data') : null;

function notice(message,error=false) {
  const element=$('#alert');
  element.textContent=message;
  element.hidden=!message;
  element.classList.toggle('error',error);
  const modal=$('#modal-status');
  if (modal) {
    modal.textContent=message;
    modal.hidden=!message;
    modal.classList.toggle('error',error);
  }
}
function syncLabel(message) {
  const status=$('#sync-state');
  if (!message && account && googleClientId && !drive.connected()) {
    if (!status.querySelector('button')) status.innerHTML=click('Reconectar ao Drive','connect');
    return;
  }
  status.textContent=message || (drive.connected() && connectedAccount ? 'Drive conectado' : 'Dados neste aparelho');
}
async function reload() {
  batches=await read(db,'batches');
  heads=revisions(batches.flatMap(batch=>batch.ops));
  account=await read(db,'settings','account');
  reviewCount=[...heads.values()].filter(list=>list.length>1).length;
}
async function commit(changes, expected) {
  await reload();
  const batch={schema:1,id:newId(),ops:[...changes].map(([key,value])=>({
    id:newId(),key,value,parents:expected?.get(key) || heads.get(key)?.map(op=>op.id) || []
  }))};
  if (!validateBatch(batch)) throw new Error('Não foi possível validar os dados para salvar.');
  if (!batch.ops.length) return;
  await write(db,'batches',[[batch]]);
  channel?.postMessage('reload');
  await reload();
  render();
  void sync();
}
function click(label,action,css='') {
  return '<button type="button" data-action="'+text(action)+'" class="'+css+'">'+text(label)+'</button>';
}
const line=(label,value,total=false)=>'<div class="summary-line '+(total?'total ':'')+
  (value<0?'negative':'')+'"><span>'+text(label)+'</span><strong>'+cash(value)+'</strong></div>';
const section=(title,body,action='')=>'<section class="panel"><div class="section-head"><h2>'+text(title)+'</h2>'+action+'</div>'+body+'</section>';
const table=(headers,rows)=>'<table class="table"><thead><tr>'+headers.map(([label,css=''])=>
  '<th scope="col" class="'+css+'">'+text(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
const empty=message=>'<p class="empty">'+text(message)+'</p>';
const fixedKey=(item,recurring=item.recurring)=>'fixed:'+item.series+':'+item.month+(recurring?':rec':'');
const entryRows = card => cardEntries(heads,month.value).filter(([,item])=>item.card===card.id);

function render() {
  const data=project(heads,month.value);
  const navCards=data.cards.filter(card=>!card.archived || data.entries.some(item=>item.card===card.id) || active===card.id);
  if (active!=='monthly' && !data.cards.some(card=>card.id===active)) active='monthly';
  $('#tabs').innerHTML=[['monthly','Mensal'],...navCards.map(card=>[card.id,card.name])]
    .map(([id,name])=>'<button type="button" data-action="tab:'+text(id)+'" aria-current="'+(active===id)+'">'+text(name)+'</button>')
    .join('')+click('Cartões','cards');
  if (reviewCount) $('#tabs').insertAdjacentHTML('beforeend',click('Conflitos ('+reviewCount+')','conflicts'));
  view.innerHTML=active==='monthly' ? monthly(data) : statement(data.cards.find(card=>card.id===active));
  syncLabel();
}
function monthly(data) {
  const incomes=[['payment','Pagamento · dia 5',data.payment],['advance','Vale · dia 20',data.advance]];
  const input=incomes.map(([id,label,value])=>'<label class="income">'+label+
    '<input inputmode="decimal" autocomplete="off" data-income="'+id+'" placeholder="R$ 0,00" value="'+
    (value===undefined?'':inputMoney(value))+'"></label>').join('');
  const row=(item,index)=>'<tr><td>'+text(item.name)+
    (item.part?' <small>('+item.part+' de '+item.count+')</small>':'')+'</td><td>'+item.day+
    '</td><td class="amount">'+cash(item.amount)+'</td><td class="action-cell">'+click('Editar','fixed:'+index)+'</td></tr>';
  const rows=[],groups=new Map();
  data.fixed.forEach((item,index)=>{
    if (!item.group) {rows.push(row(item,index));return;}
    const key=item.day+':'+item.group.toLocaleLowerCase('pt-BR');
    if (!groups.has(key)) groups.set(key,{name:item.group,day:item.day,amount:0,rows:[]});
    const group=groups.get(key);
    group.rows.push(row(item,index));
    group.amount+=item.amount;
  });
  for (const group of groups.values()) {
    rows.push('<tr class="fixed-group"><th colspan="4" scope="rowgroup">'+text(group.name)+
      ' · dia '+group.day+' · '+cash(group.amount)+'</th></tr>',...group.rows);
  }
  const fixed=section('Contas e despesas',rows.length?table([['Conta'],['Dia'],['Valor','amount'],['']],rows):
    empty('Adicione sua primeira despesa.'),click('+ Despesa','fixed:new'));
  const billed=data.cards.map(card=>({...card,amount:sum(data.entries.filter(item=>item.card===card.id))}))
    .filter(card=>!card.archived || card.amount!==0);
  const subtotal=day=>sum(data.fixed.filter(item=>item.day===day))+sum(billed.filter(card=>card.day===day));
  const paid=(data.payment ?? 0)+(data.extra5 ?? 0);
  const advance=(data.advance ?? 0)+(data.extra20 ?? 0);
  const five=subtotal(5),twenty=subtotal(20);
  const cardLines=billed.map(card=>line(card.name,card.amount)).join('');
  const summary=section('Resumo do mês','<div class="content">'+line('Entradas · dia 5',paid)+line('Despesas · dia 5',five)+
    line('Saldo · dia 5',paid-five,true)+line('Entradas · dia 20',advance)+line('Despesas · dia 20',twenty)+
    line('Saldo · dia 20',advance-twenty,true)+line('Saldo do mês',paid+advance-five-twenty,true)+
    (cardLines?'<div class="card-summary"><h3>Faturas incluídas nas despesas</h3>'+cardLines+'</div>':'')+'</div>',
    click('Editar extras','extras'));
  return '<div class="incomes">'+input+'</div><div class="monthly">'+fixed+summary+'</div>';
}
function statement(card) {
  const entries=entryRows(card);
  const parts=Object.entries(kinds).filter(([kind])=>kind!=='review' || entries.some(([,item])=>item.kind===kind));
  const panels=parts.map(([kind,label])=>{
    const group=entries.filter(([,item])=>item.kind===kind);
    const rows=group.map(([key,item])=>'<tr><td>'+text(item.name)+
      (item.kind==='installment'?' <small>('+item.part+' de '+item.count+')</small>':'')+
      (item.recurring?' <small>· mensal</small>':'')+
      '</td><td class="minor">'+text(item.date ? item.date.split('-').reverse().join('/') : '—')+'</td><td class="amount">'+
      cash(item.amount)+'</td><td class="action-cell">'+click('Editar','entry:'+key)+'</td></tr>');
    return section(label+' · '+cash(sum(group.map(([,item])=>item))),
      rows.length?table([['Descrição'],['Data','minor'],['Valor','amount'],['']],rows):empty('Nenhum lançamento neste mês.'));
  }).join('');
  return '<div class="card-top"><h1>'+text(card.name)+(card.archived?' <small>· arquivado</small>':'')+'</h1>'+
    (card.archived?'':click('+ Lançamento','entry:new','primary'))+'</div>'+
    line('Total da fatura',sum(entries.map(([,item])=>item)),true)+'<div class="card-groups">'+panels+'</div>';
}
function show(title,html) {
  $('#dialog-title').textContent=title;
  $('#dialog-body').innerHTML=html+'<p id="modal-status" role="status" hidden></p>';
  if (!dialog.open) dialog.showModal();
}
const field=(label,name,value='',attrs='')=>'<label>'+text(label)+'<input name="'+name+'" value="'+text(value)+'" '+attrs+'></label>';
const select=(label,name,options,selected)=>'<label>'+text(label)+'<select name="'+name+'">'+options.map(([id,title])=>
  '<option value="'+text(id)+'" '+(String(id)===String(selected)?'selected':'')+'>'+text(title)+'</option>').join('')+'</select></label>';
function form(title,fields,save,remove,removeLabel='Retirar') {
  show(title,'<form>'+fields+'<p class="form-error" role="alert" hidden></p><div class="dialog-actions">'+
    (remove?'<button type="button" id="remove" class="danger">'+text(removeLabel)+'</button>':'')+
    '<button type="submit" class="primary">Salvar</button></div></form>');
  const node=$('#dialog-body form');
  const run=async operation=>{
    const data=new FormData(node);
    node.querySelectorAll('button').forEach(button=>button.disabled=true);
    try {
      await operation(data);
      dialog.close();
    } catch (error) {
      const message=node.querySelector('.form-error');
      message.textContent=error.message;
      message.hidden=false;
    } finally {
      node.querySelectorAll('button').forEach(button=>button.disabled=false);
    }
  };
  node.addEventListener('submit',event=>{event.preventDefault();void run(save);});
  if (remove) $('#remove').onclick=()=>void run(remove);
  return node;
}
const days=[[5,'Pagamento · dia 5'],[20,'Vale · dia 20']];
const scopes=[['single','Só neste mês'],['future','Neste mês e nos próximos']];
const installmentFields=(part=1,count=2,editing=false)=>'<fieldset data-installments>'+
  field('Parcela atual','part',part,'type="number" required min="1" max="600"')+
  field('Total de parcelas','count',count,'type="number" required min="2" max="600"')+
  (editing?'':select('Valor informado','amountBasis',[['parcel','Valor de uma parcela'],['total','Valor total da compra']],'parcel'))+
  '<small>'+(editing?'Alterações nesta tela valem para a parcela selecionada.':
    'O app lança da parcela atual até a última.')+'</small></fieldset>';
function toggleFields(node,selector,visible) {
  const fields=node.querySelector(selector);
  if (fields) fields.hidden=fields.disabled=!visible;
}
function fixedEditor(item) {
  const selectedMonth=month.value;
  const series=item?.series || newId();
  const save=(data,removed=false)=>{
    const kind=data.get('kind');
    const recurring=!item ? kind==='subscription' : !item.part && data.get('scope')==='future';
    const name=removed ? item.name : String(data.get('name')).trim();
    if (!name) throw new Error('Informe o nome da conta.');
    const group=removed ? (item.group || '') : String(data.get('group')).trim();
    const value={type:'fixed',name,series,group,month:selectedMonth,day:Number(data.get('day')),
      amount:removed?0:cents(data.get('amount')),recurring,removed,
      ...(item?.part ? {part:item.part,count:item.count} : {})};
    if (!item && kind==='installment') {
      const schedule=installments(value.amount,Number(data.get('part')),Number(data.get('count')),selectedMonth,data.get('amountBasis')==='total');
      return commit(new Map(schedule.map(slice=>{
        const expense={...value,...slice};
        return [fixedKey(expense),expense];
      })));
    }
    const changes=new Map([[fixedKey(value),value]]);
    if (recurring) {
      for (const [key,list] of heads) {
        const existing=list[0].value;
        if (existing?.type==='fixed' && existing.series===series && existing.month>=selectedMonth && key!==fixedKey(value)) {
          changes.set(key,null);
        }
      }
    }
    return commit(changes);
  };
  const node=form(item?'Editar despesa':'Adicionar despesa',
    field('Conta','name',item?.name,'required maxlength="250"')+
    (!item ? select('Tipo','kind',[['subscription','Despesa mensal'],['purchase','Despesa única'],['installment','Parcelamento']],'subscription') : '')+
    field('Valor (R$)','amount',item?inputMoney(item.amount):'','required inputmode="decimal"')+
    (!item ? installmentFields() : '')+
    field('Grupo de despesas (opcional)','group',item?.group,'maxlength="100" list="fixed-groups"')+
    '<datalist id="fixed-groups">'+[...new Set(project(heads,selectedMonth).fixed.map(item=>item.group).filter(Boolean))]
      .map(group=>'<option value="'+text(group)+'"></option>').join('')+'</datalist>'+
    select('Separar do recebimento','day',days,item?.day || 5)+
    (item && !item.part ? select('Aplicar','scope',scopes,'single') :
      item ? '<small>Alterações nesta tela valem para a parcela selecionada.</small>' : ''),
    data=>save(data),item?data=>save(data,true):null);
  if (!item) {
    const toggle=()=>toggleFields(node,'[data-installments]',node.elements.kind.value==='installment');
    node.elements.kind.onchange=toggle;
    toggle();
  }
}
function cardList() {
  const {cards}=project(heads,month.value);
  show('Gerenciar cartões','<div class="setting-group">'+cards.map(card=>'<div class="summary-line"><span>'+
    text(card.name)+(card.archived?' · Arquivado':'')+'</span>'+click('Editar','card:'+card.id)+'</div>').join('')+
    (cards.length?'':empty('Cadastre um cartão para lançar despesas.'))+'</div><div class="dialog-actions">'+
    click('+ Cartão','card:new','primary')+'</div>');
}
function cardEditor(card) {
  const id=card?.id || newId();
  const change=(data,archived=false)=>{
    const name=String(data.get('name')).trim();
    if (!name) throw new Error('Informe o nome do cartão.');
    return commit(new Map([[cardKey(id),{type:'card',id,name,archived,day:Number(data.get('day'))}]]));
  };
  form(card?'Editar cartão':'Adicionar cartão',
    field('Nome do cartão','name',card?.name,'required maxlength="250"')+
    select('Fatura paga com','day',days,card?.day || 20)+
    (card?'<small>Arquivar retira o cartão dos novos lançamentos e preserva as faturas e parcelas existentes. Salvar reativa um cartão arquivado.</small>':''),
    data=>change(data),card && !card.archived ? data=>change(data,true):null,'Arquivar');
}
function entryEditor(key) {
  const item=heads.get(key)?.[0].value;
  const all=project(heads,month.value).cards;
  const available=all.filter(card=>!card.archived || card.id===item?.card);
  const selectedMonth=month.value;
  const date=new Date();
  const today=currentMonth()+'-'+String(date.getDate()).padStart(2,'0');
  const kindOptions=[['purchase','Compra à vista'],['subscription','Assinatura'],['installment','Parcelamento']];
  if (item?.kind==='review') kindOptions.push(['review','Para revisar']);
  const series=item?.series || newId();

  function save(data,removed=false) {
    const kind=item?.series ? 'subscription' : data.get('kind');
    const target=String(data.get('month'));
    const future=data.get('scope')==='future';
    if (removed && !item.series) return commit(new Map([[key,null]]));
    const value={type:'entry',name:removed?item.name:String(data.get('name')).trim(),month:target,
      amount:removed?0:cents(data.get('amount')),kind,card:removed?item.card:String(data.get('card')),date:String(data.get('date'))};
    if (!value.name || !validMonth(target) || !value.card) throw new Error('Preencha a descrição, a fatura e o cartão.');

    if (kind==='subscription' && (future || item?.series)) {
      const ruleKey='entry:sub:'+series+':'+target+(future?':rec':'');
      const changes=new Map([[ruleKey,{...value,series,recurring:future,removed}]]);
      if (item && !item.series) changes.set(key,null);
      if (future) {
        for (const [previous,[{value:record}]] of heads) {
          if (record?.type==='entry' && record.series===series && record.month>=target && previous!==ruleKey) {
            changes.set(previous,null);
          }
        }
      }
      return commit(changes);
    }
    if (kind==='installment') {
      const schedule=installments(value.amount,Number(data.get('part')),Number(data.get('count')),target,data.get('amountBasis')==='total');
      const slices=item ? schedule.slice(0,1) : schedule;
      return commit(new Map(slices.map(slice=>[item?key:'entry:'+newId(),{...value,...slice}])));
    }
    return commit(new Map([[item?key:'entry:'+newId(),value]]));
  }

  const node=form(item?'Editar lançamento':'Novo lançamento',
    select('Cartão','card',available.map(card=>[card.id,card.name]),item?.card || active)+
    field('Descrição','name',item?.name,'required maxlength="250"')+
    field('Data da compra','date',item?.date ?? today,'type="date"')+
    field('Mês da fatura','month',item?.series ? selectedMonth : item?.month || selectedMonth,
      'type="month" required min="1900-01" max="9998-12"'+(item?.series?' readonly':''))+
    (item?.series ? '<small>Assinatura mensal</small>' : select('Tipo','kind',kindOptions,item?.kind || 'purchase'))+
    field('Valor (R$)','amount',item?inputMoney(item.amount):'','required inputmode="decimal"')+
    installmentFields(item?.part,item?.count,Boolean(item))+
    '<fieldset data-subscription>'+select('Aplicar', 'scope',scopes,item?'single':'future')+
    '<small>Uma assinatura mensal aparece automaticamente nas próximas faturas.</small></fieldset>',
    data=>save(data),item?data=>save(data,true):null);
  const toggle=()=>{
    const kind=item?.series ? 'subscription' : node.elements.kind.value;
    toggleFields(node,'[data-installments]',kind==='installment');
    toggleFields(node,'[data-subscription]',kind==='subscription');
  };
  if (node.elements.kind) node.elements.kind.onchange=toggle;
  toggle();
}

function extras() {
  const selectedMonth=month.value;
  const data=project(heads,selectedMonth);
  form('Entradas extras',field('Extras do dia 5 (R$)','extra5',data.extra5===undefined?'':inputMoney(data.extra5),'inputmode="decimal"')+
    field('Extras do dia 20 (R$)','extra20',data.extra20===undefined?'':inputMoney(data.extra20),'inputmode="decimal"'),
    values=>commit(new Map(['extra5','extra20'].map(key=>['income:'+selectedMonth+':'+key,
      values.get(key).trim()?{type:'income',amount:cents(values.get(key))}:null]))));
}

function settings() {
  show('Dados e sincronização',
    '<section class="setting-group"><h3>Google Drive</h3>'+
    (account?'<p>Conta vinculada: '+text(account.email)+'</p>':'<p>Use a mesma conta Google nos dois aparelhos.</p>')+
    (googleClientId ? (drive.connected() && connectedAccount ? click('Sincronizar agora','sync','primary')+click('Desconectar','disconnect') :
      click('Conectar ao Google Drive','connect','primary')) : '<p class="hint">A sincronização depende do ID Google configurado nesta distribuição. Consulte o guia de instalação.</p>')+
    '</section><section class="setting-group"><h3>Importar dados</h3><p>Use uma planilha XLSX no modelo Contas CCS.</p>'+
    '<div class="import-actions"><a class="button-link" href="modelo-contas-ccs.xlsx" download>Baixar modelo Excel</a>'+
    click('Importar planilha','import')+'</div></section><section class="setting-group"><h3>Cópia de segurança</h3>'+
    click('Exportar dados','backup')+' '+click('Restaurar cópia','restore')+'</section>');
  if (googleClientId) void drive.prepareGoogle().catch(error=>notice(error.message,true));
}
async function connect() {
  if (authorizing) return;
  if (connectedAccount && drive.connected()) return sync();
  if (syncing) throw new Error('Aguarde a sincronização atual antes de conectar.');
  connectedAccount=undefined;
  authorizing=true;
  try {
    const profile=await drive.authorize(googleClientId,account?.email);
    const saved=await read(db,'settings','account');
    if (saved && saved.sub!==profile.sub) throw new Error('Este perfil local está vinculado a outra conta Google. Use outro perfil do navegador.');
    if (!saved && batches.length && !confirm('Vincular os dados salvos neste aparelho à conta '+profile.email+'?')) {
      drive.disconnect();
      return;
    }
    account=await bindAccount(db,{sub:profile.sub,email:profile.email});
    connectedAccount=account.sub;
    if (dialog.open) settings();
    await sync();
  } catch (error) {
    connectedAccount=undefined;
    drive.disconnect();
    throw error;
  } finally {
    authorizing=false;
  }
}
function sync(force=false) {
  if (syncing) return syncing;
  if (!drive.connected() || !connectedAccount || !navigator.onLine) {
    syncLabel(!navigator.onLine ? 'Offline · salvo neste aparelho' : undefined);
    return;
  }
  syncing=(async()=>{
    const bound=await read(db,'settings','account');
    if (bound?.sub!==connectedAccount) throw new Error('Conta local diferente da conta conectada.');
    syncLabel('Sincronizando…');
    const files=await drive.listBatches();
    const remote=new Map(files.map(file=>[drive.batchId(file),file]));
    const local=new Map((await read(db,'batches')).map(batch=>[batch.id,batch]));
    const incoming=[];
    for (const [id,file] of remote) {
      if (local.has(id)) continue;
      const batch=await drive.fetchBatch(file);
      if (!validateBatch(batch) || batch.id!==id) throw new Error('O Drive contém dados de sincronização incompatíveis.');
      incoming.push([batch]);
    }
    if (incoming.length) {
      await write(db,'batches',incoming);
      channel?.postMessage('reload');
    }
    for (const [id,batch] of local) if (!remote.has(id)) await drive.pushBatch(batch);
    await reload();
    if (incoming.length && !view.contains(document.activeElement)) render();
    else if (incoming.length) refreshOnBlur=true;
    syncLabel('Sincronizado às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}));
    if (force) notice('Sincronização concluída.');
  })().catch(error=>{
    syncLabel(drive.connected()?'Sincronização pendente':undefined);
    if (force) notice(error.message,true);
  }).finally(()=>{syncing=undefined;});
  return syncing;
}
function importer() {
  form('Importar planilha XLSX',field('Planilha','file','','type="file" accept=".xlsx" required')+
    field('Ano (para planilhas antigas)','year','','type="number" min="1900" max="9998"')+
    '<small>No modelo novo, preencha o ano na aba Como preencher. Para arquivos antigos, informe o ano aqui.</small>',
    async values=>{
      const {importWorkbook}=await import('./import.js');
      const yearInput=values.get('year');
      const result=await importWorkbook(values.get('file'),yearInput ? Number(yearInput) : undefined,project(heads,month.value).cards);
      if (heads.has(result.key)) throw new Error('Esta planilha já foi importada para o ano informado.');
      for (const [key,value] of result.changes) {
        if (value.type==='card' && heads.get(key)?.[0].value) result.changes.delete(key);
      }
      const repeated=[...result.changes.keys()].filter(key=>key.startsWith('income:') && heads.get(key)?.[0].value);
      if (repeated.length && !confirm('Há valores de recebimento nestes meses. Substituir os valores e incluir as despesas importadas?')) {
        throw new Error('Importação cancelada.');
      }
      await commit(result.changes);
      const year=String(result.year);
      if (month.value.slice(0,4)!==year) {
        chooseMonth(year+'-01');
      }
      notice(result.months+' abas importadas.'+(result.notes.length?'\n'+result.notes.length+' ajustes de total marcados para revisão.':''));
    });
}
function backup() {
  const blob=new Blob([JSON.stringify({schema:1,owner:account?.sub || null,batches})],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;
  link.download='contas-ccs-backup-'+currentMonth()+'.json';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function restore() {
  form('Restaurar cópia de segurança',
    '<small>A restauração incorpora os registros do arquivo à base local.</small>'+
    field('Arquivo JSON','file','','type="file" accept=".json" required'),async values=>{
      const file=values.get('file');
      if (file.size>25_000_000) throw new Error('Cópia de segurança muito grande.');
      const copy=JSON.parse(await file.text());
      if (copy.schema!==1 || !Array.isArray(copy.batches) || !copy.batches.every(validateBatch)) throw new Error('Cópia inválida.');
      if (copy.owner && account?.sub!==copy.owner) throw new Error('Conecte a conta Google que criou esta cópia antes de restaurar.');
      const existing=new Set(batches.map(batch=>batch.id));
      const incoming=copy.batches.filter(batch=>!existing.has(batch.id));
      await write(db,'batches',incoming.map(batch=>[batch]));
      await reload();
      render();
      channel?.postMessage('reload');
      notice('Cópia restaurada.');
      void sync();
    });
}
function conflictList() {
  const conflict=[...heads].filter(([,list])=>list.length>1);
  const describe=value=>!value?'Retirado':value.type==='income'?cash(value.amount):
    [value.name,value.month,value.amount===undefined?null:cash(value.amount),value.archived?'Arquivado':null,
      value.removed?'Retirado':null,value.day?'Dia '+value.day:null,value.kind?kinds[value.kind]:null].filter(Boolean).join(' · ');
  show('Resolver alterações simultâneas',conflict.length?conflict.map(([key,list])=>
    '<div class="setting-group"><h3>'+text(list.find(op=>op.value?.name)?.value.name ||
      (key.startsWith('income:')?'Recebimento · '+key.split(':')[1]:'Registro'))+'</h3>'+
    list.map(op=>'<div class="summary-line"><span>'+text(describe(op.value))+'</span>'+click('Manter','resolve:'+op.id)+'</div>').join('')+
    '</div>').join(''):empty('Nenhuma alteração em conflito.'));
}
async function action(event) {
  const button=event.target.closest('[data-action]');
  if (!button || !db) return;
  const [kind,...parts]=button.dataset.action.split(':');
  const arg=parts.join(':');
  const data=project(heads,month.value);
  if (kind==='tab') {active=arg;render();}
  if (kind==='fixed') fixedEditor(data.fixed[Number(arg)]);
  if (kind==='entry') entryEditor(arg);
  if (kind==='cards') cardList();
  if (kind==='card') cardEditor(data.cards.find(card=>card.id===arg));
  if (kind==='extras') extras();
  if (kind==='connect') {
    button.disabled=true;
    try {await connect();} finally {button.disabled=false;}
  }
  if (kind==='disconnect') {
    drive.disconnect();
    connectedAccount=undefined;
    syncLabel();
    settings();
  }
  if (kind==='sync') await sync(true);
  if (kind==='import') importer();
  if (kind==='backup') backup();
  if (kind==='restore') restore();
  if (kind==='conflicts') conflictList();
  if (kind==='resolve') {
    for (const [key,list] of heads) {
      const selected=list.find(op=>op.id===arg);
      if (!selected) continue;
      await commit(new Map([[key,selected.value]]),new Map([[key,list.map(op=>op.id)]]));
      break;
    }
    conflictList();
  }
}
let refreshOnBlur=false;
let selectedMonth=month.value;
function chooseMonth(value) {
  if (!validMonth(value) || value<'1900-01' || value>'9998-12') {
    month.value=selectedMonth;
    return;
  }
  month.value=selectedMonth=value;
  render();
}
document.addEventListener('click',event=>void action(event).catch(error=>notice(error.message,true)));
$('#settings').onclick=()=>{if (db) settings();};
$('#close-dialog').onclick=()=>dialog.close();
$('#prev').onclick=()=>chooseMonth(shiftMonth(selectedMonth,-1));
$('#next').onclick=()=>chooseMonth(shiftMonth(selectedMonth,1));
month.onchange=()=>chooseMonth(month.value);
view.addEventListener('focusout',()=>setTimeout(()=>{
  if (refreshOnBlur && !view.contains(document.activeElement)) {
    refreshOnBlur=false;
    render();
  }
},0));
view.addEventListener('change',event=>{
  const input=event.target;
  if (!input.dataset.income) return;
  try {
    const key='income:'+month.value+':'+input.dataset.income;
    const value=input.value.trim()?{type:'income',amount:cents(input.value)}:null;
    void commit(new Map([[key,value]])).catch(error=>notice(error.message,true));
  } catch (error) {
    notice(error.message,true);
  }
});
channel?.addEventListener('message',()=>void reload().then(()=>{
  if (!view.contains(document.activeElement)) render();
  else refreshOnBlur=true;
}));
addEventListener('online',()=>void sync());
addEventListener('offline',()=>syncLabel('Offline · salvo neste aparelho'));
document.addEventListener('visibilitychange',()=>{if (!document.hidden) void sync();});
setInterval(()=>{if (!document.hidden) void sync();},45000);
try {
  db=await openDatabase();
  await reload();
  if (googleClientId && account) void drive.prepareGoogle().catch(()=>{});
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
} catch (error) {
  notice('Não foi possível abrir o banco local. '+error.message,true);
}

