# 転送ヘッダーが無いメールでの実Fromヘッダー優先マッチング（Issue #311）

顧客から intake 用 Gmail アドレスへ**転送を介さず直接**メールが届いた場合、顧客マッチングの
精度が低かった問題を修正する。

---

## 背景

[customer-draft-auto-create.md](customer-draft-auto-create.md) の従来設計は、「ユーザ（テナントの
担当者）が顧客からの受注メールを intake 用 Gmail アドレスへ転送する」運用を前提としており、
実際の Gmail `From` ヘッダは常に転送した社内ユーザのアドレスであるため使えない、という前提を
置いていた。顧客の特定は本文中に引用された「元メッセージ」（`From:`/`差出人:` ヘッダー、
署名ブロック）の正規表現解析にのみ依存していた（`customer_matching_service.py`）。

しかし実際には、顧客が intake 用アドレスへ直接メールを送るケース（転送ヘッダーが本文に
存在しない）も発生する。この場合、本文中には引用ヘッダーが無いため
`extract_sender_email_candidates` は空集合を返し、`extract_body_email_candidates` による
署名欄からのメールアドレス抽出（Issue #298 のフォールバック）に頼るしかなかった。署名欄の
メールアドレスは `customers.email` と表記揺れがあったり、そもそも署名が無かったりするため
マッチング精度が低く、既存顧客であっても下書き顧客が重複作成されることがあった。

一方、この「直接メール」のケースでは Gmail の実際の `From` ヘッダーこそが顧客のメールアドレス
そのものであり、本来もっとも信頼できるシグナルであるにもかかわらず、従来は一切参照されて
いなかった。

## 修正内容

### `customer_matching_service.py`

- `extract_email_address(text: str) -> str | None` を追加。任意の文字列（メールヘッダーの値等）
  から最初のメールアドレスを抽出する汎用ユーティリティ
- `resolve_or_create_customer` に `real_from_email: str | None = None` を追加し、優先順位を
  以下のように変更した:
  1. 本文中に転送ヘッダー（`From:`/`差出人:`）が **存在する** 場合 → 従来通り、ヘッダー行
     ベースの候補集合を使う（`real_from_email` は無視される）
  2. 本文中に転送ヘッダーが **存在しない** 場合 → `real_from_email` と `customers.email` の
     突合を最優先で試みる。一致すればその場で確定し、本文解析は行わない
  3. 上記でも一致しない場合、従来通り本文全体からのメールアドレス抽出
     （`extract_body_email_candidates`、Issue #298 のフォールバック）による積集合突合を試みる
  4. それでも一致しない場合の下書き作成では、本文に転送ヘッダーが無く `real_from_email` が
     ある場合はそれを作成用メールアドレスとして優先する（本文から抽出した末尾候補より
     実際の送信者アドレスの方が信頼できるため）
- `extract_effective_sender_email(body, real_from_email=None)` も同じ優先順位
  （ヘッダー行 → 実Fromヘッダー → 本文全体）に更新し、通知payload表示用の値も一致させた

### `gmail_service.py`

- `_get_real_from_email(msg)` を追加。Gmail APIメッセージの `payload.headers` から
  `From` ヘッダーの値を取得し、`extract_email_address` でメールアドレス部分を抽出する
- `_process_message` で `real_from_email = _get_real_from_email(msg)` を取得し、
  `extract_effective_sender_email` と `resolve_or_create_customer` の両方に渡すように変更

## 受け入れ条件

- [x] 転送ヘッダーが本文に存在しないメールについて、実際の Gmail `From` ヘッダーと
      顧客マスタの `email` によるマッチングが最優先で行われること
- [x] 転送ヘッダーが本文に存在するメール（既存の転送運用）については、従来通りの
      本文解析ロジックが引き続き機能すること（実Fromヘッダーは無視される）
- [x] 実Fromヘッダーが顧客マスタと一致しない場合、Issue #298 の本文全体フォールバックが
      引き続き機能すること
- [x] 既存のテストをパスすること、および新しい優先順位を検証する単体テストを追加すること
      (`__tests__/unit/services/test_customer_matching_service.py`,
      `__tests__/unit/services/test_gmail_service.py`)
- [x] 型・Lint エラーが出ていないこと

## スコープ外

- 本文中に複数の署名ブロックが存在する場合のタイブレーク方法の改善（既存の「最後に出現した
  候補」ロジックを維持）
- 同一会社の別担当者アドレスをドメイン単位でマッチさせる拡張

## 関連

- [customer-draft-auto-create.md](customer-draft-auto-create.md): 下書き顧客自動作成の基本設計
- Issue #263, #265: 転送メールの顧客メールアドレス/顧客名抽出の基本実装
- Issue #298: 直接転送メールでヘッダー行が本文化されない場合の本文全体フォールバック
- Issue #311: 転送ヘッダーの無いメールで顧客マッチングが実From優先で行われず精度が低い
