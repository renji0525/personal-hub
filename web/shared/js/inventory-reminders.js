// 保存済みデータから補充目安を表示し、お知らせのための通信は行わない
(() => {
    const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };
    let cachedKey, cachedRaw, cachedDate, cachedMessage = '', cachedProducts = [];
    function render() {
        const box = document.getElementById('inventoryReminder');
        if (!box) return;
        const session = HubAuth.read();
        if (!session || window.BudgetSpaces?.selected(session.userId, 'inventory')?.denied) { box.hidden = true; return; }
        try {
            const storageUser = window.BudgetSpaces ? BudgetSpaces.storageUser(session.userId, 'inventory') : session.userId;
            const key = BudgetLocal.key(storageUser), raw = localStorage.getItem(key);
            const changed = key !== cachedKey || raw !== cachedRaw;
            if (changed) {
                cachedDate = undefined;
                const local = BudgetLocal.read(localStorage, storageUser);
                cachedProducts = local ? BudgetLocal.view(local).products || [] : [];
                cachedKey = key; cachedRaw = raw;
            }
            const date = today();
            // 同じ保存内容・日付ならフォーカスや定期確認で全商品を再計算しない
            if (changed || date !== cachedDate) {
                const due = cachedProducts.filter(p => BudgetModel.due(p,date).soon);
                cachedMessage = due.length ? '補充の目安が近い商品が' + due.length + '件あります：' + due.slice(0,3).map(p=>p.name).join('、') + (due.length>3 ? ' ほか' : '') + '。在庫を確認 →' : '';
                cachedDate = date;
            }
            if (box.textContent !== cachedMessage) box.textContent = cachedMessage;
            if (box.hidden !== !cachedMessage) box.hidden = !cachedMessage;
        } catch (error) { box.hidden = true; /* 壊れた保存データは在庫ページで案内し、ここでは上書きしない */ }
    }
    for (const event of ['pageshow','focus','storage','hub-auth-changed','budget-local-changed']) window.addEventListener(event,render);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)render();});
    setInterval(()=>{if(!document.hidden)render();},60000);
    render();
})();
