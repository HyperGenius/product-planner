"""製品の類似警告（Issue #516）の API スキーマ。"""

from pydantic import BaseModel, Field


class SimilarProduct(BaseModel):
    """品名の直径・長さ・材質が入力と一致する既存製品。"""

    id: int
    name: str
    code: str | None
    is_active: bool
    prefix: str = Field(description="品名の先頭の接頭辞（無ければ空文字）")
    prefix_differs: bool = Field(
        description="入力の品名と接頭辞が違うか（顧客ごとの別製品の可能性。画面で目立たせる）"
    )
    has_process: bool = Field(description="工程が登録されているか")
    has_unconfirmed_process: bool = Field(description="未確定の工程があるか")


class SimilarProductsResponse(BaseModel):
    products: list[SimilarProduct]
