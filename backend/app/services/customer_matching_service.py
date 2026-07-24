import re
from datetime import UTC, datetime
from typing import Any, cast

from app.repositories.supa_infra.common.table_name import SupabaseTableName
from app.utils.calendar import JST
from app.utils.logger import get_logger
from supabase import Client

logger = get_logger(__name__)

# Matches forwarded message headers in both English and Japanese:
#   "From: Name <addr@example.com>"  or  "差出人: addr@example.com"
_FORWARDED_EMAIL_RE = re.compile(
    r"(?:From|差出人)\s*:.*?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})",
    re.IGNORECASE,
)

# メールアドレス全般にマッチする正規表現（ヘッダー行に依存しないフォールバック抽出用）。
# 「直接転送」形式などヘッダー行自体が本文に残らない場合、署名欄のメールアドレスを
# 直接検出する。
_ANY_EMAIL_RE = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
)

# 日本のビジネスメール署名でよく使われる罫線区切り（"---" 等）
_SIGNATURE_SEPARATOR_RE = re.compile(r"^[-=_ー―−‐]{5,}$")
_COMPANY_KEYWORDS_RE = re.compile(r"(株式会社|有限会社|合同会社|合資会社|㈱|㈲)")
# 住所・電話・メールなど、会社名/氏名の行から除外する行
_CONTACT_LINE_RE = re.compile(r"(TEL|FAX|〒|e-mail|email)", re.IGNORECASE)


def extract_sender_email_candidates(body: str) -> list[str]:
    """本文中の "From:"/"差出人:" 行にマッチする全メールアドレスを出現順・重複排除で返す。

    多段転送・返信の引用が重なっている場合、本文中には複数のヘッダが出現しうるため、
    1件に絞り込まず候補集合として返す（呼び出し元で既存顧客との突合に使う）。
    """
    seen: set[str] = set()
    candidates: list[str] = []
    for m in _FORWARDED_EMAIL_RE.finditer(body):
        email = m.group(1)
        if email not in seen:
            seen.add(email)
            candidates.append(email)
    return candidates


def extract_sender_email(body: str) -> str | None:
    # 候補が複数ある場合、一番奥（最初にメールを書いた本人）が実際の顧客であることが
    # 多いため、最後に出現したものを採用する。
    candidates = extract_sender_email_candidates(body)
    return candidates[-1] if candidates else None


def extract_body_email_candidates(body: str) -> list[str]:
    """本文全体に出現するメールアドレスを出現順・重複排除で返す。

    メーラーの「転送」機能を介さず直接転送された場合など、"From:"/"差出人:" と
    いったヘッダー行自体が本文にテキスト化されないケースがある。その場合の
    フォールバックとして、署名欄などに書かれたメールアドレスを直接検出する。
    """
    seen: set[str] = set()
    candidates: list[str] = []
    for m in _ANY_EMAIL_RE.finditer(body):
        email = m.group(0)
        if email not in seen:
            seen.add(email)
            candidates.append(email)
    return candidates


def extract_email_address(text: str) -> str | None:
    """任意の文字列（メールヘッダーの値など）から最初のメールアドレスを抽出する。"""
    match = _ANY_EMAIL_RE.search(text)
    return match.group(0) if match else None


def extract_effective_sender_email(
    body: str, real_from_email: str | None = None
) -> str | None:
    """`resolve_or_create_customer` と同じ優先順位で解決した送信者アドレスを返す
    （通知payload等の表示用）。

    優先順位: 本文中の転送ヘッダー行 → 実際のGmail Fromヘッダー → 本文全体
    """
    header_candidates = extract_sender_email_candidates(body)
    if header_candidates:
        return header_candidates[-1]
    if real_from_email:
        return real_from_email
    candidates = extract_body_email_candidates(body)
    return candidates[-1] if candidates else None


def extract_customer_name(body: str, email: str) -> str | None:
    """email が記載された署名ブロックから会社名（取得できれば氏名も併記）を抽出する。

    見つからない場合は None を返す（呼び出し元でメールアドレスにフォールバックする）。
    """
    lines = body.splitlines()
    # 署名欄は本文の後方に現れることが多く、かつヘッダ行の "From:" にも同じ
    # アドレスが再掲されることがあるため、最後に出現した行を署名ブロックとみなす
    matching_indices = [i for i, line in enumerate(lines) if email in line]
    if not matching_indices:
        return None
    email_idx = matching_indices[-1]

    # 署名ブロックの開始位置: 直前の罫線区切りがあればそこから、なければ最大40行遡る
    # （Outlook由来の署名は1行ごとに空行を挟むことが多く、実質の行数以上に遡る必要がある）
    search_floor = max(0, email_idx - 40)
    start = search_floor
    for i in range(email_idx - 1, search_floor - 1, -1):
        if _SIGNATURE_SEPARATOR_RE.match(lines[i].strip()):
            start = i + 1
            break

    block = [line.strip() for line in lines[start:email_idx] if line.strip()]

    company_name: str | None = None
    person_name: str | None = None
    for line in block:
        if _CONTACT_LINE_RE.search(line) or re.search(r"\d", line):
            continue
        if company_name is None and _COMPANY_KEYWORDS_RE.search(line):
            company_name = line
            continue
        if company_name is not None:
            # 「部署名　　氏名」のように全角/半角スペースで区切られた末尾を氏名候補とする。
            # 会社名の下に部署名が複数行続き、氏名は住所欄の直前に来ることが多いため、
            # 該当する行が見つかるたびに更新し、最後に見つかったものを採用する。
            segments = re.split(r"[ 　]{2,}", line)
            candidate = segments[-1].strip() if segments else line
            if candidate and not _COMPANY_KEYWORDS_RE.search(candidate):
                person_name = candidate

    if company_name and person_name:
        return f"{company_name} {person_name}"
    return company_name


