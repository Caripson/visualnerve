import type {
  AnalyticsExtension,
  AnalyticsMeasurement,
  AnalyticsResultContent,
  AnalyticsSignal,
  AnalysisJobRequest,
  AnalysisJobValue,
} from '../types';
import type { DisplaySeries } from './ChartView';

export interface ProcessTargetSummary {
  id: string;
  name: string;
}

export interface ProcessTargetDetails extends ProcessTargetSummary {
  nodes: { id: string; name: string; type: string }[];
  scenarios: { id: string; name: string }[];
}

export interface ProcessTargetProps {
  processTargets?: ProcessTargetSummary[];
  loadProcessTarget?: (id: string) => Promise<ProcessTargetDetails>;
}

export interface AnalyticsWorkspaceProps extends ProcessTargetProps {
  diagramId: string;
  analytics: AnalyticsExtension;
  version: number;
  nodes?: { id: string; title: string }[];
  onChange: (next: AnalyticsExtension, baseVersion: number) => Promise<void>;
  disabled?: boolean;
  securityEpoch?: number;
  useExample?: () => Promise<void>;
}

export interface PanelProps extends ProcessTargetProps {
  model: AnalyticsExtension;
  save: (next: AnalyticsExtension) => Promise<void>;
  run: (request: AnalysisJobRequest) => Promise<AnalysisJobValue>;
  archive: (
    content: AnalyticsResultContent,
    parameters: Record<string, unknown>,
    model?: AnalyticsExtension,
  ) => Promise<AnalyticsExtension>;
  busy: boolean;
  nodes?: { id: string; title: string }[];
}

export interface ChartSelection {
  seriesId: string;
  from: string;
  to: string;
  dimensions?: Record<string, string>;
  points?: { time: string; value: number }[];
}

export interface ChartInteractions {
  selection?: ChartSelection;
  onSelection?: (selection: ChartSelection) => void;
  measurement?: AnalyticsMeasurement;
  onMeasurementPoints?: (points: { time: string; value: number }[]) => void;
  onThreshold?: (seriesId: string, value: number) => void;
  focusedSignal?: AnalyticsSignal;
}

export interface MeasurementFitOverlay {
  sourceSeriesId: string;
  definitionKey: string;
  series: DisplaySeries;
}
