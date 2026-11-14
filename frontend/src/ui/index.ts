/**
 * The WorkEasy360 design system for HRMS. See docs/design-system.md.
 *
 * Pages import their primitives from here (`@/ui`) and never state a colour,
 * size or radius of their own: components come from the `c-*` classes in
 * admin.css, and layout utilities read the same tokens through Tailwind's
 * mapped theme (`bg-surface`, `text-secondary`, `border-line`, …).
 *
 * This folder is laid out like the shared `packages/ui` package so it can be
 * lifted out into one without moving code around.
 */

export { Button, IconButton } from "./components/button";
export {
  Alert,
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorBanner,
  LoadingRows,
  Page,
  PageHeader,
  Progress,
  SectionTitle,
  Skeleton,
  StatCard,
  type ValueTone,
} from "./components/page";
export { AgentAvatar } from "./components/agent-avatar";
export { BarTrend, Donut, LineTrend, type ChartPoint, type DonutSlice } from "./components/charts";
export { BrandMark, Lockup, PRODUCT_NAME } from "./components/logo";
export { ThemeToggle, themeScript, type Theme } from "./components/theme-toggle";
export { CHART_OTHER, CHART_SERIES, color, motion, radius, size, type Tone } from "./tokens";
