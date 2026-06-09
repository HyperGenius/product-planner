"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { masterItems } from "./constants"

export default function MasterLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isIndexPage = pathname === "/master"

  return (
    <div className="max-w-[860px] w-full mx-auto px-6">
      {!isIndexPage && (
        <nav className="flex flex-wrap gap-2 py-4">
          {masterItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors ${
                  isActive
                    ? "bg-card border-border text-foreground"
                    : "bg-card border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                <div className={`rounded p-1 ${isActive ? item.iconBg : ""}`}>
                  <item.icon className={`h-4 w-4 ${isActive ? item.iconColor : ""}`} />
                </div>
                {item.title}
              </Link>
            )
          })}
        </nav>
      )}
      {children}
    </div>
  )
}
