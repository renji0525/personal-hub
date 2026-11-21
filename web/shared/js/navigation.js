// 共通ナビ：保存済み認証情報から利用者表示を更新する。表示のためのAPIは呼ばない。
// 共通ヘッダーの利用者表示は端末の認証情報だけで更新する
(() => {
    // 現在の状態を画面へ反映する。保存や通信とは分けて呼び出す。
    function render() {
        const user = document.querySelector('[data-hub-user]');
        if (user) user.textContent = HubAuth.read()?.userId || '';
    }
    window.addEventListener('hub-auth-changed', render);
    window.addEventListener('pageshow', render);
    render();
})();
