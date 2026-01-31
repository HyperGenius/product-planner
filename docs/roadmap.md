# 🚀 Product Roadmap

> **Last Updated**: 2026年1月31日

## 📍 現在地 (Current Status)

### ✅ 実装完了

* **Backend**:
  * 基本的なCRUD API（製品、設備、設備グループ、工程順序、注文、スケジュール、カレンダー）
  * 認証（Supabase Auth）、RLS（Row Level Security）によるマルチテナント分離
  * スケジューリングロジック（日またぎ対応、休憩時間考慮済み）
  * シミュレーションAPI（dry_runモード対応）
  * ガントチャート手動編集API
  * 稼働カレンダーAPI（月次取得、個別/一括更新）

* **Frontend**:
  * プロジェクト基盤（Next.js App Router + shadcn/ui + TanStack Query）
  * 認証（ログイン、セッション管理、テナント管理）
  * ダッシュボード（KPI表示、クイックアクション）
  * マスタ管理画面（設備、設備グループ、製品、工程順序）
  * 注文管理画面（一覧、新規作成、シミュレーション、確定）
  * ガントチャート画面（日次/週次/月次切替、ドラッグ&ドロップ編集、カラーモード切替）
  * 稼働カレンダー管理画面（月別表示、休日設定、一括設定）

* **Database**:
  * `work_calendars` テーブル作成済み
  * 全テーブルにRLSポリシー設定済み
  * UPSERT用ユニーク制約設定済み

---

## Phase 1: MVP完成 - 基本サイクルの確立 ✅ COMPLETED

**目標**: ユーザーが製品を登録し、注文を入力すると、簡易的な納期回答が得られる状態にする。

### 1.1 製品・工程マスタ管理 [Frontend] ✅

* ✅ 製品 (`Products`) のCRUD画面実装
* ✅ 工程順序 (`Process Routings`) の編集ダイアログ実装
  * 製品ごとの工程一覧表示
  * 工程の追加・編集・削除
  * 設備グループ選択、段取り時間、単位時間の設定

### 1.2 注文登録とシミュレーション [Frontend] ✅

* ✅ 注文一覧画面の実装（注文番号、製品、数量、希望納期、確定納期、ステータス表示）
* ✅ 注文入力フォームの実装
* ✅ 「シミュレーション実行」ボタンによる納期回答プレビュー表示
  * 回答納期、希望納期との比較
  * 工程スケジュール一覧（開始・終了時刻、設備名）
* ✅ 注文確定機能（draft → confirmed）

---

## Phase 2: 可視化 - 生産計画の見える化 ✅ COMPLETED

**目標**: 計算されたスケジュールを視覚的に確認し、全体の流れを把握できるようにする。

### 2.1 スケジュール参照APIの実装 [Backend] ✅

* ✅ 指定期間のスケジュールデータ取得API
* ✅ 設備グループごとのフィルタリング機能

### 2.2 ガントチャート画面の実装 [Frontend] ✅

* ✅ **ライブラリ**: `gantt-task-react` を採用
* ✅ **Y軸**: 設備
* ✅ **X軸**: 日時（タイムライン）
* ✅ **機能**:
  * 表示モード切替（日次 / 週次 / 月次）
  * 期間ナビゲーション（前へ / 今日 / 次へ）
  * 設備グループフィルタ
  * スケジュールバーの表示（製品名・工程名）
  * カラーモード切替（製品別 / 工程別の色分け）
  * カスタムツールチップ（工程名、注文番号、開始/終了時刻）

---

## Phase 3: シミュレーションエンジンの高度化 (Realism) ✅ COMPLETED

**目標**: 現場の現実に即した、精度の高いスケジュール計算を実現する。

### 3.1 長時間工程（日またぎ）への対応 [Logic] ✅

* ✅ `split_work_across_days()` 関数による作業分割ロジック実装
* ✅ 複数の営業日にまたがるスケジュール作成
* ✅ 土日・休日をスキップして翌営業日に繰り越し
* 例: 10時間の作業を9:00から開始 → Day1: 9:00-17:00（7h） + Day2: 9:00-12:00（3h）

### 3.2 休憩時間の考慮 [Logic] ✅

