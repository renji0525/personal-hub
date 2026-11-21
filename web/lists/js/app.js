// リスト画面：種類ごとの入力と描画を扱い、保存・再送はListsLocalへ委ねる。
// リストは端末へ保存し、各時間帯の初回と手動操作で共有先と同期する
const getElementById = (id) => document.getElementById(id);
const autoPush = HubSync.autoPush(
    sync,
    () => !listsBusy && !!listsLocal?.pending.length && sameAccount()
);
let listsSession,
    listsLocal,
    listsBusy = false,
    listsSyncMode = null,
    savedRaw = null,
    stale = false;
let lastCompletion = null,
    membersLoading = false;
let activeKind = 'todo';
const limits = {
    todo: 50,
    wish: 50,
    visit: 50,
};
const itemLabels = {
    todo: {
        open: '未完了',
        done: '完了',
        add: 'やる事を追加',
        empty: 'やる事を追加して、ひとつずつ進めましょう。',
    },
    wish: {
        open: '未購入',
        done: '購入済み',
        add: '買いたいものを追加',
        empty: '気になるものを、ここにメモしておきましょう。',
    },
    visit: {
        open: '訪問予定',
        done: '訪問済み',
        add: '行くところを追加',
        empty: '行きたい場所を追加しましょう。',
    },
};
const listTabs = [...getElementById('listTabs').querySelectorAll('[role="tab"]')];
function selectList(kind) {
    if (kind === activeKind) return;
    activeKind = kind;
    for (const tab of listTabs) {
        const selected = tab.dataset.kind === kind;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
    }
    const filter = getElementById('filter');
    filter.options[0].textContent = itemLabels[kind].open;
    filter.options[2].textContent = itemLabels[kind].done;
    render();
}
for (const tab of listTabs) tab.addEventListener('click', () => selectList(tab.dataset.kind));
getElementById('listTabs').addEventListener('keydown', (event) => {
    const index = listTabs.indexOf(event.target);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const last = listTabs.length - 1;
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + listTabs.length) % listTabs.length;
    selectList(listTabs[next].dataset.kind);
    listTabs[next].focus();
});
const scope = () => BudgetSpaces.storageUser(listsSession.userId);
const sameAccount = () =>
    listsSession &&
    HubAuth.read()?.token === listsSession.token &&
    BudgetSpaces.allowed() &&
    !stale;
