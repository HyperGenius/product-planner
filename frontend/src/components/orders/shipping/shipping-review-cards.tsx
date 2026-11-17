"use client"

import { cn } from "@/lib/utils"
import type { ShippingCard } from "@/lib/shipping-review-utils"

/** 選択中のカードの詳細パネルの要素 ID。カードの `aria-controls` に使う */
export const SHIPPING_PANEL_ID = "shipping-panel"

/** カードと詳細パネルの上辺の色（照合状況・起票の確認と同じ見た目） */
export const SHIPPING_CARD_STYLE: Record<ShippingCard, { stripe: string; ring: string }> = {
  candidates: { stripe: "border-t-blue-500", ring: "ring-blue-500" },
  review: { stripe: "border-t-amber-400", ring: "ring-amber-400" },
}

interface ShippingReviewCardsProps {
  /** 送品の候補の数。読み込み中は null */
  candidateCount: number | null
  /** 要確認の数（直す単位）。読み込み中・取得失敗は null */
  reviewCount: number | null
  selected: ShippingCard
  onSelect: (card: ShippingCard) => void
}

/**
 * 送品の消し込みのカード（Issue #682）。押すと下にそのカードの詳細だけを出す。
 * サイドバーの件数バッジは出さない（Epic #679 の方針）
 */
export function ShippingReviewCards({
  candidateCount,
  reviewCount,
  selected,
  onSelect,
}: ShippingReviewCardsProps) {
  const cards: { key: ShippingCard; label: string; count: number | null; sub: string }[] = [
    {
      key: "candidates",
      label: "送品の候補",
      count: candidateCount,
      sub: "弥生で送品を確かめて送品済みにする注文",
    },
    {
      key: "review",
      label: "要確認",
      count: reviewCount,
      sub: "受注に当たらない弥生の明細・日報が追いついていない注文",
    },
  ]

  return (
    <div className="flex flex-wrap items-stretch gap-2.5" role="group" aria-label="確認する内容">
      {cards.map((card) => {
        const style = SHIPPING_CARD_STYLE[card.key]
        const isSelected = selected === card.key
        return (
          <button
            key={card.key}
            type="button"
            aria-pressed={isSelected}
            aria-controls={SHIPPING_PANEL_ID}
            aria-label={`${card.label} ${card.count ?? "－"}件`}
            className={cn(
              "flex min-w-[11rem] flex-1 flex-col gap-0.5 rounded-lg border border-t-[5px] bg-card px-3 py-2 text-left hover:bg-accent sm:max-w-xs",
              style.stripe,
              isSelected && `bg-accent ring-2 ${style.ring}`,
            )}
            onClick={() => onSelect(card.key)}
          >
            <span className="text-sm text-muted-foreground">{card.label}</span>
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                (card.count ?? 0) === 0 && "text-muted-foreground",
              )}
            >
              {card.count ?? "－"}
              <span className="ml-1 text-sm font-normal">件</span>
            </span>
            <span className="text-xs text-muted-foreground">{card.sub}</span>
          </button>
        )
      })}
    </div>
  )
}
