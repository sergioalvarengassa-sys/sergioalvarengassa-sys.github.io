import {money,currentMonth,shiftMonth,cents,inputMoney,kinds,sum,cardKey,newId,validMonth,revisions,project,cardEntries,installments,parcelInfo,
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
const incomePreference='contas-ccs-income-open';
let incomeOpen=!matchMedia('(max-width: 720px)').matches;
try {
  const saved=localStorage.getItem(incomePreference);
  if (saved!==null) incomeOpen=saved==='true';
} catch {}

const iconPaths={
  wallet:'<path d="M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-2"/><path d="M3 8h16a2 2 0 0 1 2 2v6h-6a3 3 0 0 1 0-6h6"/><path d="M15 13h.01"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20m-15 5h4"/>',
  receipt:'<path d="M5 3l2 1.5L9.5 3 12 4.5 14.5 3 17 4.5 19 3v18l-2-1.5-2.5 1.5-2.5-1.5L9.5 21 7 19.5 5 21zM9 9h6m-6 4h6"/>',
  home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-6h6v6"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0m-4 4h.01"/>',
  bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>',
  water:'<path d="M12 2c2 4 7 8 7 13a7 7 0 0 1-14 0c0-5 5-9 7-13z"/>',
  phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  bag:'<path d="M5 7h14l2 14H3L5 7zM9 9V6a3 3 0 0 1 6 0v3"/>',
  health:'<path d="M12 21S3 15.5 3 9a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 6.5-9 12-9 12z"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  settings:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="var(--surface)"/><circle cx="16" cy="12" r="2" fill="var(--surface)"/><circle cx="10" cy="17" r="2" fill="var(--surface)"/>',
  edit:'<path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/>',
  trash:'<path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>'
};
const icon=(name)=>'<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+iconPaths[name]+'</svg>';
const expenseIcons=[['auto','Automático'],['receipt','Recibo'],['home','Moradia'],['wifi','Internet'],
  ['bolt','Energia'],['water','Água'],['phone','Telefone'],['bag','Compras'],['health','Saúde'],['calendar','Mensalidade']];
const cardColors=[['auto','Automática'],['purple','Roxo'],['blue','Azul'],['indigo','Índigo'],['green','Verde'],['slate','Cinza-azulado']];
const choice=(options,value)=>options.some(([id])=>id===value) ? value : 'auto';
const normalize=value=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
function expenseIcon(item) {
  const selected=choice(expenseIcons,item.icon);
  if (selected!=='auto') return selected;
  const name=normalize(item.name);
  for (const [pattern,symbol] of [[/internet|wi-fi|wifi/,'wifi'],[/energia|luz/,'bolt'],[/\bagua\b/,'water'],
    [/condominio|aluguel|moradia/,'home'],[/\bcel\b|celular|telefone/,'phone'],[/mercado|compras/,'bag'],
    [/saude|farmacia|dentista/,'health'],[/assinatura|mensalidade/,'calendar']]) {
    if (pattern.test(name)) return symbol;
  }
  return 'receipt';
}
function cardColor(card) {
  const selected=choice(cardColors,card.color);
  if (selected!=='auto') return selected;
  const name=normalize(card.id+' '+card.name);
  return name.includes('nubank')?'purple':/mercado[ -]pago/.test(name)?'blue':'indigo';
}
const expenseActions=(item,action)=>'<div class="expense-actions">'+
  '<button type="button" class="edit-icon" data-action="'+text(action)+
  '" aria-label="Editar '+text(item.name)+'" title="Editar">'+icon('edit')+'</button>'+
  '<button type="button" class="edit-icon delete-icon" data-action="delete:'+text(action)+
  '" aria-label="Excluir '+text(item.name)+'" title="Excluir">'+icon('trash')+'</button></div>';
const itemLabel=item=>'<div class="item-label"><span class="expense-icon">'+icon(expenseIcon(item))+'</span>'+
  '<span>'+text(item.name)+(item.part?' <small>('+item.part+' de '+item.count+')</small>':'')+
  (item.type==='entry' && item.recurring?' <small>· mensal</small>':'')+'</span></div>';

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
const table=(headers,rows)=>'<table class="table expense-table"><thead><tr>'+headers.map(([label,css=''])=>
  '<th scope="col" class="'+css+'">'+text(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
const empty=message=>'<p class="empty">'+text(message)+'</p>';
const fixedKey=(item,recurring=item.recurring)=>'fixed:'+item.series+':'+item.month+(recurring?':rec':'');
const entryRows = card => cardEntries(heads,month.value).filter(([,item])=>item.card===card.id);
const metric=(label,value,symbol)=>'<div class="overview-tile metric-tile'+(value<0?' negative':'')+'">'+
  '<span class="tile-caption">'+icon(symbol)+text(label)+'</span><strong>'+cash(value)+'</strong></div>';
const billTile=card=>'<button type="button" class="overview-tile bill-tile tone-'+cardColor(card)+
  '" aria-label="Abrir fatura de '+text(card.name)+'" data-action="tab:'+text(card.id)+'">'+
  '<span class="tile-caption">'+icon('card')+'<span>'+text(card.name)+'</span></span>'+
  '<span class="tile-total"><strong>'+cash(card.amount)+'</strong>'+icon('chevron')+'</span></button>';

function render() {
  const data=project(heads,month.value);
  const navCards=data.cards.filter(card=>!card.archived || data.entries.some(item=>item.card===card.id) || active===card.id);
  if (active!=='monthly' && !data.cards.some(card=>card.id===active)) active='monthly';
  $('#tabs').innerHTML=[['monthly','Mensal','calendar'],...navCards.map(card=>[card.id,card.name,'card'])]
    .map(([id,name,symbol])=>'<button type="button" data-action="tab:'+text(id)+'" aria-current="'+(active===id)+'">'+icon(symbol)+text(name)+'</button>')
    .join('')+'<button type="button" data-action="cards">'+icon('wallet')+'Cartões</button>';
  if (reviewCount) $('#tabs').insertAdjacentHTML('beforeend',click('Conflitos ('+reviewCount+')','conflicts'));
  $('#mobile-conflicts').hidden=!reviewCount;
  $('#mobile-monthly').setAttribute('aria-current',String(active==='monthly'));
  $('#mobile-cards').setAttribute('aria-current',String(active!=='monthly'));
  view.innerHTML=active==='monthly' ? monthly(data) : statement(data.cards.find(card=>card.id===active));
  syncLabel();
}
function monthly(data) {
  const incomes=[['payment','Pagamento · dia 5',data.payment],['advance','Vale · dia 20',data.advance]];
  const input=incomes.map(([id,label,value])=>'<label class="income">'+label+
    '<input inputmode="decimal" autocomplete="off" data-income="'+id+'" placeholder="R$ 0,00" value="'+
    (value===undefined?'':inputMoney(value))+'"></label>').join('');
  const row=(item,index)=>'<tr><td>'+itemLabel(item)+'</td><td class="expense-day">'+item.day+
    '</td><td class="amount">'+cash(item.amount)+'</td><td class="action-cell">'+expenseActions(item,'fixed:'+index)+'</td></tr>';
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
    empty('Adicione sua primeira despesa.'),click('+ Despesa','fixed:new','primary'));
  const billed=data.cards.map(card=>({...card,amount:sum(data.entries.filter(item=>item.card===card.id))}))
    .filter(card=>!card.archived || card.amount!==0);
  const subtotal=day=>sum(data.fixed.filter(item=>item.day===day))+sum(billed.filter(card=>card.day===day));
  const paid=(data.payment ?? 0)+(data.extra5 ?? 0);
  const advance=(data.advance ?? 0)+(data.extra20 ?? 0);
  const five=subtotal(5),twenty=subtotal(20);
  const total=five+twenty;
  const overview='<section class="overview" aria-label="Visão geral do mês">'+
    '<div class="overview-grid overview-metrics">'+metric('Saldo do mês',paid+advance-total,'wallet')+
    metric('Total de despesas',total,'receipt')+metric('Contas e despesas',sum(data.fixed),'receipt')+'</div>'+
    (billed.length?'<div class="overview-grid" aria-label="Faturas do mês">'+billed.map(billTile).join('')+'</div>':'')+'</section>';
  const income='<details class="income-panel"'+(incomeOpen?' open':'')+'><summary>Pagamento e Vale'+
    '<span class="income-control"><span class="show-income">Mostrar</span><span class="hide-income">Ocultar</span>'+
    icon('chevron')+'</span></summary><div class="incomes">'+input+'</div></details>';
  const summary=section('Resumo do mês','<div class="content">'+line('Entradas · dia 5',paid)+line('Despesas · dia 5',five)+
    line('Saldo · dia 5',paid-five,true)+line('Entradas · dia 20',advance)+line('Despesas · dia 20',twenty)+
    line('Saldo · dia 20',advance-twenty,true)+'</div>',
    click('Editar extras','extras'));
  return overview+income+'<div class="monthly">'+fixed+summary+'</div>';
}
function statement(card) {
  const entries=entryRows(card);
  const parts=Object.entries(kinds).filter(([kind])=>kind!=='review' || entries.some(([,item])=>item.kind===kind));
  const panels=parts.map(([kind,label])=>{
    const group=entries.filter(([,item])=>item.kind===kind);
    const rows=group.map(([key,item])=>'<tr><td>'+itemLabel(item)+
      '</td><td class="minor">'+text(item.date ? item.date.split('-').reverse().join('/') : '—')+'</td><td class="amount">'+
      cash(item.amount)+'</td><td class="action-cell">'+expenseActions(item,'entry:'+key)+'</td></tr>');
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
function form(title,fields,save,remove,removeLabel='Retirar',saveLabel='Salvar') {
  const deleting=saveLabel==='Excluir';
  show(title,'<form>'+fields+'<p class="form-error" role="alert" hidden></p><div class="dialog-actions">'+
    (remove?'<button type="button" id="remove" class="danger">'+text(removeLabel)+'</button>':'')+
    (deleting?'<button type="button" id="cancel-delete">Cancelar</button>':'')+
    '<button type="submit" class="'+(deleting?'delete-confirm':'primary')+'">'+text(saveLabel)+'</button></div></form>');
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
  if (deleting) $('#cancel-delete').onclick=()=>dialog.close();
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
function bindScheduleFields(node,scopeSelector,editing) {
  const {kind,scope}=node.elements;
  const update=()=>{
    toggleFields(node,'[data-installments]',kind.value==='installment');
    toggleFields(node,scopeSelector,kind.value!=='installment' && (editing || kind.value==='subscription'));
  };
  kind.onchange=()=>{
    if (scope && kind.value!=='installment') scope.value=kind.value==='subscription'?'future':'single';
    update();
  };
  if (scope) scope.onchange=()=>{
    if (scope.value==='future') kind.value='subscription';
    update();
  };
  update();
}
function fixedEditor(item) {
  const selectedMonth=month.value;
  const series=item?.series || newId();
  const save=data=>{
    const kind=data.get('kind');
    const recurring=kind!=='installment' && (item ? data.get('scope')==='future' : kind==='subscription');
    const name=String(data.get('name')).trim();
    if (!name) throw new Error('Informe o nome da conta.');
    const group=String(data.get('group')).trim();
    const value={type:'fixed',name,series,group,month:selectedMonth,day:Number(data.get('day')),
      amount:cents(data.get('amount')),recurring,removed:false,icon:choice(expenseIcons,data.get('icon'))};
    if (kind==='installment') {
      const schedule=installments(value.amount,Number(data.get('part')),Number(data.get('count')),selectedMonth,data.get('amountBasis')==='total');
      const installmentId=item?.part ? item.installmentId : newId();
      const changes=new Map((item?.part ? schedule.slice(0,1) : schedule).map(slice=>{
        const expense={...value,...slice,...(installmentId?{installmentId}:{})};
        return [fixedKey(expense),expense];
      }));
      if (item && !item.part) {
        for (const [key,[{value:previous}]] of heads) {
          if (previous?.type==='fixed' && previous.series===series && previous.month>=selectedMonth && !changes.has(key)) {
            changes.set(key,null);
          }
        }
        const stop={...value,amount:0,recurring:true,removed:true};
        changes.set(fixedKey(stop),stop);
      }
      return commit(changes);
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
    select('Tipo','kind',item?.part ? [['installment','Parcelamento']] :
      [['subscription','Despesa mensal'],['purchase','Despesa única'],['installment','Parcelamento']],
      item?.part?'installment':!item || item.recurring?'subscription':'purchase')+
    field('Valor (R$)','amount',item?inputMoney(item.amount):'','required inputmode="decimal"')+
    installmentFields(item?.part,item?.count,Boolean(item?.part))+
    field('Grupo de despesas (opcional)','group',item?.group,'maxlength="100" list="fixed-groups"')+
    '<datalist id="fixed-groups">'+[...new Set(project(heads,selectedMonth).fixed.map(item=>item.group).filter(Boolean))]
      .map(group=>'<option value="'+text(group)+'"></option>').join('')+'</datalist>'+
    select('Ícone da despesa','icon',expenseIcons,choice(expenseIcons,item?.icon))+
    select('Separar do recebimento','day',days,item?.day || 5)+
    (item && !item.part ? '<fieldset data-fixed-scope>'+select('Aplicar','scope',scopes,item.recurring?'future':'single')+'</fieldset>' : ''),
    save);
  bindScheduleFields(node,'[data-fixed-scope]',Boolean(item));
}
function cardList() {
  const {cards}=project(heads,month.value);
  show('Gerenciar cartões','<div class="setting-group">'+cards.map(card=>'<div class="summary-line"><span>'+
    text(card.name)+(card.archived?' · Arquivado':'')+'</span><div class="row-actions">'+
    click('Ver fatura','tab:'+card.id)+click('Editar','card:'+card.id)+'</div></div>').join('')+
    (cards.length?'':empty('Cadastre um cartão para lançar despesas.'))+'</div><div class="dialog-actions">'+
    click('+ Cartão','card:new','primary')+'</div>');
}
function cardEditor(card) {
  const id=card?.id || newId();
  const change=(data,archived=false)=>{
    const name=String(data.get('name')).trim();
    if (!name) throw new Error('Informe o nome do cartão.');
    return commit(new Map([[cardKey(id),{type:'card',id,name,archived,day:Number(data.get('day')),
      color:choice(cardColors,data.get('color'))}]]));
  };
  form(card?'Editar cartão':'Adicionar cartão',
    field('Nome do cartão','name',card?.name,'required maxlength="250"')+
    select('Cor do cartão','color',cardColors,choice(cardColors,card?.color))+
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

  function save(data) {
    const selectedKind=data.get('kind');
    const target=String(data.get('month'));
    const future=selectedKind!=='installment' && data.get('scope')==='future';
    const kind=future?'subscription':selectedKind;
    const value={type:'entry',name:String(data.get('name')).trim(),month:target,
      amount:cents(data.get('amount')),kind,card:String(data.get('card')),date:String(data.get('date')),
      icon:choice(expenseIcons,data.get('icon'))};
    if (!value.name || !validMonth(target) || !value.card) throw new Error('Preencha a descrição, a fatura e o cartão.');

    if (kind==='subscription' && (future || item?.series)) {
      const ruleKey='entry:sub:'+series+':'+target+(future?':rec':'');
      const changes=new Map([[ruleKey,{...value,series,recurring:future,removed:false}]]);
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
      const editingParcel=item?.kind==='installment';
      const installmentId=editingParcel ? item.installmentId : newId();
      const slices=editingParcel ? schedule.slice(0,1) : schedule;
      const changes=new Map(slices.map((slice,index)=>[
        item && !item.series && index===0 ? key : 'entry:'+newId(),
        {...value,...slice,...(installmentId?{installmentId}:{})}
      ]));
      if (item?.series) {
        const ruleKey='entry:sub:'+series+':'+target+':rec';
        for (const [previous,[{value:record}]] of heads) {
          if (record?.type==='entry' && record.series===series && record.month>=target && previous!==ruleKey) {
            changes.set(previous,null);
          }
        }
        changes.set(ruleKey,{...item,month:target,amount:0,recurring:true,removed:true});
      }
      return commit(changes);
    }
    return commit(new Map([[item?key:'entry:'+newId(),value]]));
  }

  const node=form(item?'Editar lançamento':'Novo lançamento',
    select('Cartão','card',available.map(card=>[card.id,card.name]),item?.card || active)+
    field('Descrição','name',item?.name,'required maxlength="250"')+
    select('Ícone da despesa','icon',expenseIcons,choice(expenseIcons,item?.icon))+
    field('Data da compra','date',item?.date ?? today,'type="date"')+
    field('Mês da fatura','month',item?.series ? selectedMonth : item?.month || selectedMonth,
      'type="month" required min="1900-01" max="9998-12"'+(item?.series?' readonly':''))+
    select('Tipo','kind',item?.series ? kindOptions.filter(([kind])=>kind!=='purchase') : kindOptions,item?.kind || 'purchase')+
    field('Valor (R$)','amount',item?inputMoney(item.amount):'','required inputmode="decimal"')+
    installmentFields(item?.part,item?.count,item?.kind==='installment')+
    '<fieldset data-subscription>'+select('Aplicar', 'scope',scopes,!item || item.recurring?'future':'single')+
    '<small>Uma assinatura mensal aparece automaticamente nas próximas faturas.</small></fieldset>',
    save);
  bindScheduleFields(node,'[data-subscription]',Boolean(item));
}

function matchingParcels(item,key,parcel,records) {
  const baseName=name=>normalize(name).replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/,'').replace(/\s+/g,' ').trim();
  const name=baseName(item.name);
  const related=records.filter(([,value])=>{
    if (value.type!==item.type || value.removed || value.card!==item.card) return false;
    if (item.installmentId) return value.installmentId===item.installmentId;
    if (value.installmentId) return false;
    const part=parcelInfo(value);
    if (!part || part.count!==parcel.count || value.month!==shiftMonth(item.month,part.part-parcel.part)) return false;
    if (item.type==='fixed' && item.series===value.series) return true;
    return value.day===item.day && (value.date || '')===(item.date || '') && baseName(value.name)===name;
  });
  if (!item.installmentId && new Set(related.map(([,value])=>value.month)).size!==related.length) {
    return related.filter(([candidate])=>candidate===key);
  }
  return related;
}

function expenseDelete(item,key) {
  if (!item) return;
  const selectedMonth=month.value;
  const fixed=item.type==='fixed';
  const recordKey=key || fixedKey({...item,month:selectedMonth,recurring:false});
  const snapshot=heads;
  const records=[...snapshot].map(([id,[{value}]])=>[id,value]).filter(([,value])=>value);
  const parcel=parcelInfo(item);
  const series=parcel ? matchingParcels(item,recordKey,parcel,records).filter(([id])=>id!==recordKey) : [];
  const upcoming=series.filter(([,value])=>value.month>selectedMonth);
  const earlier=series.some(([,value])=>value.month<selectedMonth);
  const recurring=!parcel && (fixed ? item.recurring || records.some(([,value])=>
    value.type==='fixed' && value.series===item.series && value.recurring && !value.removed && value.month<=selectedMonth) : Boolean(item.series));
  const choices=parcel ? [['single','Só esta parcela'],
    ...(upcoming.length ? [['future','Esta e as próximas ('+(upcoming.length+1)+')']] : []),
    ...(earlier ? [['all','Todas, inclusive anteriores ('+(series.length+1)+')']] : [])] : scopes;
  const detail=parcel ? ' · parcela '+parcel.part+' de '+parcel.count : '';
  const fields='<p><strong>'+text(item.name+detail)+'</strong> · '+cash(item.amount)+'</p>'+
    (parcel || recurring ? select('O que excluir','scope',choices,'single') : '<p>Excluir este lançamento do mês?</p>')+
    (parcel && !series.length && parcel.part<parcel.count ? '<small>Nenhuma outra parcela vinculada foi identificada.</small>' : '');

  form('Excluir despesa',fields,data=>{
    const scope=data.get('scope');
    const changes=new Map();
    const removeParcel=(id,value)=>changes.set(id,fixed ? {...value,removed:true,amount:0} : null);
    if (parcel) {
      const targets=scope==='all' ? series : scope==='future' ? upcoming : [];
      removeParcel(recordKey,{...item,month:selectedMonth,recurring:false});
      for (const [id,value] of targets) removeParcel(id,value);
    } else if (fixed || recurring) {
      const future=recurring && scope==='future';
      const stop={...item,month:selectedMonth,amount:0,recurring:future,removed:true};
      const stopKey=fixed ? fixedKey(stop) : 'entry:sub:'+item.series+':'+selectedMonth+(future?':rec':'');
      if (future) {
        for (const [id,value] of records) {
          if (value.type===item.type && value.series===item.series && value.month>=selectedMonth) changes.set(id,null);
        }
      }
      changes.set(stopKey,stop);
    } else {
      changes.set(recordKey,null);
    }
    return commit(changes,new Map([...changes.keys()].map(id=>[id,snapshot.get(id)?.map(op=>op.id) || []])));
  },undefined,undefined,'Excluir');
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
  if (kind==='tab') {if (dialog.open) dialog.close();active=arg;render();}
  if (kind==='settings') settings();
  if (kind==='fixed') fixedEditor(data.fixed[Number(arg)]);
  if (kind==='entry') entryEditor(arg);
  if (kind==='delete') {
    if (arg.startsWith('fixed:')) expenseDelete(data.fixed[Number(arg.slice(6))]);
    if (arg.startsWith('entry:')) {
      const key=arg.slice(6);
      expenseDelete(heads.get(key)?.[0].value,key);
    }
  }
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
for (const [id,symbol] of [['mobile-monthly','calendar'],['mobile-cards','wallet'],['mobile-settings','settings']]) {
  document.getElementById(id).insertAdjacentHTML('afterbegin',icon(symbol));
}
$('#settings').onclick=()=>{if (db) settings();};
$('#close-dialog').onclick=()=>dialog.close();
$('#prev').onclick=()=>chooseMonth(shiftMonth(selectedMonth,-1));
$('#next').onclick=()=>chooseMonth(shiftMonth(selectedMonth,1));
month.onchange=()=>chooseMonth(month.value);
view.addEventListener('toggle',event=>{
  const panel=event.target;
  if (!panel.classList.contains('income-panel') || !panel.isConnected) return;
  incomeOpen=panel.open;
  try {localStorage.setItem(incomePreference,String(incomeOpen));} catch {}
},true);
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

