import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { TaskBar } from "@/gantt"
import type { GanttBarAppearance } from "@/gantt"
import { PROCESS_DISPLAY_STATE_LABEL } from "@/lib/daily-report-progress-utils"
import type { ProcessDisplayState } from "@/lib/daily-report-progress-utils"

/**
 * 生産スケジュールのガントの凡例 (Issue #580)。
 * 見本は実際のバー（TaskBar）で描き、バーの見た目を変えたときに凡例が食い違わないようにする
 */

/** 凡例の見本（バーの外観・バッジ）。ガント側の対応（STATE_APPEARANCE）と揃えること */
const SAMPLES: Record<
  ProcessDisplayState,
  { appearance: GanttBarAppearance; badge?: string; progress?: number }
> = {
  planned_only: { appearance: "neutral" },
  not_started: { appearance: "subtle" },
  in_progress: { appearance: "default", badge: "60%", progress: 0.6 },
  completed: { appearance: "muted", badge: "✓" },
  delayed: { appearance: "danger", badge: "！" },
}

/** 日報の進捗が無いテナントでは「計画のみ」だけ出す */
const STATES_WITH_PROGRESS: ProcessDisplayState[] = [
  "planned_only",
  "not_started",
  "in_progress",
  "completed",
  "delayed",
]

export function ProgressLegend({ computedAt }: { computedAt: string | null | undefined }) {
  const states: ProcessDisplayState[] = computedAt ? STATES_WITH_PROGRESS : ["planned_only"]
  return (
    <div
      data-testid="progress-legend"
      className="mb-2 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {states.map((state) => {
        const sample = SAMPLES[state]
        return (
          <span key={state} className="flex items-center gap-1.5" data-legend-state={state}>
            <span className="w-12">
              <TaskBar
                task={{
                  id: `legend-${state}`,
                  name: PROCESS_DISPLAY_STATE_LABEL[state],
                  start: new Date(0),
                  end: new Date(0),
                  color: "#2563eb",
                  ...sample,
                }}
                colStart={1}
                colEnd={2}
                className="!mx-0 !my-0 !h-4 cursor-default !text-[10px]"
              />
            </span>
            {PROCESS_DISPLAY_STATE_LABEL[state]}
          </span>
        )
      })}
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="font-semibold text-blue-700 dark:text-blue-300">
          ⚑
        </span>
        納期（赤＝最終工程が希望納期を超過）
      </span>
      {computedAt && (
        <span>（{format(new Date(computedAt), "M/d HH:mm", { locale: ja })} 時点の日報）</span>
      )}
    </div>
  )
}
