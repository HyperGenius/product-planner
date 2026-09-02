import os
from typing import Any, cast

import anthropic

_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

_EXTRACT_TOOL: Any = {
    "name": "extract_email_order_lines",
    "description": (
        "メール本文から注文明細行を抽出する。"
        "1通のメールに複数品番・複数納期・複数の確度（確定/内示/内々示）の明細が"
        "含まれる場合（例: 品番ごとに複数月分の内示数量が並ぶ表）、行ごとに分けて返すこと。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "document_order_no": {
                "type": ["string", "null"],
                "description": (
                    "文書レベルの注文番号／注文No.。メール全体に対して1つ振られている"
                    "番号（件名・本文の「注文番号」「注文No.」等）。無ければ null。"
                ),
            },
            "line_items": {
                "type": "array",
                "description": (
                    "メール本文内の注文明細行の配列。注文情報が見つからない場合は空配列。"
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "product_name_raw": {
                            "type": ["string", "null"],
                            "description": "製品名・型番・品番等の文字列。不明な場合はnull",
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
                            "description": "希望納期 (ISO 8601: YYYY-MM-DD)。不明な場合はnull",
                        },
                        "line_order_no": {
                            "type": ["string", "null"],
                            "description": (
                                "明細レベルの注文No.。1通のメール内で明細ごとに"
                                "異なる注文No.が振られている場合に使用する"
                                "（多くの顧客は持たないため null）。"
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
                                "文言（確定/内示/内々示、PO番号の有無等）を根拠に判定すること。"
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
                },
            },
        },
        "required": ["document_order_no", "line_items"],
    },
}


def extract_email_order_lines(
    body: str, customer_extraction_prompt: str | None = None
) -> dict[str, Any]:
    """
    メール本文から注文番号（文書レベル）と注文明細行を抽出する。

    customer_extraction_prompt が渡された場合（customers.order_extraction_prompt）、
    汎用プロンプトの末尾に「顧客固有の抽出指示」として追記する。ツールスキーマは
    変更せず、あくまで自然言語の指示のみ。

    戻り値: {"document_order_no": str | None, "line_items": list[dict]}
    """
    model = os.environ.get("EMAIL_EXTRACTION_MODEL", "claude-haiku-4-5-20251001")
    prompt = "以下のメール本文から注文番号（文書レベル）と注文明細を抽出してください。"
    if customer_extraction_prompt and customer_extraction_prompt.strip():
        prompt += (
            f"\n\n【この顧客固有の抽出指示】\n{customer_extraction_prompt.strip()}"
        )
    prompt += f"\n\n{body}"

    response = _client.messages.create(
        model=model,
        max_tokens=1024,
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_email_order_lines"},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_email_order_lines":
            data = cast(dict[str, Any], block.input)
            line_items = data.get("line_items")
            document_order_no = data.get("document_order_no")
            return {
                "document_order_no": (
                    document_order_no if isinstance(document_order_no, str) else None
                ),
                # ツールスキーマ上は list だが、LLM が null/不正型を返しても
                # 呼び出し側（list 前提）が壊れないよう空配列にフォールバックする
                "line_items": line_items if isinstance(line_items, list) else [],
            }
    return {"document_order_no": None, "line_items": []}
