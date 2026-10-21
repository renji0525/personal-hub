# personal-hub

共通ログイン、YouTube RSS、家計簿を備える静的Webアプリです。

## 構成

各ページを `index.html`、`css/style.css`、`js/app.js` に揃えています。

- `web/index.html`：Topへの入口。
- `web/top/`：共通ログイン・登録・ツール一覧。
- `web/youtube-rss/`：RSS一覧、既読管理、JSONバックアップ・復元。同期処理は `js/sync.js`。
- `web/budget/`：家計簿、自由カテゴリ・色、月集計。入力ルールは `js/model.js`、端末保存は `js/store.js`。
- `web/shared/js/auth.js`：共通認証・GAS通信。
- `tests/`：Node.js自動テスト。
- `gas/`：GASソース・同期環境（Git対象外）。
- `docs/`、`savedata/`、`tests/browser/`：作業記録・個人バックアップ・このPCのEdge検証（Git対象外）。

旧RSS URL `web/youtube-rss/YoutubeRssFedly.html` は新しい `index.html` へ転送します。

## 起動と検証

`web/index.html` をブラウザで開きます。ビルド不要です。クラウド同期にはGASと共通ログインを使用します。

```powershell
node --test tests/*.test.cjs
node --check web/shared/js/auth.js
node --check web/top/js/app.js
node --check web/youtube-rss/js/app.js
node --check web/youtube-rss/js/sync.js
node --check web/budget/js/app.js
```

## 保存・通信

ログイン情報をlocalStorageに保存し、最大30日間保持します。パスワードは保存しません。画面表示時は端末の有効期限を確認し、各データAPIでサーバー認証します。ログアウトは端末を即時解除し、サーバーへの無効化要求も送ります。通信失敗時は端末側だけの解除になります。

RSSはユーザー別の全件キャッシュを先に表示し、起動時に同期。通常は認証を含め1APIです（旧既読移行・100件超の既読送信は追加通信）。表示・絞込・既読・バックアップは通信なし。既読は次回同期でまとめて送信し、ログアウト時も未送信キューを維持します。「更新」は各チャンネルのRSS取得と最後の同期を行います。

家計簿はユーザー別に端末保存し、ページを開いた時と「同期する」でのみ同期します。未同期操作は20件ずつ送信。変更がない時は更新番号だけ返し、記録シートの読込と全データ転送を省きます。別端末との競合時は未同期内容を保持して停止します。サイトデータを削除すると未同期分も消えるため、必要ならJSONバックアップを利用してください。

GASはユーザー情報、RSS、家計簿を別スプレッドシートで管理。既存DBの分離は `setupSplitDatabases` を使用します。手順はローカルの `gas/README.md`、現在の状態は `docs/STATUS.md`、家計簿の使い方は `docs/BUDGET.md` を参照してください。
