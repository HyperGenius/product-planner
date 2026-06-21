"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

export interface UnconfirmedRoutingQueueItem {
  order_id: number
  order_no: string | null
  product_name: string
  buffer_days: number | null
  desired_deadline: string | null
  unconfirmed_routing_count: number
}

export interface UnconfirmedRoutingQueue {
  count: number
  items: UnconfirmedRoutingQueueItem[]
}

export function useUnconfirmedRoutingQueue() {
  return useQuery<UnconfirmedRoutingQueue>({
    queryKey: ["unconfirmed-routing-queue"],
    queryFn: () => apiClient<UnconfirmedRoutingQueue>("/orders/unconfirmed-routing-queue"),
  })
}
