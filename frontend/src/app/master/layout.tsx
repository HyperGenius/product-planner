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
          {masterItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground ${
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.title}
            </Link>
          ))}
        </nav>
      )}
      {children}
    </div>
  )
}
