// トップ画面でPersonal Hub共通のログイン・登録・ログアウトを扱う
const form = document.getElementById('accountForm');
const status = document.getElementById('accountStatus');
const tools = document.getElementById('tools');
const logout = document.getElementById('logoutButton');
const retry = document.getElementById('retryButton');
let accountBusy = false;

function renderAccount(session, message) {
    form.hidden = !!session;
    tools.hidden = !session;
    logout.hidden = !session;
    retry.hidden = true;
    status.textContent = message || (session ? session.userId + ' としてログイン中' : 'ログインしてください。');
}

function setAccountBusy(value) {
    accountBusy = value;
    form.querySelectorAll('input, button').forEach(element => { element.disabled = value; });
    logout.disabled = value;
    retry.disabled = value;
}

async function signIn(action) {
    if (accountBusy || !form.reportValidity()) return;
    setAccountBusy(true);
    status.textContent = '接続中…';
    const password = document.getElementById('passwordInput');
    try {
        const session = await HubAuth.signIn(action, document.getElementById('userIdInput').value.trim(), password.value);
        renderAccount(session);
    } catch (error) { renderAccount(null, error.message); }
    finally { password.value = ''; setAccountBusy(false); }
}

async function checkAccount() {
    if (accountBusy) return;
    const session = HubAuth.read();
    if (!session) {
        const reason = new URLSearchParams(location.search).get('reason');
        renderAccount(null, reason === 'expired' ? 'セッションが切れました。ログインし直してください。' : undefined);
        return;
    }
    setAccountBusy(true);
    tools.hidden = true;
    status.textContent = 'ログイン情報を確認中…';
    try {
        const verified = await HubAuth.verify(session);
        renderAccount(verified);
    } catch (error) {
        renderAccount(null, error.message);
        retry.hidden = !HubAuth.read();
    } finally { setAccountBusy(false); }
}

form.addEventListener('submit', event => { event.preventDefault(); signIn('login'); });
document.getElementById('registerButton').addEventListener('click', () => signIn('register'));
logout.addEventListener('click', async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try { await HubAuth.signOut(); renderAccount(null); }
    catch (error) { renderAccount(null, 'この端末からログアウトしました。サーバーには接続できませんでした。'); }
    finally { setAccountBusy(false); }
});
retry.addEventListener('click', checkAccount);
window.addEventListener('hub-auth-changed', event => renderAccount(event.detail));
window.addEventListener('pageshow', checkAccount);