def _placeholder_customer_name(received_at: str | int | None) -> str:
    """メールの受信日時（Gmail internalDate、epoch millis）から仮の顧客名を組み立てる。

    実行ホストのタイムゾーンに関わらず、表示はJST（日本のユーザー向け）で
    統一するため、UTCとして解釈した上でJSTへ変換する。
    """
    dt = datetime.now(JST)
    if received_at is not None:
        try:
            dt = datetime.fromtimestamp(int(received_at) / 1000, tz=UTC).astimezone(JST)
        except (ValueError, TypeError, OSError):
            pass
    return f"不明な顧客 ({dt.strftime('%Y-%m-%d %H:%M')})"


def _resolve_or_create_by_single_email(
    db: Client,
    tenant_id: str,
    email: str | None,
    received_at: str | int | None,
    name_hint: str | None,
) -> tuple[int, bool]:
    """
    メールアドレス1件で顧客を検索し、存在すれば customer_id を返す（status は変更しない）。
    存在しなければ status='draft' の下書き顧客を自動作成して返す。
    email が None の場合は既存顧客と紐付けようがないため、常に新規の下書き顧客を作成する
    （name は受信日時ベースのプレースホルダー）。
    name_hint（署名ブロックから抽出した会社名/氏名）が渡された場合は、新規作成時の
    name にそれを使う。渡されない場合は email をそのまま name とする。

    Returns: (customer_id, 新規に下書き作成したかどうか)
    """
    table = SupabaseTableName.CUSTOMERS.value

    if email:
        result = (
            db.table(table)
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("email", email)
            .limit(1)
            .execute()
        )
        rows = cast(list[dict[str, Any]], result.data or [])
        if rows:
            logger.info(f"customer found: id={rows[0]['id']} email={email}")
            return int(rows[0]["id"]), False

    insert_row: dict[str, Any] = {
        "tenant_id": tenant_id,
        "name": name_hint
        or (email if email else _placeholder_customer_name(received_at)),
        "status": "draft",
    }
    if email:
        insert_row["email"] = email

    created = db.table(table).insert(insert_row).execute()
    created_rows = cast(list[dict[str, Any]], created.data or [])
    new_id = int(created_rows[0]["id"])
    logger.info(f"draft customer auto-created: id={new_id} email={email}")
    return new_id, True


def resolve_or_create_customer(
    db: Client,
    tenant_id: str,
    body: str,
    received_at: str | int | None = None,
    real_from_email: str | None = None,
) -> tuple[int, bool]:
    """
    本文から抽出した候補メールアドレス群と既存顧客（customers.email）を突合し、
    customer_id を解決する。

    - "From:"/"差出人:" ヘッダー行が本文に存在しない場合（転送を介さず顧客から直接
      届いたメール等）は、実際のGmailメッセージの `From` ヘッダー（`real_from_email`）
      と `customers.email` の突合を最優先で試みる。一致すればそのまま確定する
      （本文解析は行わない）
    - 上記で一致しない場合、候補メールアドレス群（ヘッダー行が本文にあればそれを、
      なければ本文全体から検出したものを）と既存顧客の積集合を取る
      - 積集合が1件 → その顧客にマッチ確定
        （name抽出は行わない。status/nameも変更しない）
      - 積集合が0件（完全新規）または2件以上（相見積もり等で判定不能）の場合は、
        メールアドレス単体の検索/下書き作成にフォールバックする。フォールバック先の
        メールアドレスは候補集合のうち「最後に出現したもの」を優先し、候補が
        1件も無い場合のみ `real_from_email` を使う。候補集合を優先するのは、
        Issue #298 の「直接転送」（社内担当者が転送機能を介さずに送信し直したため
        ヘッダー行が本文化されないケース）では実際の Gmail `From` ヘッダーが
        社内担当者のアドレスになり、本文の署名欄の方が信頼できるため
        （0件の場合のみ署名ブロックから customer_name を抽出し、下書きのnameに使う）

    Returns: (customer_id, 新規に下書き作成したかどうか)
    """
    table = SupabaseTableName.CUSTOMERS.value
    header_candidates = extract_sender_email_candidates(body)

    if not header_candidates and real_from_email:
        result = (
            db.table(table)
            .select("id")
            .eq("tenant_id", tenant_id)
            .eq("email", real_from_email)
            .limit(1)
            .execute()
        )
        rows = cast(list[dict[str, Any]], result.data or [])
        if rows:
            customer_id = int(rows[0]["id"])
            logger.info(
                f"customer found via real From header match: id={customer_id} "
                f"email={real_from_email}"
            )
            return customer_id, False

    candidates = header_candidates or extract_body_email_candidates(body)

    if candidates:
        result = (
            db.table(table)
            .select("id")
            .eq("tenant_id", tenant_id)
            .in_("email", candidates)
            .execute()
        )
        rows = cast(list[dict[str, Any]], result.data or [])
        if len(rows) == 1:
            customer_id = int(rows[0]["id"])
            logger.info(
                f"customer found via candidate match: id={customer_id} "
                f"candidates={candidates}"
            )
            return customer_id, False

    email: str | None
    if candidates:
        email = candidates[-1]
    else:
        email = real_from_email
    name_hint = extract_customer_name(body, email) if email else None
    return _resolve_or_create_by_single_email(
        db, tenant_id, email, received_at, name_hint
    )
