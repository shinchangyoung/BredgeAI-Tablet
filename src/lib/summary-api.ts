import { getWorkspaceApiBaseUrl } from './workspace-api';

export type SummaryRecord = {
  created_at?: string | null;
  material_summary?: string | null;
  recording_id?: string | null;
  session_id?: string | null;
  session_summary?: string | null;
  source_text?: string | null;
  speaker_id?: string | null;
  speaker_summary?: string | null;
  summary_id?: string | null;
  summary_level?: string | null;
  [key: string]: unknown;
};

export type SavedSummaryKind = 'material' | 'recording' | 'session' | 'speaker';

export type SavedSummaryItem = {
  createdAt: string;
  id: string;
  kind: SavedSummaryKind;
  recordingId: string;
  sourceText: string;
  subtitle: string;
  summary: string;
  title: string;
};

type SummaryListResponse = {
  summaries?: SummaryRecord[];
};

type MaterialSource = {
  materials?: Array<{
    name?: string;
    title?: string;
    fileName?: string;
    originalName?: string;
    storedName?: string;
  }>;
  summaryLevel?: string;
};

const SUMMARY_API_BASE = `${getWorkspaceApiBaseUrl()}/summary`;

async function parseApiResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const rawResult = await response.text();
  let result: Record<string, unknown> = {};

  try {
    result = rawResult ? JSON.parse(rawResult) : {};
  } catch {
    result = { error: rawResult };
  }

  if (!response.ok || result.ok === false) {
    const message =
      typeof result.error === 'string'
        ? result.error
        : typeof result.detail === 'string'
          ? result.detail
          : `${fallbackMessage} (${response.status})`;
    throw new Error(message);
  }

  return result as T;
}

function parseMaterialSource(sourceText: string): MaterialSource {
  if (!sourceText) return {};

  try {
    const parsed = JSON.parse(sourceText);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getStringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getSummaryText(record: SummaryRecord) {
  return (
    getStringValue(record.session_summary) ||
    getStringValue(record.material_summary) ||
    getStringValue(record.speaker_summary)
  );
}

function isMaterialSummary(record: SummaryRecord) {
  return record.speaker_id === 'MATERIAL' || String(record.recording_id ?? '').startsWith('material:');
}

function formatSpeakerLabel(speakerId?: string | null) {
  const normalized = String(speakerId ?? '').trim();
  const match = normalized.match(/^SPEAKER_(\d+)$/i);
  if (match) return `화자 ${Number.parseInt(match[1], 10) + 1}`;
  if (!normalized || normalized === 'UNKNOWN') return '화자 미상';
  return normalized;
}

function getMaterialTitle(record: SummaryRecord) {
  const source = parseMaterialSource(getStringValue(record.source_text));
  const materials = Array.isArray(source.materials) ? source.materials : [];
  const firstMaterial = materials[0];
  const firstName =
    firstMaterial?.name ||
    firstMaterial?.title ||
    firstMaterial?.fileName ||
    firstMaterial?.originalName ||
    firstMaterial?.storedName ||
    'PDF 강의자료';

  return materials.length > 1 ? `${firstName} 외 ${materials.length - 1}개` : firstName;
}

function getSummaryKind(record: SummaryRecord): SavedSummaryKind {
  if (isMaterialSummary(record)) return 'material';
  if (getStringValue(record.speaker_summary)) return 'speaker';
  if (getStringValue(record.recording_id)) return 'recording';
  return 'session';
}

function getSummaryTitle(record: SummaryRecord, kind: SavedSummaryKind) {
  if (kind === 'material') return getMaterialTitle(record);
  if (kind === 'speaker') return formatSpeakerLabel(record.speaker_id);
  if (kind === 'recording') return '전사 요약';
  return '세션 요약';
}

function getSummarySubtitle(kind: SavedSummaryKind, record: SummaryRecord) {
  if (kind === 'material') {
    const source = parseMaterialSource(getStringValue(record.source_text));
    const level = source.summaryLevel || getStringValue(record.summary_level) || 'standard';
    return level === 'brief' ? 'PDF 요약 · 짧게' : level === 'detailed' ? 'PDF 요약 · 자세히' : 'PDF 요약';
  }

  if (kind === 'speaker') return '화자별 요약';
  if (kind === 'recording') return '전사 요약';
  return '전체 요약';
}

export async function fetchSessionSummaries(sessionId: string, recordingId = '') {
  const endpoint = `${SUMMARY_API_BASE}/session/${encodeURIComponent(sessionId)}`;
  const query = recordingId ? `?recording_id=${encodeURIComponent(recordingId)}` : '';
  const result = await parseApiResponse<SummaryListResponse>(
    await fetch(`${endpoint}${query}`),
    '요약 목록을 불러오지 못했습니다.',
  );

  return Array.isArray(result.summaries) ? result.summaries : [];
}

export function normalizeSummaryItems(records: SummaryRecord[]): SavedSummaryItem[] {
  return records
    .map((record, index) => {
      const summary = getSummaryText(record);
      if (!summary) return null;

      const kind = getSummaryKind(record);
      const id =
        getStringValue(record.summary_id) ||
        `${kind}-${getStringValue(record.recording_id) || getStringValue(record.speaker_id) || index}`;

      return {
        createdAt: getStringValue(record.created_at),
        id,
        kind,
        recordingId: getStringValue(record.recording_id),
        sourceText: getStringValue(record.source_text),
        subtitle: getSummarySubtitle(kind, record),
        summary,
        title: getSummaryTitle(record, kind),
      };
    })
    .filter((item): item is SavedSummaryItem => Boolean(item))
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime();
      const rightTime = new Date(right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
}
