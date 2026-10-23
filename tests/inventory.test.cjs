const test=require('node:test'),assert=require('node:assert/strict');
global.BudgetModel=require('../web/budget/js/model.js');const M=BudgetModel,L=require('../web/budget/js/store.js');
const product={id:'product_test1',name:'洗剤',purchasedAt:'2026-10-01',intervalDays:30,leadDays:3,categoryId:'cat_daily'};
const initial=()=>({revision:0,categories:M.defaults,entries:[]});
test('補充日・事前通知・期限超過を暦日で計算し月末とうるう年にも対応する',()=>{
 assert.deepEqual(M.due(product,'2026-10-28'),{date:'2026-10-31',remaining:3,soon:true});
 assert.equal(M.due(product,'2026-10-27').soon,false);assert.equal(M.due(product,'2026-11-01').remaining,-1);
 assert.equal(M.due({...product,purchasedAt:'2024-02-28',intervalDays:2},'2024-02-29').date,'2024-03-01');
 assert.equal(M.due({...product,leadDays:0},'2026-10-30').soon,false);
});
test('商品入力の不正日付・日数・カテゴリを拒否する',()=>{
 for(const change of [{name:''},{purchasedAt:'2026-02-30'},{intervalDays:0},{intervalDays:1.5},{leadDays:31},{leadDays:-1},{categoryId:'missing'}])assert.throws(()=>M.product({...product,...change},M.defaults));
});
test('購入日更新と支出を一操作で保存し、不正金額なら両方変更しない',()=>{
 const state=M.apply(initial(),{type:'productSave',value:product});
 const op={type:'productPurchase',id:product.id,date:'2026-10-22',entry:{id:'entry_purchase1',date:'2026-10-22',type:'expense',amount:500,categoryId:'cat_daily',memo:'洗剤'}};
 const next=M.apply(state,op);assert.equal(next.products[0].purchasedAt,op.date);assert.equal(next.entries[0].amount,500);assert.equal(state.products[0].purchasedAt,product.purchasedAt);
 assert.throws(()=>M.apply(state,{...op,entry:{...op.entry,amount:-1}}));assert.equal(state.entries.length,0);
 assert.throws(()=>M.apply(next,op));assert.throws(()=>M.apply(next,{...op,date:'2026-09-01',entry:undefined}));
 assert.equal(M.apply(state,{...op,entry:undefined}).entries.length,0);
});
test('商品削除は支出を残し、商品使用中カテゴリの削除は拒否する',()=>{
 const state=M.apply(initial(),{type:'productSave',value:product});assert.throws(()=>M.apply(state,{type:'categoryDelete',id:'cat_daily'}));
 assert.equal(M.apply(state,{type:'productDelete',id:product.id}).products.length,0);
});
test('旧家計簿を移行し、未同期在庫を再読込・再送・家計簿編集で保持する',()=>{
 let local=L.edit(L.create(initial()),{type:'productSave',value:product});local=L.packet(local).local;
 const restored=JSON.parse(JSON.stringify(local));assert.equal(L.view(restored).products[0].name,'洗剤');
 const changed=L.edit(restored,{type:'entrySave',value:{id:'entry_test1',date:'2026-10-22',type:'expense',amount:100,categoryId:'',memo:''}});
 assert.deepEqual(L.packet(changed).request,L.packet(local).request);assert.equal(L.view(changed).products.length,1);
});
