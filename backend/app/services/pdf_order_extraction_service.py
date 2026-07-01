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
                        "certainty",
                    ],
                },
            },
        },
        "required": ["line_items"],
    },
}


def extract_order_lines(pdf_text: str) -> list[dict[str, Any]]:
    model = os.environ.get("PDF_EXTRACTION_MODEL", "claude-sonnet-5")
    response = _client.messages.create(
        model=model,
        max_tokens=4096,
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_order_lines"},
        messages=[
            {
                "role": "user",
                "content": (
                    "以下は受注PDFから抽出したテキストです。"
                    "明細行ごとに品番・品名・数量・納期・確度を抽出してください。\n\n"
                    f"{pdf_text}"
                ),
            }
        ],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_order_lines":
            return cast(list[dict[str, Any]], block.input.get("line_items", []))
    return []
