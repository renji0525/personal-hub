// 共有先はページ表示時に固定し、通信・端末保存・同期履歴へ同じ識別情報を使う
window.BudgetSpaces = (() => {
    let boundUser, boundSpace = null, denied = false, busy = false, createId = null;
    const selectionKey = userId => 'personal_hub_budget_space:' + userId;
    function selected(userId) {
        try {
            const value = JSON.parse(localStorage.getItem(selectionKey(userId)) || 'null');
            return value && typeof value.id === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value.id) && typeof value.name === 'string' ? value : null;
        } catch (error) { return null; }
    }
    function bind(session) { boundUser = session.userId; boundSpace = selected(boundUser); denied = boundSpace?.denied === true; }
    function storageUser(userId) {
        const space = boundUser === userId ? boundSpace : selected(userId);
        return userId + (space ? ':space:' + space.id : '');
    }
    function sameSession(session) { return HubAuth.read()?.token === session.token; }
    async function api(action, params, session) {
        const spaceId = boundUser === session.userId ? boundSpace?.id : undefined;
        return HubAuth.api(action, { ...params, ...(spaceId ? { spaceId } : {}) }, session);
    }
    function allowed() { return !denied; }
    function handleError(error) {
        if (error.code !== 'SPACE_FORBIDDEN' || !boundSpace) return;
        denied = true;
        // 一度解除を検出した共有先は、再参加を確認して選び直すまでキャッシュを表示しない
        try {
            if (selected(boundUser)?.id === boundSpace.id) localStorage.setItem(selectionKey(boundUser), JSON.stringify({ ...boundSpace, denied: true }));
        } catch (storageError) { /* 保存できなくてもこのページでは表示を閉じる */ }
        const bar = document.getElementById('budgetSpaceBar');
        if (!bar) return;
        for (const child of document.getElementById('main').children) if (child !== bar) child.hidden = true;
        document.getElementById('budgetSpaceNotice').textContent = error.message + ' 未同期内容は端末に保持しています。';
    }
    function pageBusy() {
        return (typeof budgetBusy !== 'undefined' && budgetBusy) || (typeof mode !== 'undefined' && !!mode) || (typeof listsBusy !== 'undefined' && listsBusy);
    }
    function choose(session, space) {
        if (!sameSession(session)) throw new Error('ログインし直してください。');
        if (pageBusy()) throw new Error('同期が終わってから切り替えてください。');
        if (space) localStorage.setItem(selectionKey(session.userId), JSON.stringify({ id: space.id, name: space.name }));
        else localStorage.removeItem(selectionKey(session.userId));
        location.reload();
    }
    function el(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
    async function mount(session) {
        const bar = document.getElementById('budgetSpaceBar');
        if (!bar) return;
        document.getElementById('budgetSpaceName').textContent = boundSpace ? '共有：' + boundSpace.name : '個人用';
        const dialog = document.getElementById('budgetSpaceDialog'), list = document.getElementById('budgetSpaceList');
        const notice = document.getElementById('budgetSpaceMessage');
        async function run(action, params = {}) {
            if (busy) return;
            if (!sameSession(session)) { notice.textContent = 'ログインし直してください。'; return; }
            busy = true; notice.textContent = '確認中…';
            dialog.querySelectorAll('button').forEach(button => button.disabled = true);
            try {
                const result = await HubAuth.api(action, params, session);
                if (!sameSession(session)) return;
                render(result.spaces); notice.textContent = '';
                if (action === 'budgetSpaceCreate') { createId = null; document.getElementById('budgetSpaceCreate').reset(); }
                if (boundSpace && !result.spaces.some(space => space.id === boundSpace.id && space.status === 'active')) handleError({ code: 'SPACE_FORBIDDEN', message: '現在の共有スペースに参加していません。' });
                return result;
            } catch (error) { notice.textContent = error.message; }
            finally { busy = false; dialog.querySelectorAll('button').forEach(button => button.disabled = false); }
        }
        function button(parent, label, action) {
            const node = el('button', label); node.type = 'button';
            node.addEventListener('click', () => { try { action(); } catch (error) { notice.textContent = error.message; } });
            parent.append(node); return node;
        }
        function render(spaces) {
            list.replaceChildren();
            button(list, '個人用を使う', () => choose(session, null));
            if (!spaces.length) list.append(el('p', '共有スペースや招待はまだありません。'));
            for (const space of spaces) {
                const section = el('section'); section.className = 'budget-space-card';
                section.append(el('h3', space.name), el('p', '所有者：' + space.ownerId + (space.status === 'invited' ? ' ／ 招待されています' : '')));
                if (space.status === 'active') button(section, boundSpace?.id === space.id ? 'このスペースを再表示' : 'このスペースを使う', () => choose(session, space));
                else button(section, '参加する', () => run('budgetSpaceAccept', { spaceId: space.id }));
                const members = el('ul');
                for (const member of space.members) {
                    const row = el('li', member.userId + (member.status === 'owner' ? '（所有者）' : member.status === 'invited' ? '（招待中）' : '（参加中）'));
                    if (space.ownerId === session.userId && member.status !== 'owner') button(row, '共有から外す', () => {
                        if (confirm(member.userId + 'を共有から外しますか？ データは共有スペースに残ります。')) run('budgetSpaceRemove', { spaceId: space.id, userId: member.userId });
                    });
                    members.append(row);
                }
                section.append(members);
                if (space.ownerId === session.userId) {
                    const form = el('form'), label = el('label', '招待するユーザーID'), input = el('input');
                    input.required = true; input.maxLength = 32; input.pattern = '[a-zA-Z0-9_-]{3,32}'; input.autocomplete = 'off'; label.append(input);
                    const submit = el('button', '招待する'); submit.type = 'submit'; form.append(label, submit);
                    form.addEventListener('submit', event => { event.preventDefault(); run('budgetSpaceInvite', { spaceId: space.id, userId: input.value }); });
                    section.append(form);
                } else button(section, space.status === 'invited' ? '招待を辞退する' : '共有から退出する', () => {
                    if (confirm('この共有から退出しますか？ データは共有スペースに残ります。')) run('budgetSpaceLeave', { spaceId: space.id });
                });
                list.append(section);
            }
        }
        document.getElementById('budgetSpaceSettings').addEventListener('click', () => { dialog.showModal(); run('budgetSpaces'); });
        document.getElementById('budgetSpacePersonal').addEventListener('click', () => { try { choose(session, null); } catch (error) { document.getElementById('budgetSpaceNotice').textContent = error.message; } });
        document.getElementById('budgetSpaceClose').addEventListener('click', () => dialog.close());
        document.getElementById('budgetSpaceReload').addEventListener('click', () => run('budgetSpaces'));
        document.getElementById('budgetSpaceCreate').addEventListener('submit', event => {
            event.preventDefault(); createId ||= crypto.randomUUID();
            run('budgetSpaceCreate', { id: createId, name: document.getElementById('budgetSpaceNewName').value });
        });
        window.addEventListener('storage', event => { if (event.key === selectionKey(session.userId) || event.key === null) location.reload(); });
        if (denied) handleError({ code: 'SPACE_FORBIDDEN', message: 'この共有スペースの参加権限がありません。共有の設定で確認してください。' });
    }
    return { bind, storageUser, api, allowed, handleError, mount, selected };
})();
