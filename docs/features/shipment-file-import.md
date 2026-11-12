# 弥生販売の売上伝票の取り込み（Issue #662 / #664）

送品の正典は弥生販売（インストール型）。弥生にはクラウド API が無く、連携手段は伝票のエクスポートなので、
事務PCが書き出したファイル（実際のエクスポートは Excel の `.xlsx`。Issue #664）を**生ファイルのまま**受け取って保存するところまでを実装している。
解析・突合（送品の消し込みの候補への反映）は、実物のファイルの項目を確認してから別の変更で足す（フェーズ2。Excel なので日報と同様 `openpyxl` で読む）。

## 構成

```
[事務PC] 弥生販売 ──手動エクスポート──▶ 共有フォルダ（弥生取り込み用）
                                           │ UNC
[日報エージェント端末] DailyReportAgent.ps1（targets に shipment_files を追加）
        └─▶ agent-gateway ─▶ POST /api/agent/shipment-files ─▶ Storage + shipment_files

[事務PCのブラウザ]（予備）─▶ POST /shipment-files（ユーザー JWT）─▶ 同じ Storage + shipment_files
```

- 事務PC（経理データがある）には**何も入れない**。トークン・スクリプト・タスクスケジューラはエージェント端末だけに置く
- エージェントはファイルの形式を知らない。解析をサーバー側に置くので、CSV の形式が分かった後の修正は再訪問なしで出せる
- 弥生側のエクスポートは自動化しない（画面操作のため）。送品のたびに担当者がエクスポートを1回押す運用

## データ

- テーブル `shipment_files`（マイグレーション `20261108000000_add_shipment_files.sql`）。`UNIQUE (tenant_id, sha256)` で
  再送・同名上書き・同時送信を重複排除する。`source` は `agent` / `web`。`agent` は `agent_token_id`、`web` は
  `uploaded_by` が必須（CHECK）
- バケット `shipment-files`（private、20MB）。キーは `{tenant_id}/{sha256}{拡張子}`（`.xlsx` / `.csv` / `.txt`）（日本語ファイル名はキーに使わない）
- RLS: 参照はテナントメンバー。INSERT は `source='web'` かつ `uploaded_by = auth.uid()` のメンバーだけ（エージェント経由は
  service role）。Storage は自テナントのフォルダへの追加のみ（UPDATE・DELETE ポリシーは無い）。`auth.jwt() ->> 'tenant_id'` は
  発行されていないので `is_tenant_member()` で判定し、先頭フォルダが UUID でないキーで `::uuid` が失敗しないよう `CASE` で形式を先に確かめる

## API

| 経路 | エンドポイント | 認証 |
|---|---|---|
| エージェント | `POST /api/agent/shipment-files`（octet-stream。ヘッダは日報と同じ `X-File-Sha256` / `X-File-Path` / `X-File-Modified-At`） | エージェントトークン |
| アプリ | `POST /shipment-files`（octet-stream。`X-File-Name`（URL エンコード）/ 任意 `X-File-Modified-At`）。SHA-256 はサーバーが求める | ユーザー JWT。`order_handler` / `president` / `platform_admin` |
| アプリ | `GET /shipment-files`（最終取り込み日時＋直近20件。パスは返さない） | テナントメンバー |

- 受け付ける拡張子は `.xlsx` / `.csv` / `.txt`（content-type は `_CONTENT_TYPES` に明示。当初 `.xlsx` を除外していて弥生の実エクスポートが 400 になった。#664）（`shipment_file_service.ALLOWED_EXTENSIONS`）、上限は `SHIPMENT_FILE_MAX_BYTES`（既定 20MB）
- raw body の検証（サイズ上限・ハッシュ）は日報と共通の `routers/agent/_upload.py`。テストで上限を変えるときは
  ルーターモジュール側（`routers.agent.shipment_files` / `routers.transaction.shipment_files`）の定数を `monkeypatch` する
- **`agent-gateway`（Edge Function）の `ALLOWED_PATHS` に `/api/agent/shipment-files` を足してある。マージ後に
  `supabase functions deploy agent-gateway --no-verify-jwt` で再デプロイしないと、本番のエージェントからは届かない**

## エージェント（`tools/daily-report-agent/`）

- 設定の `targets`（`kind` = `daily_reports` / `shipment_files`、`folders`、任意の `extensions` / `recurse`）で、フォルダごとに
  送り先を切り替える。`targets` が無い従来の `target_folders` は `daily_reports` 1つとして動くので、既設の `config.json` はそのまま動く
- `kind` で送り先が決まる（任意のエンドポイントは指定できない）。拡張子の既定は日報が Excel、送品が `.xlsx` / `.csv` / `.txt`
- heartbeat の `payload.targets` に種類ごとの集計が入る。`-DryRun` は従来どおり送信せず対象だけを一覧する

## 画面

- `/orders/shipment-import`（サイドバー「弥生の取り込み」。社長・受注担当・プラットフォーム管理者）: 最終取り込み日時・直近のファイル・
  予備のアップロード。ロールが足りないメンバーにはアップロードのボタンを出さない
- 「送品の消し込み」の上部に最終取り込み日時を出す。**送品は不定期なので「何日更新が無い」の警告は出さない**

## 顧客に確認すること（実装前・訪問時）

- 売上伝票（明細つき）のエクスポートの実物 CSV 数本（項目に伝票番号・日付・得意先・品名・数量があるか、文字コード）。出荷の記録が
  売上伝票か納品書か、どちらの日付が出荷日か。エクスポート条件を保存できるか
- 分納・取消（赤伝）・伝票修正をどう記録しているか。弥生の品名と注文書の品名の違い
- 事務PCから日報用のファイルサーバーへ書き込めるか（下記の確認手順）

### 事務PCの担当者向け: 書き込みの確認手順（メールで依頼する。スクリプトは送らない）

1. エクスプローラーのアドレス欄に共有フォルダのパス（`\\サーバー名\共有名`）を入力して開けるか
2. 開けたら新規にテキストファイルを作り、`test_書き込み確認.txt` で保存できるか
3. 結果（できた／できない。エラーが出たら文言・スクリーンショット）と、その PC にログオンしているアカウント名を返信してもらう
4. 確認後にそのファイルを削除してもらう（削除できるかも確認になる）

書き込めない場合の代替: アプリからのアップロード（本命の予備）→ メール添付 → USB。

## 運用上の注意

- エクスポート範囲は**前回と重なる範囲**（例: 直近30日）にしてもらう。押し忘れや修正伝票を拾え、重複は `(tenant_id, sha256)` で吸収される
- CSV には金額・請求情報の列が含まれうる。エクスポート時に必要な項目だけ選べるなら絞る。解析を足すときは不要な列を保持しない
- フェーズ2（未実装）: 行単位の冪等な取り込み（伝票番号＋行番号。赤伝も取り込む）、日報の別名辞書（#488）と共通の名寄せ
  （`source='shipment'`）、顧客＋製品＋数量＋日付からの送品候補、分納（複数伝票の合計）、「弥生の取り込み待ち」の表示。
  **自動では送品済みにしない**（送品は弥生が正で、アプリは候補を示すだけ。#557）
