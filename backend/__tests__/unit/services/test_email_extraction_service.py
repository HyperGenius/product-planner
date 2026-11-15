import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from app.services.email_extraction_service import extract_email_order_lines


def _response(payload):
    return SimpleNamespace(
        content=[SimpleNamespace(type="text", text=json.dumps(payload))]
    )


def _extract(payload):
    with patch("app.services.email_extraction_service._client") as client:
        client.messages.create.return_value = _response(payload)
        result = extract_email_order_lines("本文")
        return result, client.messages.create.call_args.kwargs


@pytest.mark.unit
class TestEmailIntent:
    @pytest.mark.parametrize("intent", ["delivery_chase", "split_delivery", "other"])
    def test_known_intent_is_returned(self, intent):
        result, _ = _extract(
            {"document_order_no": None, "email_intent": intent, "line_items": []}
        )
        assert result["email_intent"] == intent

    @pytest.mark.parametrize("intent", [None, "", "unknown", 1])
    def test_missing_or_invalid_intent_falls_back_to_new_order(self, intent):
        result, _ = _extract(
            {"document_order_no": None, "email_intent": intent, "line_items": []}
        )
        assert result["email_intent"] == "new_order"

    def test_schema_requires_email_intent(self):
        _, kwargs = _extract({"document_order_no": None, "line_items": []})
        schema = kwargs["output_config"]["format"]["schema"]
        assert "email_intent" in schema["required"]
        assert "delivery_chase" in schema["properties"]["email_intent"]["enum"]

    def test_prompt_tells_model_to_ignore_quoted_history_and_treat_reply_as_chase(
        self,
    ):
        """返信の引用を注文として読まない指示がプロンプトとスキーマ説明に入っている。"""
        _, kwargs = _extract(
            {"document_order_no": None, "email_intent": "other", "line_items": []}
        )
        prompt = kwargs["messages"][0]["content"]
        assert "引用" in prompt and "delivery_chase" in prompt
        schema = kwargs["output_config"]["format"]["schema"]
        assert "注文書を送付済み" in schema["properties"]["email_intent"]["description"]


@pytest.mark.unit
class TestForecastPeriod:
    def test_schema_and_prompt_include_forecast_period(self):
        """内示の期間（Issue #676）を明細の必須項目として求める。"""
        _, kwargs = _extract(
            {"document_order_no": None, "email_intent": "new_order", "line_items": []}
        )
        line_schema = kwargs["output_config"]["format"]["schema"]["properties"][
            "line_items"
        ]["items"]
        assert {"forecast_period_start", "forecast_period_end"} <= set(
            line_schema["required"]
        )
        assert set(line_schema["required"]) == set(line_schema["properties"])
        assert "forecast_period_start" in kwargs["messages"][0]["content"]
