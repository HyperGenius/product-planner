"""受信受注メールの処理結果を「起票 / スキップ / 失敗」の3値に固定する（Issue #422）。

受信メール処理結果の一覧（`GET /orders/email-intake-results`）と、Slack への件数通知
（`email_intake_slack_service`、Issue #574）で同じ分類を使う。
"""

from app.models.transaction.order_schema import EmailIntakeOutcome

# order_parse_log.reason は CHECK 制約のない自由文字列。分類は完全にアプリ側の責務。

# 抽出・処理が完了できなかった（起票に至らない）ことを示す理由
EMAIL_INTAKE_FAIL_REASONS = frozenset(
    {"failed_encrypted", "failed_image", "failed_no_attachment"}
)
# 起票はされたが運用者の確認が必要なことを示す理由。
# image_extracted は画像PDF（FAX等）から読み取って起票したもの（数字の読み違いが
# 起きうるため元ファイルとの照合を促す。Issue #520）
EMAIL_INTAKE_ATTENTION_REASONS = frozenset(
    {"no_product_match", "multi_order_suspected", "invalid_quantity", "image_extracted"}
)
# 正常に処理された上で意図的に起票しなかったことを示す理由
EMAIL_INTAKE_SKIP_REASONS = frozenset(
    {
        "non_order_email",
        "draft_conflict_skipped",
        "downgrade_skipped",
        "no_order_created",
        # 同じ修理の注文書の再受信（既存の修理注文を上書きしない。Issue #493）
        "repair_duplicate_skipped",
    }
)
EMAIL_INTAKE_KNOWN_REASONS = (
    EMAIL_INTAKE_FAIL_REASONS
    | EMAIL_INTAKE_ATTENTION_REASONS
    | EMAIL_INTAKE_SKIP_REASONS
)


def derive_email_intake_outcome(
    parse_status: str, created_order_count: int, parse_log_reasons: list[str]
) -> tuple[EmailIntakeOutcome, bool, bool]:
    """受信受注メール1件の処理結果を (outcome, needs_attention, empty_draft) に導出する。

    - outcome: "created" / "skipped" / "failed"（Issue #422）
    - needs_attention: outcome="created" かつ要確認理由を含む
    - empty_draft: 読み取り不能PDF等で中身が空の下書きだけが起票された（outcome="failed"）

    PR-1 では pending は経過時間を問わず failed とする。パースキュー待ちの行が一時的に
    failed 表示になり得るが、次サイクルで created/skipped に遷移する。猶予時間や
    「処理待ち」の第4状態への切り出しは PR-3 の検討事項（Issue #422）。
    """
    reason_set = set(parse_log_reasons)
    has_fail_reason = bool(reason_set & EMAIL_INTAKE_FAIL_REASONS)

    if parse_status == "pending" or has_fail_reason:
        # 読み取り不能PDFは product_id/quantity/deadline すべて NULL の空下書きを
        # 1件起票する（_process_unreadable_pdf）。中身が空なので failed に寄せ、
        # 起票済みの下書きへ導線を残すため empty_draft フラグで示す。
        return "failed", False, has_fail_reason and created_order_count > 0

    if created_order_count == 0 and "invalid_quantity" in reason_set:
        return "failed", False, False

    if created_order_count >= 1:
        needs_attention = bool(reason_set & EMAIL_INTAKE_ATTENTION_REASONS)
        return "created", needs_attention, False

    # 正常に処理され、意図的に起票しなかった(重複・対象外、または理由ログなしの起票0件)
    return "skipped", False, False
