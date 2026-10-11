/**
 * 社内転送者（Issue #521）
 *
 * 社長など、注文書を受注取り込み用アドレスへ転送してくる社内のメールアドレス。
 * 登録したアドレスからのメールは、差出人で顧客を突合・作成しない（顧客は添付の
 * 注文書の会社名・FAX 番号から決め、決まらなければ顧客不明で起票する）。
 */
export interface InternalSender {
  id: string
  email: string
  created_at: string
}

export interface InternalSenderCreate {
  email: string
}
