# personal-hub

日常のツールへ移動するトップページとYouTube RSSアプリです。

## フォルダ構成

```text
web/
  index.html                      トップへの入口
  top/
    index.html                    トップページ
    style.css                     トップ専用スタイル
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

`web/index.html` をブラウザで開くとトップへ移動します。`web/top/index.html` から直接開くこともできます。「YouTube RSSを開く」ボタンでRSS画面へ移動します。ビルドは不要です。クラウド同期にはGASとログインを使用します。

```powershell
node --check web/youtube-rss/js/main.js
node --check web/youtube-rss/js/accounts.js
node --test tests/main.test.cjs
```

以前のRSS画面は `web/youtube-rss/YoutubeRssFedly.html` へ移動しました。旧パスのブックマーク・配信設定は更新してください。保存データの形式は変更していません。

詳しい記録は `docs/README.md`、GASの手順は `gas/README.md` を参照してください。ブラウザ検証はこのPCのPlaywrightとEdgeを使用します。
