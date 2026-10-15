export interface SplitLineItemInput {
  productId: string
  quantity: string
  desiredDeadline: string
}

export interface SplitValidationResult {
  ok: boolean
  message: string
}

function isProductMissing(item: SplitLineItemInput): boolean {
  return !item.productId || isNaN(parseInt(item.productId, 10))
}

function isQuantityInvalid(item: SplitLineItemInput): boolean {
  const parsed = parseInt(item.quantity, 10)
  return item.quantity === "" || isNaN(parsed) || parsed <= 0
}

function isDeadlineMissing(item: SplitLineItemInput): boolean {
  return !item.desiredDeadline
}

export function validateSplitItems(items: SplitLineItemInput[]): SplitValidationResult {
  if (items.length < 2) {
    return { ok: false, message: "分割後の明細は2件以上入力してください" }
  }
  if (items.some(isProductMissing)) {
    return { ok: false, message: "すべての明細で製品を選択してください" }
  }
  if (items.some(isQuantityInvalid)) {
    return { ok: false, message: "すべての明細で数量を正しく入力してください" }
  }
  if (items.some(isDeadlineMissing)) {
    return { ok: false, message: "すべての明細で希望納期を入力してください" }
  }
  return { ok: true, message: "" }
}

export function isSplitQuantityInvalid(item: SplitLineItemInput): boolean {
  return isQuantityInvalid(item)
}

export function isSplitProductMissing(item: SplitLineItemInput): boolean {
  return isProductMissing(item)
}

export function isSplitDeadlineMissing(item: SplitLineItemInput): boolean {
  return isDeadlineMissing(item)
}
