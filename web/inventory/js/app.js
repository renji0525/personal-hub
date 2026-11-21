// 在庫画面：商品と購入記録を操作する。家計簿と同じモデル・保存領域を利用する。
// 家計簿と同じ端末データ・更新番号・再送IDで在庫も同期する
const getElementById = (id) => document.getElementById(id);
const inventoryStorageUser = () =>
    window.BudgetSpaces ? BudgetSpaces.storageUser(session.userId) : session.userId;
const inventoryApi = (action, params) =>
    window.BudgetSpaces
        ? BudgetSpaces.api(action, params, session)
        : HubAuth.api(action, params, session);
const autoPush = HubSync.autoPush(
    sync,
    () => !mode && !stale && !!local?.pending.length && isCurrentAccount()
);
let session,
    local,
    raw = null,
    mode = null,
    stale = false,
    limit = 50,
    renderedDay;
const getTodayDate = () => {
    const currentDate = new Date();
    return [
        currentDate.getFullYear(),
        String(currentDate.getMonth() + 1).padStart(2, '0'),
        String(currentDate.getDate()).padStart(2, '0'),
    ].join('-');
};
const getInventoryState = () => BudgetLocal.view(local);
const isCurrentAccount = () =>
    session &&
    HubAuth.read()?.token === session.token &&
    (!window.BudgetSpaces || BudgetSpaces.allowed());
