import os
from typing import Any

import anthropic

_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

_EXTRACT_TOOL: Any = {
    "name": "extract_order_fields",
    "description": "メール本文から注文情報を抽出する",
    "input_schema": {
        "type": "object",
        "properties": {
            "product_name": {
                "type": ["string", "null"],
                "description": "製品名・型番・品番等の文字列。見つからない場合はnull",
            },
            "quantity": {
                "type": ["integer", "null"],
                "description": "注文数量（整数）。見つからない場合はnull",
            },
            "deadline_date": {
                "type": ["string", "null"],
                "description": "希望納期 (ISO 8601: YYYY-MM-DD)。見つからない場合はnull",
            },
            "order_number": {
                "type": ["string", "null"],
                "description": "顧客注文番号・発注番号。見つからない場合はnull",
            },
        },
        "required": ["product_name", "quantity", "deadline_date", "order_number"],
    },
}


def extract_email_fields(body: str) -> dict:
    model = os.environ.get("EMAIL_EXTRACTION_MODEL", "claude-haiku-4-5-20251001")
    response = _client.messages.create(
        model=model,
        max_tokens=512,
        tools=[_EXTRACT_TOOL],
        tool_choice={"type": "tool", "name": "extract_order_fields"},
        messages=[
            {
                "role": "user",
                "content": f"以下のメール本文から注文情報を抽出してください。\n\n{body}",
            }
        ],
    )
    for block in response.content:
        if block.type == "tool_use" and block.name == "extract_order_fields":
            return block.input
    return {
        "product_name": None,
        "quantity": None,
        "deadline_date": None,
        "order_number": None,
    }
