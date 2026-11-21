# コードの読み方と書式

HTML・CSS・JavaScriptは、人が読んで修正するソースとして保存します。配信時に手作業で行を詰めたり、意味の分からない短い名前に変更したりしません。

## 命名

- JavaScriptの変数・関数はcamelCaseを使います。関数は`getInventoryState`、`saveLocalState`のように動作を表します。
- 真偽値は`isCurrentAccount`のように条件が分かる名前を優先します。既存の公開名やテストで参照される名前は、関連箇所を確認してから変更します。
- 固定の設定値は`API_URL`などのUPPER_SNAKE_CASEを使います。単に`const`であるだけのデータをすべて大文字にはしません。
- CSSクラスは`note-card`などのkebab-caseです。既存のHTML IDはJavaScript・CSS・テストとの契約なので、表記だけを理由に一括変更しません。
- APIのaction、保存キー、JSONのプロパティ名は既存データとの互換性を持ちます。内部変数のリネームと区別してください。

## 日本語コメント

ファイル先頭には責務を書きます。関数や複雑な分岐では「なぜ必要か」「どの状態を守るか」を説明します。代入やループの内容をそのまま言い直すコメントを大量に付ける必要はありません。

特に同期では、送信中の追加入力、別タブの更新、再送ID、競合時に残すデータを説明してください。コメントを変更した際も、コードの実際の動作と一致するか確認します。

## 自動整形

ルートのpackage.jsonに開発用Prettierを固定しています。Web自体はビルド不要で、この依存をブラウザに配信して使う構成ではありません。

```powershell
pnpm install --frozen-lockfile
pnpm run format
pnpm run format:check
```

対象はweb配下のHTML・CSS・JavaScriptです。4スペース、原則100文字の折り返し、JavaScriptのシングルクォート、LF改行を.prettierrc.jsonで定義します。HTMLは空白の表示への影響を考慮した設定です。

## モデルと検証

HTMLは構造、CSSは見た目、app.jsはイベントと描画、model.jsは業務ルール、store.jsは端末状態と再送の管理を担います。RSS・トークなどは用途ごとの同期方式を持つため、機械的に同一構成へ置き換えません。

Webのモデル・共通比較ルール・入力解析を変更した場合は、対応するgas/scripts/build-*.cjsでGAS配布ファイルを再生成します。生成済みファイルだけを編集しないでください。

```powershell
pnpm test
```

このコマンドはWebとGASのNodeテストを実行します。GASはモックで、gasフォルダは既存方針によりGit対象外です。cloneだけの環境にはGASテストが揃わない点に注意してください。ブラウザ検証の方法はtests/browser/README.md、実際の結果と学習資料はObsidianのpersonal-hub_wikiに記録します。

## GASの書式と公開関数

GASも同じ.prettierrc.jsonを使い、内部変数はcamelCase、固定設定はUPPER_SNAKE_CASEとします。既存の補助関数には末尾の`_`を維持します。GAS全体で名前を共有するため、関数名を変えるときは別ファイルからの呼び出しも確認します。

`doPost`・`doGet`、管理画面で実行する関数、定期トリガーから呼ぶ関数は外部との接点です。読みやすさだけを理由に変更しません。シート名・列名・Script Propertiesのキーも保存形式の一部です。

```powershell
pnpm --dir gas install --frozen-lockfile
pnpm --dir gas run build
pnpm --dir gas run format:check
```

buildの最後に自動整形します。整形だけなら`pnpm --dir gas run format`です。対象はgas/srcの自作・生成コードとmanifest、およびgas/scriptsの生成処理です。第三者ライブラリの90_vendor_bcrypt.jsは配布元の形とライセンスを維持します。過去版のarchiveとデータのバックアップは一括整形しません。

Webから生成するモデルへコメントや名前の改善を加えるときは、Web側の生成元を編集します。GAS固有コードは、認証・ロック・検証・保存・復旧の境界が分かる日本語コメントを優先します。生成後の診断文抽出で、改行されたエラー文も保持されることを確認してください。
