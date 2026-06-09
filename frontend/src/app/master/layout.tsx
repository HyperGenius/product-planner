export default function MasterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[860px] w-full mx-auto px-6">
      {children}
    </div>
  )
}
