# Supabase クライアントの httpx クライアント共有（Issue #660）

## 課題

本番のバックエンド（Render、メモリ上限 512MB）が「Ran out of memory (used over 512MB)」で再起動していた。
複数タブで受注詳細（作り置きの引き当て）を操作しているときに、15分間隔の cron と重なると高い頻度で落ちた。
アプリのトレースバックは出ず、アクセスログの途中で `Instance ... restarted` になる（処理中だったリクエストは
レスポンスを返していないのでアクセスログに出ない）。

## 原因

`dependencies.get_supabase_client()` はユーザーの JWT ごとにリクエスト単位で `create_client()` している。

- Supabase クライアント1個は、postgrest / auth / storage / functions ごとに httpx クライアントを作る（計4個）
- httpx クライアントはそれぞれ SSL コンテキスト（CA 証明書の読み込み）を持ち、1個あたり約0.85MB の C 側メモリを使う
- Supabase クライアントは循環参照を持つので、捨てても循環 GC まで解放されない。GC の起動は Python オブジェクトの
  数で決まり C 側のメモリ量を知らないので、計測では常に17〜27個が生き残っていた
- スレッドプールの複数スレッドで確保・解放を繰り返すため glibc のヒープが断片化し、解放後も RSS が下がらない

結果として、認証付きの API は（最も軽い `/tenant/members/me` でも）1リクエストあたり約400KB ずつ RSS が増え続けた。
起動直後の RSS が既に約175MB（anthropic・pdfplumber・openpyxl 等の import）なので、複数タブの操作で積み上がった
ところへ cron が重なると 512MB を超える。cron の処理・作り置きの引き当ての処理そのものは原因ではない。

## 修正内容

httpx クライアントをプロセスで1つにして（`dependencies._shared_httpx_client`）、`ClientOptions(httpx_client=...)` で
ユーザー用（`get_supabase_client()`）・service role 用（`get_supabase_admin_client()`）の両方に注入する。
Supabase クライアント自体は JWT を持つのでこれまでどおりリクエストごとに作る。

- **ユーザー間で JWT が混ざらない**: supabase-py 2.31 の postgrest / auth / storage / functions は、注入された httpx
  クライアントにヘッダーを書き込まず、Supabase クライアントのインスタンスが持つヘッダーをリクエストごとに渡す。
  サインイン（`SIGNED_IN` 等）で差し替わるのもインスタンスの `options.headers` / `auth._headers` だけ。
  そのため `ClientOptions` は共有せず、呼び出しごとに作る
- **タイムアウト**: 注入した httpx クライアントの値が各サブクライアントで使われる（`storage_client_timeout` 等の
  オプションは効かない）。postgrest の既定値に合わせて 120 秒（`SUPABASE_HTTPX_TIMEOUT_SECONDS`）
- **Cookie を保持しない**: 共有クライアントの Cookie Jar は全ユーザーで共有されるので、すべての Cookie を拒否する
  ポリシーにする（Supabase の認証はヘッダーで行う）
- **HTTP/1.1**: HTTP/2 は1本の接続を全スレッドで多重化するので使わず、HTTP/1.1 のコネクションプール（httpx の既定、
  最大100接続）にする

## 検証（ローカル）

本番と同じ Docker イメージを `docker run -m 512m --memory-swap 512m` で起動し、本番と同規模の架空データ
（製品約560・受注約280・スケジュール約5,000・日報明細約480）で、受注詳細を開いたタブ相当のリクエスト
（`/orders`・`/daily-reports/order-progress`・`/daily-reports/orders/{id}/stock-assignments` の GET / PUT 等）と
`/api/cron/*` を並列に流した。

| 試験 | 修正前 | 修正後 |
|---|---|---|
| 5タブ＋cron 2分 | 最大 465〜486MB（増え続ける） | 最大 227MB |
| 8タブ＋cron 5分 | — | 246MB で頭打ち |
| 16並列のリクエスト | OOMKilled（終了コード 137） | 落ちない |
| 2分間の処理リクエスト数 | 1,646 | 3,990 |
| cron のみ | 228MB で頭打ち | — |

`MALLOC_ARENA_MAX=2` だけでは 486MB → 434MB とわずかに下がるだけで、増え続ける傾向は変わらなかった。

ユーザー間の分離は、2ユーザー・16並列・800リクエストで、各ユーザーの `/orders` が単独で取得したときと一致する
こと、非所属テナントを指定した `/tenant/members/me` が常に 403 になることで確認した。

## テスト

`backend/__tests__/unit/test_dependencies.py` の `TestSharedHttpxClient`:

- ユーザー用・service role 用のクライアントが同じ httpx クライアントを使う
- 共有の httpx クライアントに Authorization ヘッダーが載らない
- 送るリクエストにはそれぞれのユーザーの JWT が付く（`httpx.MockTransport` で記録）
- 応答の Cookie を保持しない
- タイムアウトが 120 秒
