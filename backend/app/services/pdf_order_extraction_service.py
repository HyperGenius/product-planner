import base64
import copy
import json
import os
from typing import Any

import anthropic

from app.utils.logger import get_logger

logger = get_logger(__name__)

_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# 構造化出力（output_config.format）用の JSON Schema。
# 以前は強制ツール呼び出し（tool_choice={"type": "tool"}）で JSON を整形していたが、
# 純粋な抽出用途なので構造化出力へ移行した（Issue #420）。
# strict な構造化出力では各 object 階層に additionalProperties: false が必要。
_EXTRACT_SCHEMA: Any = {
    "type": "object",
    "properties": {
        "document_order_no": {
            "type": ["string", "null"],
            "description": (
                "文書レベルの注文番号／注文No.（例:「注文番号: C1868」）。"
                "1つの注文書全体に対して1つ振られている番号。"
                "文書内に見当たらない場合は null。"
            ),
        },
        "line_items": {
            "type": "array",
            "description": (
                "PDF内の明細行の配列。明細が見つからない場合は空配列。"
                "1つのPDFに複数品番・複数納期・複数の確度（確定/内示/内々示）の"
                "明細が含まれる場合、行ごとに分けて返すこと。"
            ),
            "items": {
                "type": "object",
                "properties": {
                    "product_name_raw": {
                        "type": ["string", "null"],
                        "description": "製品名（型番・仕様を含む原文表記）。不明な場合はnull",
                    },
                    "product_number_raw": {
                        "type": ["string", "null"],
                        "description": "品番。不明な場合はnull",
                    },
                    "quantity": {
                        "type": ["integer", "null"],
                        "description": "数量（整数）。不明な場合はnull",
                    },
                    "delivery_date": {
                        "type": ["string", "null"],
                        "description": "納期 (ISO 8601: YYYY-MM-DD)。不明な場合はnull",
                    },
                    "line_order_no": {
                        "type": ["string", "null"],
                        "description": (
                            "明細レベルの注文No.。1つの注文書内で明細ごとに"
                            "異なる注文No.が振られている場合に使用する"
                            "（多くの顧客は明細レベルの番号を持たないため null）。"
                        ),
                    },
                    "certainty": {
                        "type": "string",
                        "enum": ["confirmed", "forecast", "forecast_tentative"],
                        "description": (
                            "明細の確度。"
                            "confirmed=確定納期・確定発注書番号(PO番号)が明記されている確定分、"
                            "forecast=「内示」「見込み」等、確定していないが具体的な数量・納期が"
                            "提示されている分、"
                            "forecast_tentative=「内々示」「予定」等、さらに不確実性が高い先の見込み分。"
                            "表・見出し・注記の文言（確定/内示/内々示、PO番号の有無等）を根拠に判定すること。"
                        ),
                    },
                },
                "required": [
                    "product_name_raw",
                    "product_number_raw",
                    "quantity",
                    "delivery_date",
                    "line_order_no",
                    "certainty",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["document_order_no", "line_items"],
    "additionalProperties": False,
}


def _build_prompt(lead: str, customer_extraction_prompt: str | None) -> str:
    """汎用の抽出指示に、顧客固有の抽出指示（あれば）を追記する。"""
    prompt = lead
    if customer_extraction_prompt and customer_extraction_prompt.strip():
        prompt += (
            f"\n\n【この顧客固有の抽出指示】\n{customer_extraction_prompt.strip()}"
        )
    return prompt


def _parse_response(response: Any) -> dict[str, Any]:
    """構造化出力のレスポンスを dict に戻す。

    output_config.format 指定時は最初の text ブロックに valid JSON が入るが、
    モデル都合で非JSON／dict以外が返っても呼び出し側（dict/list 前提）が壊れないよう
    空結果へフォールバックする（旧・強制ツール呼び出し時の未検出フォールバックと同じ挙動）
    """
    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        parsed = json.loads(text) if text else None
    except json.JSONDecodeError:
        parsed = None
    return parsed if isinstance(parsed, dict) else {}


def _normalize_result(data: dict[str, Any]) -> dict[str, Any]:
    line_items = data.get("line_items")
    document_order_no = data.get("document_order_no")
    return {
        "document_order_no": (
            document_order_no if isinstance(document_order_no, str) else None
        ),
        # スキーマ上は list だが、LLM が null/不正型を返しても
        # 呼び出し側（list 前提）が壊れないよう空配列にフォールバックする
        "line_items": line_items if isinstance(line_items, list) else [],
    }


def extract_order_lines(
    pdf_text: str, customer_extraction_prompt: str | None = None
) -> dict[str, Any]:
    """
    受注PDFのテキストから注文番号（文書レベル）と明細行を抽出する。

    customer_extraction_prompt が渡された場合（顧客ごとの
    customers.order_extraction_prompt）、汎用プロンプトの末尾に「顧客固有の抽出指示」
    として追記する。抽出スキーマは変更せず、あくまで自然言語の指示のみ。

    戻り値: {"document_order_no": str | None, "line_items": list[dict]}
    """
    model = os.environ.get("PDF_EXTRACTION_MODEL", "claude-sonnet-5")
    prompt = _build_prompt(
        "以下は受注PDFから抽出したテキストです。"
        "文書レベルの注文番号(document_order_no)と、明細行ごとに"
        "品番・品名・数量・納期・確度、および明細レベルの注文No.(line_order_no)を"
        "抽出してください。",
        customer_extraction_prompt,
    )
    prompt += f"\n\n{pdf_text}"

    response = _client.messages.create(
        model=model,
        max_tokens=4096,
        output_config={
            "format": {
                "type": "json_schema",
                "schema": _EXTRACT_SCHEMA,
            }
        },
        messages=[{"role": "user", "content": prompt}],
    )
    return _normalize_result(_parse_response(response))


# 画像PDF用のスキーマ。テキストPDFと同じ項目に、顧客を解決し直すための発行元の
# 会社名を足す。テキストPDFは文面テキストそのもので顧客を照合する（Issue #385）が、
# 画像PDFには照合に使える文面テキストが無いため、モデルに読み取らせる（Issue #520）。
_IMAGE_EXTRACT_SCHEMA: Any = copy.deepcopy(_EXTRACT_SCHEMA)
_IMAGE_EXTRACT_SCHEMA["properties"]["issuer_company_name"] = {
    "type": ["string", "null"],
    "description": (
        "この注文書を発行した会社（発注元）の会社名。"
        "宛先・送付先として記載されている受注側の会社名ではない。"
        "FAXの送信元ヘッダーや社印・署名欄に会社名がある場合はそれを使う。"
        "読み取れない場合は null。"
    ),
}
_IMAGE_EXTRACT_SCHEMA["properties"]["issuer_fax_number"] = {
    "type": ["string", "null"],
    "description": (
        "注文書の発行元（発注元）の FAX 番号。FAX 受信の場合はページ上端の送信元"
        "ヘッダー行の番号を優先する。宛先・送付先（受注側）の FAX 番号ではない。"
        "読み取れない場合は null。"
    ),
}
_IMAGE_EXTRACT_SCHEMA["properties"]["issuer_phone_number"] = {
    "type": ["string", "null"],
    "description": (
        "注文書の発行元（発注元）の電話番号（TEL）。"
        "宛先・送付先（受注側）の電話番号ではない。読み取れない場合は null。"
    ),
}
_IMAGE_EXTRACT_SCHEMA["required"] = [
    *_EXTRACT_SCHEMA["required"],
    "issuer_company_name",
    "issuer_fax_number",
    "issuer_phone_number",
]


class PdfDocumentRejectedError(Exception):
    """Claude API が PDF を処理できない文書として拒否した（再試行しても通らない）。"""


def extract_order_lines_from_pdf(
    pdf_content: bytes, customer_extraction_prompt: str | None = None
) -> dict[str, Any]:
    """
    テキストを持たない画像PDF（FAX受信・スキャン）を PDF のまま Claude に渡し、
    注文番号（文書レベル）・明細行・発行元の会社名と FAX・電話番号を抽出する
    （Issue #520。FAX・電話番号は顧客の照合用、Issue #521 / #524）。

    PDFの `document` ブロックはページを画像として読むため、pdfplumber で
    1文字も取れない PDF でも中身を読める。

    - API が文書を受け付けない（400 / 413 / 422）場合は PdfDocumentRejectedError を
      送出する。呼び出し側は読み取り不能PDFとして扱う
    - レート制限・5xx・接続エラー等の一時的な失敗はそのまま送出する（cron の次回
      実行でステージング行を再処理させる。テキストPDFの抽出と同じ扱い）
    - 拒否（stop_reason='refusal'）・出力打ち切りは空結果として返す

    戻り値: {"document_order_no": str | None, "line_items": list[dict],
             "issuer_company_name": str | None, "issuer_fax_number": str | None,
             "issuer_phone_number": str | None}
    """
    # FAX は解像度が低く数字の読み違いが起きやすいため、テキストPDFとは別に
    # 読み取り精度を優先したモデルを設定できるようにする
    model = os.environ.get("PDF_IMAGE_EXTRACTION_MODEL", "claude-opus-5-5")
    prompt = _build_prompt(
        "添付は受注の注文書PDF（FAX受信やスキャンによる画像）です。"
        "文書レベルの注文番号(document_order_no)、注文書の発行元の会社名"
        "(issuer_company_name)・FAX番号(issuer_fax_number)・"
        "電話番号(issuer_phone_number)と、"
        "明細行ごとに品番・品名・数量・納期・確度、"
        "および明細レベルの注文No.(line_order_no)を抽出してください。"
        "かすれ・つぶれで判読できない値は推測で埋めず null にしてください。",
        customer_extraction_prompt,
    )

    try:
        response = _client.messages.create(
            model=model,
            max_tokens=16000,
            output_config={
                "format": {
                    "type": "json_schema",
                    "schema": _IMAGE_EXTRACT_SCHEMA,
                }
            },
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": base64.standard_b64encode(pdf_content).decode(
                                    "ascii"
                                ),
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )
    except (
        anthropic.BadRequestError,
        anthropic.RequestTooLargeError,
        anthropic.UnprocessableEntityError,
    ) as exc:
        raise PdfDocumentRejectedError(
            f"Claude API rejected the PDF (status={exc.status_code})"
        ) from exc

    if response.stop_reason in ("refusal", "max_tokens"):
        logger.warning(
            "pdf_order_extraction: image PDF extraction stopped "
            f"(stop_reason={response.stop_reason})"
        )
        return {
            "document_order_no": None,
            "line_items": [],
            "issuer_company_name": None,
            "issuer_fax_number": None,
            "issuer_phone_number": None,
        }

    data = _parse_response(response)
    return {
        **_normalize_result(data),
        "issuer_company_name": _optional_str(data.get("issuer_company_name")),
        "issuer_fax_number": _optional_str(data.get("issuer_fax_number")),
        "issuer_phone_number": _optional_str(data.get("issuer_phone_number")),
    }


def _optional_str(value: Any) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
