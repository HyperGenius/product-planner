import os
from typing import Any, cast

import anthropic

_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

_EXTRACT_TOOL: Any = {
    "name": "extract_order_lines",
    "description": (
        "受注PDFのテキストから明細行を抽出する。"
        "1つのPDFに複数品番・複数納期・複数の確度（確定/内示/内々示）の明細が"
        "含まれる場合、行ごとに分けて返すこと。"
    ),
    "input_schema": {
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
                "description": "PDF内の明細行の配列。明細が見つからない場合は空配列。",
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
                },
            },
        },
        "required": ["document_order_no", "line_items"],
    },
}


def extract_order_lines(
    pdf_text: str, customer_extraction_prompt: str | None = None
) -> dict[str, Any]:
    """
    受注PDFのテキストから注文番号（文書レベル）と明細行を抽出する。

    customer_extraction_prompt が渡された場合（顧客ごとの
    customers.order_extraction_prompt）、汎用プロンプトの末尾に「顧客固有の抽出指示」
    として追記する。ツールスキーマは変更せず、あくまで自然言語の指示のみ。

    戻り値: {"document_order_no": str | None, "line_items": list[dict]}
    """
    model = os.environ.get("PDF_EXTRACTION_MODEL", "claude-sonnet-5")
    prompt = (
        "以下は受注PDFから抽出したテキストです。"
        "文書レベルの注文番号(document_order_no)と、明細行ごとに"
        "品番・品名・数量・納期・確度、および明細レベルの注文No.(line_order_no)を"
        "抽出してください。"
    )
    if customer_extraction_prompt and customer_extraction_prompt.strip():
        prompt += (
            f"\n\n【この顧客固有の抽出指示】\n{customer_extraction_prompt.strip()}"
        )
    prompt += f"\n\n{pdf_text}"

    response = _client.messages.create(
        model=model,
        max_tokens=4096,
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_order_lines"},
        messages=[{"role": "user", "content": prompt}],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_order_lines":
            data = cast(dict[str, Any], block.input)
            return {
                "document_order_no": data.get("document_order_no"),
                "line_items": data.get("line_items", []),
            }
    return {"document_order_no": None, "line_items": []}