function setStatusMessage(text, type = 'ready') {
    getElementById('status').textContent = text;
    getElementById('status').dataset.state = type;
}
// 認証・通信・他タブ更新の状態に応じて、操作可能なボタンを切り替える。
function updateControls() {
    const locked = !local || stale || !isCurrentAccount();
    for (const id of ['addProduct', 'saveProduct', 'savePurchase', 'exportButton'])
        getElementById(id).disabled = locked;
    document.querySelectorAll('.product button').forEach((button) => (button.disabled = locked));
    getElementById('syncButton').disabled = !!mode || stale || !session;
    getElementById('syncButton').setAttribute('aria-busy', String(!!mode));
    getElementById('discardButton').disabled = !!mode || stale;
    getElementById('logoutButton').disabled = !isCurrentAccount();
}
// 他タブの変更を確認してから端末へ保存し、家計簿と在庫へ更新を通知する。
function saveLocalState(value) {
    if (!isCurrentAccount()) throw new Error('トップからログインし直してください。');
    if (localStorage.getItem(BudgetLocal.key(inventoryStorageUser())) !== raw)
        throw new Error('別タブで変更されました。この画面を開き直してください。');
    raw = BudgetLocal.write(localStorage, inventoryStorageUser(), value);
    local = value;
    window.dispatchEvent(new Event('budget-local-changed'));
}
function showSyncStatus() {
    setStatusMessage(
        local.pending.length ? '端末に保存済み・未同期 ' + local.pending.length + '件' : '同期済み',
        local.pending.length ? 'pending' : 'ready'
    );
}
function createElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
function populateCategoryOptions(select, selected = '') {
    select.replaceChildren(new Option('未分類', ''));
    getInventoryState()
        .categories.filter((category) => !category.parentId)
        .forEach((category) => select.append(new Option(category.name, category.id)));
    select.value = selected;
}
// 現在の状態を画面へ反映する。保存や通信とは分けて呼び出す。
function render() {
    if (!local) return;
    const products = getInventoryState().products || [],
        now = getTodayDate();
    renderedDay = now;
    // 同じ商品の目安日計算を絞込・並べ替え・描画で共有する
    const dates = new Map(products.map((product) => [product.id, BudgetModel.due(product, now)]));
    const due = products.filter((product) => dates.get(product.id).soon);
    getElementById('reminder').textContent = due.length
        ? '補充の目安が近い商品が' + due.length + '件あります。残量を確認しましょう。'
        : products.length
          ? '今のところ、補充の目安が近い商品はありません。'
          : '商品を登録すると、補充目安をお知らせします。';
    const query = getElementById('search').value.trim().toLocaleLowerCase();
    const filter = getElementById('filter').value;
    const filtered = products
        .filter(
            (product) =>
                product.name.toLocaleLowerCase().includes(query) &&
                (filter === 'all' || dates.get(product.id).soon)
        )
        .sort(
            (firstProduct, secondProduct) =>
                dates.get(firstProduct.id).date.localeCompare(dates.get(secondProduct.id).date) ||
                firstProduct.name.localeCompare(secondProduct.name)
        );
    getElementById('count').textContent = filtered.length + '商品';
    getElementById('products').replaceChildren();
    getElementById('moreButton').hidden = filtered.length <= limit;
    if (!filtered.length)
        getElementById('products').append(
            createElement(
                'p',
                'empty',
                products.length
                    ? '条件に合う商品がありません。'
                    : '洗剤や食品など、繰り返し買う商品を登録しましょう。'
            )
        );
    filtered.slice(0, limit).forEach((product) => {
        const currentDate = dates.get(product.id),
            card = createElement('article', 'product' + (currentDate.soon ? ' due' : ''));
        card.dataset.id = product.id;
        const label =
            currentDate.remaining < 0
                ? '目安日から' + -currentDate.remaining + '日経過'
                : currentDate.remaining === 0
                  ? '今日が補充の目安'
                  : currentDate.soon
                    ? 'あと' + currentDate.remaining + '日で補充の目安'
                    : '次の目安まで' + currentDate.remaining + '日';
        card.append(
            createElement('span', 'badge', label),
            createElement('h2', '', product.name),
            createElement('strong', '', currentDate.date + ' ごろ'),
            createElement(
                'p',
                '',
                '前回購入 ' + product.purchasedAt + ' ／ ' + product.intervalDays + '日ごと'
            ),
            createElement('p', '', product.leadDays + '日前からお知らせ')
        );
        const actions = createElement('div', 'actions');
        for (const [label, handleAction, className] of [
            ['購入を記録', () => purchase(product), ''],
            ['編集', () => edit(product), 'quiet'],
            ['削除', () => remove(product), 'quiet'],
        ]) {
            const button = createElement('button', className, label);
            button.addEventListener('click', handleAction);
            actions.append(button);
        }
        card.append(actions);
        getElementById('products').append(card);
    });
    updateControls();
}
// 既存の値をフォームへ設定し、追加・編集用のダイアログを開く。
function edit(product) {
    getElementById('productForm').reset();
    getElementById('productError').textContent = '';
    getElementById('productId').value = product?.id || '';
    getElementById('productTitle').textContent = product ? '商品を編集' : '商品を登録';
    getElementById('productName').value = product?.name || '';
    getElementById('purchasedAt').value = product?.purchasedAt || getTodayDate();
    getElementById('purchasedAt').max = getTodayDate();
    getElementById('intervalDays').value = product?.intervalDays || 30;
    getElementById('leadDays').value = product?.leadDays ?? 3;
    populateCategoryOptions(getElementById('productCategory'), product?.categoryId || '');
    getElementById('productDialog').showModal();
}
function purchase(product) {
    getElementById('purchaseForm').reset();
    getElementById('purchaseForm').dataset.entryId = crypto.randomUUID();
    getElementById('purchaseError').textContent = '';
    getElementById('purchaseId').value = product.id;
    getElementById('purchaseTitle').textContent = product.name + 'の購入';
    getElementById('purchaseDate').value = getTodayDate();
    getElementById('purchaseDate').min = product.purchasedAt;
    getElementById('purchaseDate').max = getTodayDate();
    populateCategoryOptions(getElementById('purchaseCategory'), product.categoryId);
    getElementById('purchaseDialog').showModal();
}
// 入力を操作として検証し、端末への保存ができてから画面を更新する。
function mutate(operation) {
    if (!local || stale || !isCurrentAccount())
        throw new Error('同期が完了してから操作してください。');
    saveLocalState(BudgetLocal.edit(local, operation));
    autoPush.schedule();
    render();
    showSyncStatus();
}
function remove(product) {
    if (confirm('「' + product.name + '」を在庫管理から削除しますか？ 家計簿の支出は残ります。'))
        try {
            mutate({
                type: 'productDelete',
                id: product.id,
            });
        } catch (event) {
            setStatusMessage(event.message, 'error');
        }
}
// 未同期分を送信し、変更がない場合は更新番号を使って最新状態を確認する。
async function sync() {
    if (HubConflict.busy()) return;
    if (mode || stale || !isCurrentAccount()) return;
    autoPush.start();
    const syncStartedAt = Date.now();
    mode = local?.pending.length ? 'write' : 'read';
    updateControls();
    setStatusMessage('同期中…', 'syncing');
    try {
        if (local?.pending.length)
            while (local.pending.length) {
                const packet = BudgetLocal.packet(local);
                saveLocalState(packet.local);
                const result = await inventoryApi('budgetSync', packet.request);
                if (!isCurrentAccount()) return;
                saveLocalState(BudgetLocal.ack(local, result, packet.request.operations.length));
                if (autoPush.waiting()) break;
            }
        else {
            const before = local,
                result = await inventoryApi(
                    'budgetLoad',
                    Array.isArray(before?.base.products)
                        ? {
                              knownRevision: before.base.revision,
                          }
                        : {}
                );
            if (!isCurrentAccount()) return;
            if (local !== before && local?.pending.length) {
                if (result.revision !== local.base.revision) {
                    const element = new Error(
                        '別端末でも変更されています。バックアップして内容を確認してください。'
                    );
                    element.code = 'BUDGET_CONFLICT';
                    throw element;
                }
            } else if (!result.unchanged) saveLocalState(BudgetLocal.create(result));
        }
        window.HubSync?.mark(inventoryStorageUser(), 'budget', syncStartedAt);
        getElementById('discardButton').hidden = true;
        render();
        showSyncStatus();
    } catch (event) {
        window.BudgetSpaces?.handleError(event);
        setStatusMessage(
            '同期できませんでした。端末の変更は保持しています。' + event.message,
            'error'
        );
        getElementById('discardButton').hidden = event.code !== 'BUDGET_CONFLICT';
    } finally {
        mode = null;
        updateControls();
        autoPush.finish();
    }
}
getElementById('productForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
        if (!getElementById('productId').value)
            getElementById('productId').value = crypto.randomUUID();
        mutate({
            type: 'productSave',
            value: {
                id: getElementById('productId').value,
                name: getElementById('productName').value,
                purchasedAt: getElementById('purchasedAt').value,
                intervalDays: Number(getElementById('intervalDays').value),
                leadDays: Number(getElementById('leadDays').value),
                categoryId: getElementById('productCategory').value,
            },
        });
        getElementById('productDialog').close();
    } catch (e) {
        getElementById('productError').textContent = e.message;
    }
});
getElementById('purchaseForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
        const product = getInventoryState().products.find(
            (p) => p.id === getElementById('purchaseId').value
        );
        if (!product) throw new Error('商品が見つかりません。');
        const date = getElementById('purchaseDate').value,
            operation = {
                type: 'productPurchase',
                id: product.id,
                date,
            };
        if (getElementById('purchaseAmount').value !== '')
            operation.entry = {
                id: getElementById('purchaseForm').dataset.entryId,
                date,
                type: 'expense',
                categoryId: getElementById('purchaseCategory').value,
                amount: Number(getElementById('purchaseAmount').value),
                memo: product.name + '（在庫購入）',
            };
        mutate(operation);
        getElementById('purchaseDialog').close();
    } catch (e) {
        getElementById('purchaseError').textContent = e.message;
    }
});
getElementById('addProduct').addEventListener('click', () => edit());
getElementById('syncButton').addEventListener('click', sync);
for (const id of ['search', 'filter'])
    getElementById(id).addEventListener('input', () => {
        limit = 50;
        render();
    });
