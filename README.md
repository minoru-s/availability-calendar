# 空き状況カレンダー

午前・午後・夜の空き状況を示すウェブページです。

## 開発状況

GitHub Pages の公開版は手動ファイル更新による最初のマイルストーンです。このリポジトリには、本人用の編集画面、Cloudflare Worker の API、D1 への移行処理を追加しました。Worker と D1 は本番環境で動作し、Google ログインと本人限定の管理画面を確認しました。ローカルの `config.js` は API を指していますが、GitHub Pages への反映は未実施です。

将来的には Google カレンダーと就活用 Google シートの予定を取り込む予定です。その際も、準備時間などを考慮した本人の ○・△・× の指定を優先します。自動同期は未実装です。

## 編集機能

編集画面では ○・△・× のモードを選び、午前・午後・夜の枠を続けて押して変更します。「指定解除」を選ぶと個別指定を外し、期間・曜日のルールへ戻ります。期間・曜日・時間帯の一括設定、任意の滞在場所、取り消し、破棄、直前の公開内容への復元があります。変更は「公開する」を押すまで閲覧者には見えません。

管理画面は Google Identity Services でログインします。Worker が Google の ID トークンの署名、発行元、クライアント ID、有効期限、本人のメールアドレスを検証し、短期の HttpOnly Cookie を発行します。管理用画面と API はこの Cookie が必要です。メールアドレスと Google クライアント ID は `worker/wrangler.jsonc` のローカル設定、Cookie の署名鍵は Wrangler Secret に置きます。

## ローカル開発と移行

1. `npm install`、`npm run build` を実行します。
2. `worker/wrangler.example.jsonc` を `worker/wrangler.jsonc` にコピーし、D1 ID、Google OAuth Web クライアント ID、本人の Google メールアドレスを設定します。設定ファイルは Git の対象外です。
3. D1 を作成し、`worker/schema.sql`、生成された `worker/seed.sql` の順に適用します。seed は現在の `data.js` の28日・84枠を明示的に移します。移行対象外の未入力枠は △ です。seed は既存行を上書きしません。
4. `npm run dev` で Worker を起動します。公開ページの API 接続先は `config.js` で設定します。
5. `node --test tests/worker.test.mjs` で、移行の84枠、未ログイン拒否、別人拒否、競合、復元を検証します。

実際の D1 作成例：`npx wrangler d1 create availability-calendar`。ローカル D1 への適用例：`npx wrangler d1 execute availability-calendar --config worker/wrangler.jsonc --local --file worker/schema.sql`。本番 D1 では `--remote` を使い、適用前に既存データをバックアップします。

## Google ログインと公開切り替え

- Google Cloud で Web アプリの OAuth クライアント ID を発行し、Worker の実際の origin を「承認済みの JavaScript 生成元」に設定します。プロフィール以外の Google データへの権限は求めません。
- `SESSION_SECRET` を Wrangler Secret として登録します。公開用の `/api/public` は認証不要、編集用 API は Worker が Cookie を検証します。Cookie は1日で失効し、公開操作には同一 origin の送信元確認も必要です。
- 本番 D1 に既存84枠を移行済みです。公開 API の全84枠と旧 `data.js` の一致、本人ログイン、未ログイン拒否、管理画面での編集・取り消し・保存・復元を確認しました。保存と復元の確認は旧公開版の範囲外の日付で行い、元の △ に戻しています。
- `config.js` に Worker の URL を設定済みです。GitHub Pages への反映後、公開ページの読み込み・失敗表示・スマートフォン表示を確認します。API 有効時に通信が失敗した場合、従来のファイルへ自動的に戻して古い情報を最新のようには表示しません。

認証設定の根拠：[Google Identity Services の設定](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)、[ID トークンの検証](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)。

## 更新方法

現在の GitHub Pages 公開版は `data.js` の `rules`（期間と曜日の一括設定）と `slots`（特定日の上書き）で更新します。特定日の上書きを優先し、この従来版でどちらにも指定していない時間帯は ○ です。API へ切り替えた後の未入力枠は △ です。

- `available`: ○ 空き
- `tentative`: △ 調整中
- `busy`: × 予定あり

時間帯は `am`（9–12時）、`pm`（13–18時）、`night`（18–21時）です。公開時には `checkedAt` を更新し、本人が全期間を確認した場合に `reviewed` を `true` にしてください。

`data.js` は誰でも読めます。予定名、行き先、企業名などは書かないでください。

GitHub Pages には、このフォルダーのファイルをそのまま置けます。
