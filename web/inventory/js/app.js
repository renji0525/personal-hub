// 家計簿と同じ端末データ・更新番号・再送IDで在庫も同期する
const $ = id => document.getElementById(id);
let session, local, raw = null, mode = null, stale = false, limit = 50, renderedDay;
const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const state = () => BudgetLocal.view(local);
const sameAccount = () => session && HubAuth.read()?.token === session.token;
function message(text, type='ready') { $('status').textContent=text; $('status').dataset.state=type; }
function controls() {
    const locked=!local || mode==='write' || stale;
    for (const id of ['addProduct','saveProduct','savePurchase','exportButton']) $(id).disabled=locked;
    document.querySelectorAll('.product button').forEach(b=>b.disabled=locked);
    $('syncButton').disabled=!!mode || stale || !session;
    $('syncButton').setAttribute('aria-busy',String(!!mode));
    $('discardButton').disabled=!!mode || stale;
    $('logoutButton').disabled=mode==='write';
}
function write(value) {
    if (!sameAccount()) throw new Error('トップからログインし直してください。');
    if (localStorage.getItem(BudgetLocal.key(session.userId))!==raw) throw new Error('別タブで変更されました。この画面を開き直してください。');
    raw=BudgetLocal.write(localStorage,session.userId,value);local=value;
    window.dispatchEvent(new Event('budget-local-changed'));
}
function localStatus() { message(local.pending.length ? '端末に保存済み・未同期 '+local.pending.length+'件' : '同期済み',local.pending.length?'pending':'ready'); }
function element(tag,cls,text) { const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e; }
function categories(select,selected='') {
    select.replaceChildren(new Option('未分類',''));
    state().categories.forEach(c=>select.append(new Option(c.name,c.id)));select.value=selected;
}
function render() {
    if (!local) return;
    const products=state().products || [], now=today(); renderedDay=now;
    const due=products.filter(p=>BudgetModel.due(p,now).soon);
    $('reminder').textContent=due.length ? '補充の目安が近い商品が'+due.length+'件あります。残量を確認しましょう。' : products.length ? '今のところ、補充の目安が近い商品はありません。' : '商品を登録すると、補充目安をお知らせします。';
    const query=$('search').value.trim().toLocaleLowerCase();
    const filtered=products.filter(p=>p.name.toLocaleLowerCase().includes(query)&&($('filter').value==='all'||BudgetModel.due(p,now).soon)).sort((a,b)=>BudgetModel.due(a,now).date.localeCompare(BudgetModel.due(b,now).date)||a.name.localeCompare(b.name));
    $('count').textContent=filtered.length+'商品';$('products').replaceChildren();$('moreButton').hidden=filtered.length<=limit;
    if(!filtered.length)$('products').append(element('p','empty',products.length?'条件に合う商品がありません。':'洗剤や食品など、繰り返し買う商品を登録しましょう。'));
    filtered.slice(0,limit).forEach(p=>{
        const d=BudgetModel.due(p,now),card=element('article','product'+(d.soon?' due':''));card.dataset.id=p.id;
        const label=d.remaining<0 ? '目安日から'+(-d.remaining)+'日経過' : d.remaining===0?'今日が補充の目安':d.soon?'あと'+d.remaining+'日で補充の目安':'次の目安まで'+d.remaining+'日';
        card.append(element('span','badge',label),element('h2','',p.name),element('strong','',d.date+' ごろ'),element('p','','前回購入 '+p.purchasedAt+' ／ '+p.intervalDays+'日ごと'),element('p','',p.leadDays+'日前からお知らせ'));
        const actions=element('div','actions');
        for(const [label,fn,cls] of [['購入を記録',()=>purchase(p),''],['編集',()=>edit(p),'quiet'],['削除',()=>remove(p),'quiet']]) {const b=element('button',cls,label);b.addEventListener('click',fn);actions.append(b);}
        card.append(actions);$('products').append(card);
    });controls();
}
function edit(p) {
    $('productForm').reset();$('productError').textContent='';$('productId').value=p?.id||'';
    $('productTitle').textContent=p?'商品を編集':'商品を登録';$('productName').value=p?.name||'';$('purchasedAt').value=p?.purchasedAt||today();
    $('purchasedAt').max=today();$('intervalDays').value=p?.intervalDays||30;$('leadDays').value=p?.leadDays??3;
    categories($('productCategory'),p?.categoryId||'');$('productDialog').showModal();
}
function purchase(p) {
    $('purchaseForm').reset();$('purchaseForm').dataset.entryId=crypto.randomUUID();$('purchaseError').textContent='';
    $('purchaseId').value=p.id;$('purchaseTitle').textContent=p.name+'の購入';$('purchaseDate').value=today();$('purchaseDate').min=p.purchasedAt;$('purchaseDate').max=today();categories($('purchaseCategory'),p.categoryId);$('purchaseDialog').showModal();
}
function mutate(operation) {
    if(!local||mode==='write'||stale)throw new Error('同期が完了してから操作してください。');
    write(BudgetLocal.edit(local,operation));render();localStatus();
}
function remove(p) { if(confirm('「'+p.name+'」を在庫管理から削除しますか？ 家計簿の支出は残ります。'))try{mutate({type:'productDelete',id:p.id});}catch(e){message(e.message,'error');} }
async function sync() {
    if(mode||stale||!sameAccount())return;
    mode=local?.pending.length?'write':'read';controls();message('同期中…','syncing');
    try {
        if(local?.pending.length)while(local.pending.length){
            const packet=BudgetLocal.packet(local);write(packet.local);
            const result=await HubAuth.api('budgetSync',packet.request,session);
            if(!sameAccount())return;write(BudgetLocal.ack(local,result,packet.request.operations.length));
        } else {
            const before=local,result=await HubAuth.api('budgetLoad',Array.isArray(before?.base.products)?{knownRevision:before.base.revision}:{},session);
            if(!sameAccount())return;
            if(local!==before&&local?.pending.length) {
                if(result.revision!==local.base.revision){const e=new Error('別端末でも変更されています。バックアップして内容を確認してください。');e.code='BUDGET_CONFLICT';throw e;}
            } else if(!result.unchanged)write(BudgetLocal.create(result));
        }
        $('discardButton').hidden=true;render();localStatus();
    } catch(e){message('同期できませんでした。端末の変更は保持しています。'+e.message,'error');$('discardButton').hidden=e.code!=='BUDGET_CONFLICT';}
    finally{mode=null;controls();}
}
$('productForm').addEventListener('submit',e=>{
    e.preventDefault();try{
        if(!$('productId').value)$('productId').value=crypto.randomUUID();
        mutate({type:'productSave',value:{id:$('productId').value,name:$('productName').value,purchasedAt:$('purchasedAt').value,intervalDays:Number($('intervalDays').value),leadDays:Number($('leadDays').value),categoryId:$('productCategory').value}});$('productDialog').close();
    }catch(e){$('productError').textContent=e.message;}
});
$('purchaseForm').addEventListener('submit',e=>{
    e.preventDefault();try{
        const p=state().products.find(p=>p.id===$('purchaseId').value);if(!p)throw new Error('商品が見つかりません。');
        const date=$('purchaseDate').value,op={type:'productPurchase',id:p.id,date};
        if($('purchaseAmount').value!=='')op.entry={id:$('purchaseForm').dataset.entryId,date,type:'expense',categoryId:$('purchaseCategory').value,amount:Number($('purchaseAmount').value),memo:p.name+'（在庫購入）'};
        mutate(op);$('purchaseDialog').close();
    }catch(e){$('purchaseError').textContent=e.message;}
});
$('addProduct').addEventListener('click',()=>edit());$('syncButton').addEventListener('click',sync);
for(const id of ['search','filter'])$(id).addEventListener('input',()=>{limit=50;render();});
$('moreButton').addEventListener('click',()=>{limit+=50;render();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('discardButton').addEventListener('click',async()=>{if(!mode&&confirm('家計簿と在庫の未同期変更をすべて破棄します。必要なら先にバックアップしてください。続けますか？'))try{write(BudgetLocal.create(local.base));await sync();}catch(e){message(e.message,'error');}});
$('exportButton').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,...state()},null,2)],{type:'application/json'})),a=element('a','');
    a.href=url;a.download='personal-hub-inventory-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('logoutButton').addEventListener('click',async()=>{
    try { await HubAuth.signOut(session); }
    catch (error) { /* 共通認証で端末のログアウトは完了している */ }
});
window.addEventListener('storage',e=>{if(session&&(e.key===BudgetLocal.key(session.userId)||e.key===null)){stale=true;controls();message('別タブで変更されました。この画面を開き直してください。','error');}});
window.addEventListener('hub-auth-changed',()=>{if(session&&!sameAccount())document.documentElement.setAttribute('data-auth-pending','');});
window.addEventListener('focus',render);document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});setInterval(()=>{if(!document.hidden&&renderedDay!==today())render();},60000);
(async()=>{
    session=await HubAuth.ready;if(!session)return;$('currentUser').textContent=session.userId;
    document.documentElement.removeAttribute('data-auth-pending');
    try{local=BudgetLocal.read(localStorage,session.userId);raw=localStorage.getItem(BudgetLocal.key(session.userId));if(local){render();localStatus();}}
    catch(e){stale=true;message(e.message,'error');controls();return;}
    controls();await sync();
})();