getElementById('moreButton').addEventListener('click', () => {
    limit += 50;
    render();
});
document
    .querySelectorAll('[data-close]')
    .forEach((button) =>
        button.addEventListener('click', () => getElementById(button.dataset.close).close())
    );
getElementById('discardButton').addEventListener('click', async () => {
    if (
        !mode &&
        confirm(
            '家計簿と在庫の未同期変更をすべて破棄します。必要なら先にバックアップしてください。続けますか？'
        )
    )
        try {
            saveLocalState(BudgetLocal.create(local.base));
            await sync();
        } catch (event) {
            setStatusMessage(event.message, 'error');
        }
});
getElementById('exportButton').addEventListener('click', () => {
    const url = URL.createObjectURL(
            new Blob(
                [
                    JSON.stringify(
                        {
                            version: 1,
                            ...getInventoryState(),
                        },
                        null,
                        2
                    ),
                ],
                {
                    type: 'application/json',
                }
            )
        ),
        downloadLink = createElement('a', '');
    downloadLink.href = url;
    downloadLink.download = 'personal-hub-inventory-' + getTodayDate() + '.json';
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
getElementById('logoutButton').addEventListener('click', async () => {
    try {
        await HubAuth.signOut(session);
    } catch (error) {
        /* 共通認証で端末のログアウトは完了している */
    }
});
window.addEventListener('storage', (event) => {
    if (session && (event.key === BudgetLocal.key(inventoryStorageUser()) || event.key === null)) {
        stale = true;
        updateControls();
        setStatusMessage('別タブで変更されました。この画面を開き直してください。', 'error');
    }
});
window.addEventListener('hub-auth-changed', () => {
    if (session && !isCurrentAccount())
        document.documentElement.setAttribute('data-auth-pending', '');
});
window.addEventListener('focus', render);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
});
setInterval(() => {
    if (!document.hidden && renderedDay !== getTodayDate()) render();
}, 60000);
(async () => {
    session = await HubAuth.ready;
    if (!session) return;
    if (window.BudgetSpaces) {
        BudgetSpaces.bind(session, 'inventory');
        BudgetSpaces.mount(session);
    }
    getElementById('currentUser').textContent = session.userId;
    document.documentElement.removeAttribute('data-auth-pending');
    if (window.BudgetSpaces && !BudgetSpaces.allowed()) {
        updateControls();
        return;
    }
    try {
        local = BudgetLocal.read(localStorage, inventoryStorageUser());
        raw = localStorage.getItem(BudgetLocal.key(inventoryStorageUser()));
        if (local) {
            render();
            showSyncStatus();
        }
    } catch (event) {
        stale = true;
        setStatusMessage(event.message, 'error');
        updateControls();
        return;
    }
    updateControls();
    if (!window.HubSync || HubSync.needed(inventoryStorageUser(), 'budget', !!local)) await sync();
    else autoPush.schedule();
})();
HubConflict.bind({
    read: () => local,
    save: saveLocalState,
    load: async () => BudgetLocal.create(await inventoryApi('budgetLoad', {})).base,
    apply: BudgetModel.apply,
    ready: () => !mode && !stale && isCurrentAccount(),
    done: async () => {
        render();
        await sync();
    },
    error: (error) => setStatusMessage(error.message, 'error'),
});
