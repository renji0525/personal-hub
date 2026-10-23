// 保存済みデータから補充目安を表示し、お知らせのための通信は行わない
(() => {
    const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
    let cachedKey, cachedRaw, cachedProducts = [];
    function render() {
        const box = document.getElementById('inventoryReminder');
        if (!box) return;
        box.hidden = true;
        const session = HubAuth.read();
        if (!session) return;
        try {
            const key = BudgetLocal.key(session.userId), raw = localStorage.getItem(key);
            if (key !== cachedKey || raw !== cachedRaw) {
                const local = BudgetLocal.read(localStorage, session.userId);
                cachedProducts = local ? BudgetLocal.view(local).products || [] : [];
                cachedKey = key; cachedRaw = raw;
            }
            const products = cachedProducts;
            const due = products.filter(p => BudgetModel.due(p,today()).soon);
            if (!due.length) return;
            box.textContent = '補充の目安が近い商品が' + due.length + '件あります：' + due.slice(0,3).map(p=>p.name).join('、') + (due.length>3 ? ' ほか' : '') + '。在庫を確認 →';
            box.hidden = false;
        } catch (error) { /* 壊れた保存データは在庫ページで案内し、ここでは上書きしない */ }
    }
    for (const event of ['pageshow','focus','storage','hub-auth-changed','budget-local-changed']) window.addEventListener(event,render);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
    setInterval(()=>{if(!document.hidden)render();},60000);
    render();
})();
