export default function Home() {
  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">ダッシュボード</h1>
        <p className="text-muted-foreground mt-2">
          Product Planner へようこそ
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">受注管理</h2>
          <p className="text-sm text-muted-foreground">
            注文の受付と納期回答を管理します
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">マスターデータ</h2>
          <p className="text-sm text-muted-foreground">
            製品、設備、設備グループの管理
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">生産計画</h2>
          <p className="text-sm text-muted-foreground">
            生産スケジュールの最適化
          </p>
        </div>
      </div>
    </div>
  );
}