const today = () => {
    const date = new Date();
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
};
function message(text, state = 'ready') {
    getElementById('status').textContent = text;
    getElementById('status').dataset.state = state;
}
function controls() {
    const locked = !listsLocal || !sameAccount();
    document
        .querySelectorAll('[data-edit], .list-item button, .list-item input')
        .forEach((node) => {
            node.disabled = locked;
        });
    getElementById('syncButton').disabled = listsBusy || !sameAccount();
    getElementById('syncButton').setAttribute('aria-busy', String(listsBusy));
    getElementById('discardButton').disabled = listsBusy || !sameAccount();
    getElementById('exportButton').disabled = !listsLocal;
    getElementById('logoutButton').disabled = !sameAccount();
    getElementById('assigneeRefresh').disabled = membersLoading || listsBusy || !sameAccount();
}
function localStatus() {
    message(
        listsLocal.pending.length
            ? '端末に保存済み・未同期 ' + listsLocal.pending.length + '件'
            : '同期済み',
        listsLocal.pending.length ? 'pending' : 'ready'
    );
}
function save(value) {
    if (!sameAccount()) throw new Error('この画面を開き直してください。');
    if (localStorage.getItem(ListsLocal.key(scope())) !== savedRaw)
        throw new Error('別タブで変更されています。この画面を開き直してください。');
    savedRaw = ListsLocal.write(localStorage, scope(), value);
    listsLocal = value;
}
function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
const productImages = new Map();
let previewQueue = Promise.resolve();
function displayProductImage(link, url) {
    const src = ListProductPreview.imageUrl(url);
    if (!src || !link.isConnected || !sameAccount()) return;
    const image = element('img', undefined, 'item-preview');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => image.remove(), {
        once: true,
    });
    image.src = src;
    link.prepend(image);
}
// 一覧に近いリンクだけ順番に取得し、再描画しても同じURLは問い合わせ直さない
const productObserver = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const link = entry.target,
                url = link.dataset.preview;
            productObserver.unobserve(link);
            previewQueue = previewQueue
                .then(async () => {
                    if (!link.isConnected || !sameAccount()) return;
                    if (!productImages.has(url)) {
                        const result = await BudgetSpaces.api(
                            'productPreview',
                            {
                                url,
                            },
                            listsSession
                        );
                        productImages.set(url, result.image);
                    }
                    displayProductImage(link, productImages.get(url));
                })
                .catch(() => {
                    /* 取得できない場合は商品リンクだけを残す */
                });
        }
    },
    {
        rootMargin: '160px',
    }
);
// 入力を操作として検証し、端末への保存ができてから画面を更新する。
function mutate(operation) {
    if (!listsLocal || !sameAccount()) throw new Error('同期が完了してから操作してください。');
    save(ListsLocal.edit(listsLocal, operation));
    autoPush.schedule();
    render();
    localStatus();
}
function completionNotice() {
    const value =
        lastCompletion &&
        ListsLocal.view(listsLocal).items.find((item) => item.id === lastCompletion.id);
    if (!value?.done) lastCompletion = null;
    getElementById('undoNotice').hidden = !lastCompletion;
    if (lastCompletion)
        getElementById('undoText').textContent =
            '「' + value.title + '」を' + itemLabels[value.kind].done + 'にしました。';
}
function setDone(value, done) {
    mutate({
        type: 'itemDone',
        id: value.id,
        done,
    });
    if (done && !value.done)
        lastCompletion = {
            id: value.id,
        };
    completionNotice();
    (
        getElementById(activeKind + 'Items').querySelector('[data-id="' + value.id + '"] input') ||
        getElementById(activeKind + 'Add')
    ).focus({
        preventScroll: true,
    });
}
function fillAssignees(current = '') {
    const select = getElementById('itemAssignee'),
        users = [...new Set([...(listsLocal.base.assignees || []), listsSession.userId])];
    select.replaceChildren(new Option('未指定', ''));
    for (const user of users)
        select.add(new Option(user === listsSession.userId ? user + '（自分）' : user, user));
    if (current && !users.includes(current))
        select.add(new Option(current + '（保存済みの担当者）', current));
    select.value = current;
}
async function refreshAssignees() {
    if (membersLoading || listsBusy || !sameAccount()) return;
    membersLoading = true;
    controls();
    getElementById('assigneeStatus').textContent = '担当者一覧を確認中…';
    try {
        const result = await BudgetSpaces.api('listsMembers', {}, listsSession);
        if (!sameAccount() || listsSyncMode === 'write') return;
        save(ListsLocal.withAssignees(listsLocal, result.assignees));
        fillAssignees(getElementById('itemAssignee').value);
        getElementById('assigneeStatus').textContent = '参加中のユーザーを表示しています。';
    } catch (error) {
        BudgetSpaces.handleError(error);
        getElementById('assigneeStatus').textContent =
            '担当者一覧を更新できませんでした。保存済みの候補を使用します。' + error.message;
    } finally {
        membersLoading = false;
        controls();
    }
}
// 現在の状態を画面へ反映する。保存や通信とは分けて呼び出す。
function render() {
    if (!listsLocal) return;
    productObserver.disconnect();
    renderItems(activeKind);
    completionNotice();
    controls();
}
function renderItems(kind) {
    const items = ListsLocal.view(listsLocal).items,
        query = getElementById('search').value.trim().toLocaleLowerCase(),
        filter = getElementById('filter').value;
    const labels = itemLabels[kind];
    const all = items.filter((value) => value.kind === kind),
        visible = all
            .filter(
                (value) =>
                    (filter === 'all' || value.done === (filter === 'done')) &&
                    (value.title + ' ' + value.note).toLocaleLowerCase().includes(query)
            )
            .sort(
                (a, b) =>
                    Number(a.done) - Number(b.done) ||
                    (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
            );
    getElementById(kind + 'Count').textContent =
        labels.open + ' ' + all.filter((value) => !value.done).length + ' / 全' + all.length + '件';
    const container = getElementById(kind + 'Items');
    container.replaceChildren();
    for (const value of visible.slice(0, limits[kind])) {
        const card = element('article', undefined, 'list-item' + (value.done ? ' is-done' : ''));
        card.dataset.id = value.id;
        const heading = element('div', undefined, 'item-heading'),
            check = element('input');
        check.type = 'checkbox';
        check.checked = value.done;
        check.setAttribute(
            'aria-label',
            value.title + 'を' + (value.done ? labels.open + 'に戻す' : labels.done + 'にする')
        );
        check.addEventListener('change', () => {
            try {
                setDone(value, check.checked);
            } catch (error) {
                render();
                message(error.message, 'error');
            }
        });
        heading.append(check, element('h3', value.title));
        card.append(heading);
        if (kind !== 'visit')
            card.append(element('p', '担当：' + (value.assignee || '未指定'), 'item-assignee'));
        if (value.dueDate)
            card.append(
                element(
                    'p',
                    '期限 ' +
                        value.dueDate +
                        (!value.done && value.dueDate < today() ? '・期限を過ぎています' : ''),
                    !value.done && value.dueDate < today() ? 'overdue' : 'muted'
                )
            );
        if (value.note) card.append(element('p', value.note, 'item-note'));
        let productLink;
        if (kind === 'wish' && value.url) {
            productLink = element('a', '商品リンクを開く ↗', 'item-link');
            productLink.href = value.url;
            productLink.target = '_blank';
            productLink.rel = 'noopener noreferrer';
            card.append(productLink);
        }
        if (kind === 'visit' && value.url) {
            const mapLink = element('a', 'Googleマップを開く ↗', 'item-link');
            mapLink.href = value.url;
            mapLink.target = '_blank';
            mapLink.rel = 'noopener noreferrer';
            card.append(mapLink);
        }
        const actions = element('div', undefined, 'actions');
        if (value.done) {
            const restore = element('button', labels.open + 'に戻す', 'quiet');
            restore.type = 'button';
            restore.addEventListener('click', () => {
                try {
                    setDone(value, false);
                } catch (error) {
                    message(error.message, 'error');
                }
            });
            actions.append(restore);
        }
        for (const [label, action] of [
            ['編集', () => edit(value.kind, value)],
            [
                '削除',
                () => {
                    if (confirm('「' + value.title + '」を削除しますか？'))
                        mutate({
                            type: 'itemDelete',
                            id: value.id,
                        });
                },
            ],
        ]) {
            const button = element('button', label, 'quiet');
            button.type = 'button';
            button.addEventListener('click', () => {
                try {
                    action();
                } catch (error) {
                    message(error.message, 'error');
                }
            });
            actions.append(button);
        }
        card.append(actions);
        container.append(card);
        if (productLink) {
            const image = ListProductPreview.imageUrl(value.url);
            const page = ListProductPreview.pageUrl(value.url);
            if (image && /\.(?:jpe?g|png|webp|gif|avif)(?:\?|$)/i.test(image))
                displayProductImage(productLink, image);
            else if (page && productImages.has(page))
                displayProductImage(productLink, productImages.get(page));
            else if (page) {
                productLink.dataset.preview = page;
                productObserver.observe(productLink);
            }
        }
    }
    if (!visible.length) {
        const filtered = query || (filter !== 'all' && (kind !== 'visit' || all.length > 0));
        container.append(
            element('p', filtered ? '条件に合う項目はありません。' : labels.empty, 'empty')
        );
    }
    getElementById(kind + 'More').hidden = visible.length <= limits[kind];
    getElementById(kind + 'Shown').textContent = visible.length
        ? Math.min(visible.length, limits[kind]) + ' / ' + visible.length + '件を表示'
        : '';
}
function kindFields() {
    const kind = getElementById('itemKind').value;
    const todo = kind === 'todo',
        visit = kind === 'visit';
    getElementById('dueField').hidden = !todo;
    getElementById('urlField').hidden = todo;
    getElementById('itemDue').disabled = !todo;
    getElementById('itemUrl').disabled = todo;
    getElementById('itemAssigneeFields').hidden = visit;
    getElementById('itemTitleLabel').textContent = visit ? '行くところの名前（必須）' : 'タイトル';
    getElementById('itemUrlLabel').textContent = visit
        ? 'GoogleマップのURL（任意）'
        : '商品リンク（任意）';
    getElementById('itemUrl').maxLength = visit ? 2048 : 1000;
    getElementById('itemDoneLabel').textContent = itemLabels[kind].done;
    const title = getElementById('itemTitle'),
        suggestions = getElementById('wishTitleSuggestions');
    if (kind !== 'wish') {
        title.removeAttribute('list');
        suggestions.replaceChildren();
    } else {
        const titles = new Set(
            ListsLocal.view(listsLocal)
                .items.filter((item) => item.kind === 'wish')
                .map((item) => item.title)
        );
        suggestions.replaceChildren(...[...titles].map((value) => new Option(value, value)));
        title.setAttribute('list', suggestions.id);
    }
}
// 既存の値をフォームへ設定し、追加・編集用のダイアログを開く。
function edit(kind, value) {
    getElementById('itemForm').reset();
    getElementById('itemError').textContent = '';
    getElementById('itemId').value = value?.id || crypto.randomUUID();
    getElementById('itemKind').value = kind;
    getElementById('itemTitle').value = value?.title || '';
    getElementById('itemNote').value = value?.note || '';
    getElementById('itemDue').value = value?.dueDate || '';
    getElementById('itemUrl').value = value?.url || '';
    getElementById('itemDone').checked = value?.done || false;
    fillAssignees(value?.assignee || '');
    getElementById('assigneeStatus').textContent = '共有スペースに参加中のユーザーから選べます。';
    getElementById('itemDialogTitle').textContent = value ? '項目を編集' : itemLabels[kind].add;
    kindFields();
    getElementById('itemDialog').showModal();
    getElementById('itemTitle').focus();
    if (kind !== 'visit' && !Array.isArray(listsLocal.base.assignees)) refreshAssignees();
}
// 未同期分を送信し、変更がない場合は更新番号を使って最新状態を確認する。
async function sync() {
    if (HubConflict.busy()) return;
    if (listsBusy || !sameAccount()) return;
    autoPush.start();
    const startedAt = Date.now();
    listsSyncMode = listsLocal?.pending.length ? 'write' : 'read';
    listsBusy = true;
    controls();
    message('同期中…', 'syncing');
    try {
        if (listsLocal?.pending.length) {
            while (listsLocal.pending.length) {
                const packet = ListsLocal.packet(listsLocal);
                save(packet.local);
                const result = await BudgetSpaces.api('listsSync', packet.request, listsSession);
                if (!sameAccount()) return;
                save(ListsLocal.ack(listsLocal, result, packet.request.operations.length));
                if (autoPush.waiting()) break;
            }
        } else {
            const before = listsLocal,
                result = await BudgetSpaces.api(
                    'listsLoad',
                    before
                        ? {
                              knownRevision: before.base.revision,
                          }
                        : {},
                    listsSession
                );
            if (!sameAccount()) return;
            if (listsLocal !== before && listsLocal?.pending.length) {
                if (result.revision !== listsLocal.base.revision) {
                    const error = new Error(
                        '取得中に別の人が更新しました。端末の編集は保持しています。'
                    );
                    error.code = 'LISTS_CONFLICT';
                    throw error;
                }
            } else if (!result.unchanged) save(ListsLocal.create(result));
            if (Array.isArray(result.assignees))
                save(ListsLocal.withAssignees(listsLocal, result.assignees));
        }
        HubSync.mark(scope(), 'lists', startedAt);
        getElementById('discardButton').hidden = true;
        render();
        localStatus();
    } catch (error) {
        BudgetSpaces.handleError(error);
        message('同期できませんでした。端末の変更は保持しています。' + error.message, 'error');
        getElementById('discardButton').hidden = error.code !== 'LISTS_CONFLICT';
    } finally {
        listsBusy = false;
        listsSyncMode = null;
        controls();
        autoPush.finish();
    }
}
getElementById('itemKind').addEventListener('change', kindFields);
getElementById('itemForm').addEventListener('submit', (event) => {
    event.preventDefault();
    try {
        const items = ListsLocal.view(listsLocal).items;
        const value = ListsModel.item({
            id: getElementById('itemId').value,
            kind: getElementById('itemKind').value,
            title: getElementById('itemTitle').value,
            note: getElementById('itemNote').value,
            done: getElementById('itemDone').checked,
            dueDate: getElementById('itemDue').value,
            url: getElementById('itemUrl').value.trim(),
            assignee: getElementById('itemAssignee').value,
        });
        const previous = items.find((item) => item.id === value.id);
        const matches =
            !previous && value.kind === 'wish'
                ? items.filter(
                      (item) =>
                          item.kind === 'wish' &&
                          item.title === value.title &&
                          item.url === value.url &&
                          item.note === value.note
                  )
                : [];
        const existing = matches.find((item) => !item.done) || matches.at(-1);
        if (existing) {
            if (existing.done) {
                mutate({
                    type: 'itemDone',
                    id: existing.id,
                    done: false,
                });
                if (getElementById('filter').value === 'done') {
                    getElementById('filter').value = 'open';
                    render();
                }
                message(
                    '「' + existing.title + '」を未購入に戻しました。同期待ちです。',
                    'pending'
                );
            } else {
                message(
                    '「' + existing.title + '」は未購入リストに登録済みです。',
                    listsLocal.pending.length ? 'pending' : 'ready'
                );
            }
        } else {
            mutate({
                type: 'itemSave',
                value,
            });
            if (value.done && !previous?.done) {
                lastCompletion = {
                    id: value.id,
                };
                completionNotice();
            }
        }
        selectList(value.kind);
        getElementById('itemDialog').close();
        getElementById(value.kind + 'Add').focus({
            preventScroll: true,
        });
    } catch (error) {
        getElementById('itemError').textContent = error.message;
    }
});
getElementById('itemCancel').addEventListener('click', () => getElementById('itemDialog').close());
for (const kind of Object.keys(itemLabels)) {
    getElementById(kind + 'Add').addEventListener('click', () => edit(kind));
    getElementById(kind + 'More').addEventListener('click', () => {
        limits[kind] += 50;
        render();
    });
}
for (const id of ['search', 'filter'])
    getElementById(id).addEventListener(id === 'search' ? 'input' : 'change', () => {
        for (const kind of Object.keys(itemLabels)) limits[kind] = 50;
        render();
    });
getElementById('syncButton').addEventListener('click', sync);
getElementById('assigneeRefresh').addEventListener('click', refreshAssignees);
getElementById('undoButton').addEventListener('click', () => {
    const value =
        lastCompletion &&
        ListsLocal.view(listsLocal).items.find((item) => item.id === lastCompletion.id);
    if (value?.done) {
        try {
            setDone(value, false);
        } catch (error) {
            message(error.message, 'error');
        }
    }
});
getElementById('reloadButton').addEventListener('click', () => location.reload());
getElementById('discardButton').addEventListener('click', async () => {
    if (
        !listsBusy &&
        confirm(
            'このリストの未同期変更を破棄して再取得します。必要なら先にバックアップしてください。続けますか？'
        )
    ) {
        try {
            save(ListsLocal.create(listsLocal.base));
            await sync();
        } catch (error) {
            message(error.message, 'error');
        }
    }
});
getElementById('exportButton').addEventListener('click', () => {
    if (!listsLocal) return;
    const url = URL.createObjectURL(
        new Blob(
            [
                JSON.stringify(
                    {
                        version: 1,
                        exportedAt: new Date().toISOString(),
                        items: ListsLocal.view(listsLocal).items,
                    },
                    null,
                    2
                ),
            ],
            {
                type: 'application/json',
            }
        )
    );
    const link = element('a');
    link.href = url;
    link.download = 'personal-hub-lists-' + today() + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
getElementById('logoutButton').addEventListener('click', async () => {
    try {
        await HubAuth.signOut(listsSession);
    } catch (error) {
        /* 共通認証が端末側を解除する */
    }
});
window.addEventListener('storage', (event) => {
    if (listsSession && (event.key === ListsLocal.key(scope()) || event.key === null)) {
        stale = true;
        controls();
        getElementById('reloadButton').hidden = false;
        message('別タブで変更されました。この画面を開き直してください。', 'error');
    }
});
window.addEventListener('hub-auth-changed', (event) => {
    if (listsSession && event.detail?.token !== listsSession.token)
        document.documentElement.setAttribute('data-auth-pending', '');
});
window.addEventListener('focus', render);
(async () => {
    listsSession = await HubAuth.ready;
    if (!listsSession) return;
    BudgetSpaces.bind(listsSession, 'lists');
    BudgetSpaces.mount(listsSession);
    document.documentElement.removeAttribute('data-auth-pending');
    if (!BudgetSpaces.allowed()) {
        controls();
        return;
    }
    try {
        listsLocal = ListsLocal.read(localStorage, scope());
        savedRaw = localStorage.getItem(ListsLocal.key(scope()));
        if (listsLocal) {
            render();
            localStatus();
        }
    } catch (error) {
        stale = true;
        message(error.message, 'error');
        controls();
        return;
    }
    controls();
    if (HubSync.needed(scope(), 'lists', !!listsLocal)) await sync();
    else autoPush.schedule();
})();
HubConflict.bind({
    read: () => listsLocal,
    save,
    load: async () => ListsLocal.create(await BudgetSpaces.api('listsLoad', {}, listsSession)).base,
    apply: ListsModel.apply,
    ready: () => !listsBusy && sameAccount(),
    done: async () => {
        render();
        await sync();
    },
    error: (error) => message(error.message, 'error'),
});