* ✅ 昼休憩（12:00-13:00）の稼働除外
* ✅ `is_break_time()`, `adjust_for_break_start()`, `adjust_remaining_work_for_break()` などの関数実装
* ✅ 1日あたりの最大稼働時間: 7時間（9:00-17:00 から休憩1時間を除く）

### 3.3 稼働カレンダー機能 [Master/Logic] ✅

* ✅ `work_calendars` テーブル作成（テナントごと）
* ✅ 休日設定、土曜出勤設定、臨時休業の設定
* ✅ `CalendarConfig` クラスによる休日/稼働日のセット管理
* ✅ ロジック内での `is_workday` 判定がDB参照型に変更済み
* ✅ カレンダー管理UI（月別カレンダー表示、一括設定機能）

---

## Phase 4: ダッシュボード & 運用最適化 🔄 IN PROGRESS

**目標**: 工場全体の状況を瞬時に把握し、意思決定を支援する。

### 4.1 ダッシュボード画面 [Frontend/Backend] 🔄

* ✅ 基本的なダッシュボード実装済み
  * 今日の納期件数
  * Draft（未確定）件数
  * 最新5件の注文リスト
  * クイックアクション（新規注文ボタン）
* ⬜ **KPI表示の拡充**:
  * ⬜ 本日の完了件数
  * ⬜ 遅延オーダー数（アラート）
  * ⬜ 設備稼働率
* ⬜ **直近のアクション**:
  * ⬜ 「今日の未着手タスク」リスト

### 4.2 手動調整機能 (Drag & Drop) [Frontend/Backend] ✅

* ✅ ガントチャート上でバーをドラッグして開始時間をずらす機能
* ✅ 変更に伴う更新API（`PATCH /schedules/{id}`）
* ⬜ **追加改善**:
  * ⬜ 設備間のドラッグ&ドロップ移動
  * ⬜ 変更時の再計算（バリデーション）API

---

## Phase 5: 実績管理 & 品質向上 ⬜ NOT STARTED

**目標**: 計画と実績の比較、継続的な改善サイクルの確立。

### 5.1 実績入力機能 [Frontend/Backend]

* ⬜ 着手・完了の実績入力UI
* ⬜ ガントチャートへの実績表示（計画 vs 実績）
* ⬜ 実績データAPI

### 5.2 分析・レポート機能

* ⬜ 計画遵守率の表示
* ⬜ 設備稼働率の時系列分析
* ⬜ 納期遵守率レポート

### 5.3 通知機能

* ⬜ 遅延アラートのメール/Push通知
* ⬜ 納期接近の事前通知

---

## 📅 開発優先度 (Priority)

| Feature | Phase | Status | Impact | Complexity |
| --- | --- | --- | --- | --- |
| **製品・工程マスタUI** | 1 | ✅ Done | High | Medium |
| **注文シミュレーションUI** | 1 | ✅ Done | High | Medium |
| **ガントチャート表示** | 2 | ✅ Done | High | High |
| **日またぎ計算ロジック** | 3 | ✅ Done | High | High |
| **休憩時間考慮ロジック** | 3 | ✅ Done | Medium | Medium |
| **稼働カレンダー管理** | 3 | ✅ Done | Medium | Medium |
| **手動調整機能（Drag & Drop）** | 4 | ✅ Done | High | High |
| **基本ダッシュボード** | 4 | ✅ Done | Medium | Low |
| **ダッシュボードKPI拡充** | 4 | ⬜ Todo | Medium | Low |
| **実績入力機能** | 5 | ⬜ Todo | High | Medium |
| **分析・レポート機能** | 5 | ⬜ Todo | Medium | Medium |
| **通知機能** | 5 | ⬜ Todo | Medium | Medium |

---

## 🛠 技術スタック

### Backend
* **Framework**: FastAPI (Python)
* **Database**: PostgreSQL (Supabase)
* **認証**: Supabase Auth + RLS

### Frontend
* **Framework**: Next.js (App Router)
* **UI**: shadcn/ui (Radix UI + Tailwind CSS)
* **状態管理**: TanStack Query (React Query)
* **ガントチャート**: gantt-task-react
* **カレンダー**: react-day-picker
* **日付処理**: date-fns
* **通知**: Sonner (Toast)

### Infrastructure
* **Database**: Supabase (PostgreSQL)
* **Authentication**: Supabase Auth
