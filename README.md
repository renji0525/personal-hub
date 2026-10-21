# personal-hub

日常のツールへ移動するトップページ、YouTube RSS、家計簿のアプリです。

## フォルダ構成

```text
web/
  index.html                      トップへの入口
  top/
    index.html                    トップページ
    style.css                     トップ専用スタイル
    main.js                       共通ログイン画面の操作
  shared/js/auth.js               Personal Hub共通認証・GAS通信
  budget/                         家計簿・カテゴリ管理・月別集計
  youtube-rss/
    YoutubeRssFedly.html           YouTube RSS画面
    css/                          RSS専用スタイル
    js/                           RSSの状態管理・同期
    resource/icon/                RSSのアイコン
tests/                            Node.jsの自動テスト
  browser/                        ローカルのEdge検証（Git対象外）
gas/                              GAS同期環境（Git対象外）
savedata/                         個人バックアップ（Git対象外）
docs/                             プロジェクト記録（Git対象外）
  screenshots/                    画面確認画像
```

## 起動・検証

`web/index.html` をブラウザで開くとトップへ移動します。`web/top/index.html` から直接開くこともできます。トップでログイン（または新規登録）すると「YouTube RSSを開く」ボタンを表示します。未ログインでRSS画面を直接開くとトップへ戻ります。ビルドは不要です。クラウド同期にはGASとログインを使用します。

```powershell
node --check web/shared/js/auth.js
node --check web/top/main.js
node --check web/youtube-rss/js/main.js
node --check web/youtube-rss/js/accounts.js
node --test tests/*.test.cjs
```

以前のRSS画面は `web/youtube-rss/YoutubeRssFedly.html` へ移動しました。旧パスのブックマーク・配信設定は更新してください。保存データの形式は変更していません。

詳しい記録は `docs/README.md`、GASの手順は `gas/README.md` を参照してください。ブラウザ検証はこのPCのPlaywrightとEdgeを使用します。

ログインはPersonal Hub全体で共通です。認証セッションはlocalStorage（personal_hub_session）に保存し、ブラウザを終了してもログインから最大30日間維持します。パスワードは保存しません。旧sessionStorageのセッションは元の期限を保って自動移行し、次回ログインから30日になります。ログアウトは同じブラウザの各タブへ反映し、通信できた場合はサーバー側セッションも無効化します。Topと家計簿の画面表示は端末内のセッションと有効期限で確認します。家計簿の同期APIは毎回サーバーで認証し、失効が確認された場合はTopへ戻ります。RSSの表示前サーバー確認は維持しています。

GASはユーザー情報（Users・Sessions）とYouTube RSS（Channels・Videos・UserChannels・Watched）を別スプレッドシートで管理する構成に対応しています。既存データの分離はGASエディタでsetupSplitDatabasesを実行します。詳細はgas/README.mdを参照してください。

既読変更は一覧取得と同時に送信し、通常の同期をAPI1回にまとめます。連続したシート更新も一括処理します。現行のローカルブラウザ検証はtests/browser/README.md、旧仕様の検証はtests/browser/legacy/に分けています。GASの補助スクリプトはgas/scripts/、ライセンスはgas/licenses/です。

家計簿はTopの「家計簿を開く」から利用できます。収入・支出の記録、自由なカテゴリ名と色、月別収支、カテゴリ別集計、JSON書き出しに対応。初回利用時に専用スプレッドシートを自動作成し、データをユーザー別に保存します。編集はユーザー別にlocalStorageへ保存し、ページを開いた時と「同期する」を押した時だけGASと同期します。通常の収支・カテゴリ編集では通信しません。未同期分はログアウト後もこの端末に残り、同じユーザーで再ログインすると復元します。端末のサイトデータを削除すると未同期分も消えます。詳しい使い方はローカルのdocs/BUDGET.mdを参照してください。
