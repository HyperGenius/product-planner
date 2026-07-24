import * as React from "react"

/**
 * Dialog(react-remove-scrollのスクロールロック)にPortal経由で描画された
 * 要素はマウスホイールでのスクロールが無効化されるため、ネイティブのnon-passive
 * wheelリスナーで手動スクロールして迂回する。
 *
 * スクロール端に達していて実際にスクロールできない場合や ctrlKey 押下時
 * (ブラウザのピンチズーム)は何もしない。これにより親要素へのスクロール
 * チェーンやズーム操作を妨げない。
 */
export function useWheelScrollFallback<T extends HTMLElement>(
  ref: React.RefObject<T | null>
) {
  React.useEffect(() => {
    const node = ref.current
    if (!node) return

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return

      const lineHeight = 16
      const delta =
        event.deltaMode === 1
          ? event.deltaY * lineHeight
          : event.deltaMode === 2
            ? event.deltaY * node.clientHeight
            : event.deltaY

      const { scrollTop, scrollHeight, clientHeight } = node
      const atTop = scrollTop <= 0
      const atBottom = scrollTop + clientHeight >= scrollHeight

      if ((delta < 0 && atTop) || (delta > 0 && atBottom)) return

      node.scrollTop += delta
      event.preventDefault()
    }

    node.addEventListener("wheel", handleWheel, { passive: false })
    return () => node.removeEventListener("wheel", handleWheel)
  }, [ref])
}
