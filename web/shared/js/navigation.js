// 共通ヘッダーの利用者表示は端末の認証情報だけで更新する
(() => {
    function render() {
        const user = document.querySelector('[data-hub-user]');
        if (user) user.textContent = HubAuth.read()?.userId || '';
    }
    window.addEventListener('hub-auth-changed', render);
    window.addEventListener('pageshow', render);
    render();
})();
