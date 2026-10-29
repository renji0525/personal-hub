// トップ画面でPersonal Hub共通のログイン・登録・ログアウトを扱う
const form = document.getElementById('accountForm');
const status = document.getElementById('accountStatus');
const tools = document.getElementById('tools');
const logout = document.getElementById('logoutButton');
let accountBusy = false;
const resetForm = document.getElementById('resetPasswordForm');
let temporaryMode = false, resetSession = null;

function setLoginMode(temporary) {
    temporaryMode = temporary;
    resetSession = null;
    resetForm.reset();
    document.getElementById('passwordInput').value = '';
    document.getElementById('accountTitle').textContent = temporary ? '一時パスワードでログイン' : 'おかえりなさい';
    document.getElementById('accountHelp').textContent = temporary ? '管理者から受け取った一時パスワードを入力してください。ログイン後に新しいパスワードを設定します。' : 'アカウントにログインして、続きを始めましょう。';
    document.getElementById('passwordLabel').textContent = temporary ? '一時パスワード' : 'パスワード';
    document.getElementById('submitLabel').textContent = temporary ? '一時ログイン' : 'ログイン';
    document.getElementById('registerButton').hidden = temporary;
    document.getElementById('forgotPasswordButton').hidden = temporary;
    document.getElementById('backToLoginButton').hidden = !temporary;
    renderAccount(HubAuth.read());
}

function renderAccount(session, message) {
    if (session) { resetSession = null; resetForm.reset(); }
    form.hidden = !!session || !!resetSession;
    resetForm.hidden = !!session || !resetSession;
    tools.hidden = !session;
    logout.hidden = !session;
    status.textContent = message || (session ? session.userId + ' としてログイン中' : 'ログインしてください。');
}

function setAccountBusy(value) {
    accountBusy = value;
    form.querySelectorAll('input, button').forEach(element => { element.disabled = value; });
    resetForm.querySelectorAll('input, button').forEach(element => { element.disabled = value; });
    logout.disabled = value;
}

async function signIn(action) {
    if (accountBusy || !form.reportValidity()) return;
    setAccountBusy(true);
    status.textContent = '接続中…';
    const password = document.getElementById('passwordInput');
    try {
        const userId = document.getElementById('userIdInput').value.trim();
        if (temporaryMode) {
            resetSession = await HubAuth.temporarySignIn(userId, password.value);
            document.getElementById('resetUser').textContent = resetSession.userId;
            renderAccount(null, '一時ログインしました。新しいパスワードを設定してください。');
        } else {
            const session = await HubAuth.signIn(action, userId, password.value);
            renderAccount(session);
        }
    } catch (error) { renderAccount(null, error.message); }
    finally { password.value = ''; setAccountBusy(false); if (resetSession) document.getElementById('newPasswordInput').focus(); }
}

async function checkAccount() {
    if (accountBusy) return;
    const session = HubAuth.resume();
    if (!session) {
        const reason = new URLSearchParams(location.search).get('reason');
        renderAccount(null, reason === 'expired' ? 'セッションが切れました。ログインし直してください。' : undefined);
        return;
    }
    // 画面表示は端末内の期限を確認し、データAPIでサーバー認証する
    renderAccount(session);
}

form.addEventListener('submit', event => { event.preventDefault(); signIn('login'); });
document.getElementById('forgotPasswordButton').addEventListener('click', () => { if (!accountBusy) setLoginMode(true); });
for (const id of ['backToLoginButton', 'cancelResetButton']) document.getElementById(id).addEventListener('click', () => { if (!accountBusy) setLoginMode(false); });
resetForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (accountBusy || !resetSession || !resetForm.reportValidity()) return;
    const password = document.getElementById('newPasswordInput'), confirm = document.getElementById('confirmPasswordInput');
    if (password.value !== confirm.value) { status.textContent = '確認用パスワードが一致しません。'; confirm.focus(); return; }
    setAccountBusy(true);
    status.textContent = 'パスワードを再設定中…';
    try {
        await HubAuth.resetPassword(resetSession, password.value);
        setLoginMode(false);
        status.textContent = 'パスワードを再設定しました。新しいパスワードでログインしてください。';
    } catch (error) {
        if (error.code === 'RESET_EXPIRED') setLoginMode(true);
        status.textContent = error.message;
    } finally { password.value = ''; confirm.value = ''; setAccountBusy(false); }
});
document.getElementById('registerButton').addEventListener('click', () => signIn('register'));
logout.addEventListener('click', async () => {
    if (accountBusy) return;
    setAccountBusy(true);
    try { await HubAuth.signOut(); renderAccount(null); }
    catch (error) { renderAccount(null, 'この端末からログアウトしました。サーバーには接続できませんでした。'); }
    finally { setAccountBusy(false); }
});
window.addEventListener('hub-auth-changed', event => renderAccount(event.detail));
window.addEventListener('pageshow', checkAccount);
