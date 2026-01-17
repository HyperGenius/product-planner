# utils/logger.py
import json
import logging
import os
import sys

# 環境変数からログレベルを取得 (デフォルトは INFO)
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

# 環境変数から環境を取得 (デフォルトは Development)
AZURE_FUNCTIONS_ENVIRONMENT = os.environ.get(
    "AZURE_FUNCTIONS_ENVIRONMENT", "Development"
)


class JsonFormatter(logging.Formatter):
    """本番用のJSONフォーマッタ"""

    def format(self, record):
        log_record = {
            "level": record.levelname,
            "message": record.getMessage(),
            "time": self.formatTime(record, self.datefmt),
            "name": record.name,
            "func": record.funcName,
            # 必要であれば以下も追加
            # "trace_id": ...,
        }
        if record.exc_info:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)


def get_logger(name: str):
    logger = logging.getLogger(name)

    # 既にハンドラが設定されている場合は重複を防ぐ
    if logger.handlers:
        return logger

    # ログレベル, ハンドラを設定
    logger.setLevel(LOG_LEVEL)
    handler = logging.StreamHandler(sys.stdout)

    # 環境によってフォーマットを切り替え
    env = AZURE_FUNCTIONS_ENVIRONMENT

    if env == "Development":
        # 開発時: 見やすいテキスト形式
        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] %(name)s: %(message)s"
        )
    else:
        # 本番時: 解析しやすいJSON形式 (Application Insights向け)
        formatter = JsonFormatter()

    handler.setFormatter(formatter)
    logger.addHandler(handler)

    return logger
