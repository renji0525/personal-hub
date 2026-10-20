# personal-hub

日常のツールへ移動するトップページとYouTube RSSアプリです。

## フォルダ構成

```text
web/
  index.html                      トップへの入口
  top/
    index.html                    トップページ
    style.css                     トップ専用スタイル
    main.js                       共通ログイン画面の操作
  shared/js/auth.js               Personal Hub共通認証・GAS通信
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

ログインはPersonal Hub全体で共通です。認証セッションはlocalStorage（personal_hub_session）に保存し、ブラウザを終了してもログインから最大30日間維持します。パスワードは保存しません。旧sessionStorageのセッションは元の期限を保って自動移行し、次回ログインから30日になります。ログアウトは同じブラウザの各タブへ反映し、通信できた場合はサーバー側セッションも無効化します。保護画面はGASでセッションを確認してから表示し、期限切れ・失効時はトップへ戻ります。通信で認証を確認できない場合もトップで再確認できます。

GASはユーザー情報（Users・Sessions）とYouTube RSS（Channels・Videos・UserChannels・Watched）を別スプレッドシートで管理する構成に対応しています。既存データの分離はGASエディタでsetupSplitDatabasesを実行します。詳細はgas/README.mdを参照してください。
