import { getWorkspaceApiBaseUrl } from '@/lib/workspace-api';

export type ScheduleStatus = 'pending' | 'confirmed' | 'ignored';
export type ScheduleType = 'lecture' | 'meeting' | 'assignment' | 'exam' | 'presentation' | 'project' | 'etc';

export type ScheduleItem = {
  apiId: string;
  confidence: number | null;
  dateKey: string;
  endTime: string;
  id: string;
  note: string;
  origin: 'ai' | 'manual';
  recordingId: string;
  sourceSessionTitle: string;
  sourceText: string;
  sourceStartTime: number | null;
  sourceEndTime: number | null;
  startTime: string;
  status: ScheduleStatus;
  time: string;
  title: string;
  transcriptId: string;
  type: ScheduleType;
  workspaceFileId: string;
};

export type ManualScheduleInput = {
  title: string;
  description?: string;
  event_type?: ScheduleType;
  due_date?: string;
  status?: ScheduleStatus;
  session_id?: string;
  recording_id?: string;
  transcript_id?: string;
  source_start_time?: number;
  source_end_time?: number;
  source_text?: string;
};

type RawSchedule = Record<string, unknown>;

const TYPE_LABELS: Record<ScheduleType, string> = {
  lecture: '수업',
  meeting: '회의',
  assignment: '과제',
  exam: '시험',
  presentation: '발표',
  project: '프로젝트',
  etc: '기타',
};

const TYPE_ICONS: Record<ScheduleType, string> = {
  lecture: 'menu-book',
  meeting: 'groups',
  assignment: 'assignment',
  exam: 'quiz',
  presentation: 'campaign',
  project: 'workspaces',
  etc: 'event',
};

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  pending: '확인 필요',
  confirmed: '예정',
  ignored: '무시됨',
};

const EVENT_TYPE_TO_FRONTEND: Record<string, ScheduleType> = {
  강의: 'lecture',
  과제: 'assignment',
  기타: 'etc',
  발표: 'presentation',
  수업: 'lecture',
  시험: 'exam',
  제출: 'assignment',
  프로젝트: 'project',
  회의: 'meeting',
};

function readString(item: RawSchedule, key: string) {
  const value = item[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(item: RawSchedule, key: string) {
  const value = item[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateLabel(dateKey: string) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function parseDueDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatKoreanTime(date: Date) {
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hour < 12 ? '오전' : '오후';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${meridiem} ${String(hour).padStart(2, '0')}:${minute}`;
}

function normalizeStatus(status: unknown, origin: 'ai' | 'manual'): ScheduleStatus {
  if (status === 'pending' || status === 'confirmed' || status === 'ignored') return status;
  if (status === '예정') return 'confirmed';
  return origin === 'ai' ? 'pending' : 'confirmed';
}

function normalizeEventType(type: unknown, origin: 'ai' | 'manual'): ScheduleType {
  if (typeof type === 'string') {
    if (type in TYPE_LABELS) return type as ScheduleType;
    if (EVENT_TYPE_TO_FRONTEND[type]) return EVENT_TYPE_TO_FRONTEND[type];
  }

  return origin === 'ai' ? 'meeting' : 'etc';
}

function normalizeScheduleItem(item: RawSchedule): ScheduleItem {
  const dueDate = parseDueDate(item.due_date);
  const dateKey = dueDate ? formatDateKey(dueDate) : formatDateKey();
  const startTime = dueDate ? formatKoreanTime(dueDate) : '';
  const sourceText = readString(item, 'source_text');
  const origin = sourceText ? 'ai' : 'manual';
  const title = readString(item, 'title') || '제목 없음';
  const id = readString(item, 'schedule_id') || readString(item, 'id') || `${dateKey}-${title}`;

  return {
    apiId: readString(item, 'schedule_id'),
    confidence: readNumber(item, 'confidence'),
    dateKey,
    endTime: startTime,
    id,
    note: readString(item, 'description'),
    origin,
    recordingId: readString(item, 'recording_id'),
    sourceSessionTitle: readString(item, 'session_title') || readString(item, 'course_title'),
    sourceText,
    sourceStartTime: readNumber(item, 'source_start_time'),
    sourceEndTime: readNumber(item, 'source_end_time'),
    startTime,
    status: normalizeStatus(item.status, origin),
    time: startTime,
    title,
    transcriptId: readString(item, 'transcript_id'),
    type: normalizeEventType(item.event_type, origin),
    workspaceFileId: readString(item, 'session_id'),
  };
}

function sortSchedules(items: ScheduleItem[]) {
  return [...items].sort((a, b) => {
    const dateCompare = a.dateKey.localeCompare(b.dateKey);
    if (dateCompare !== 0) return dateCompare;
    return a.startTime.localeCompare(b.startTime);
  });
}

async function requestScheduleJson(endpoint = '/', options: RequestInit = {}) {
  const response = await fetch(`${getWorkspaceApiBaseUrl()}/schedule${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`일정 API 요청에 실패했습니다. (${response.status})`);
  }

  return response.json() as Promise<RawSchedule>;
}

export async function fetchSchedules() {
  const data = await requestScheduleJson('/');
  const schedules = Array.isArray(data.schedules) ? data.schedules : [];
  return sortSchedules(schedules.map((item) => normalizeScheduleItem(item as RawSchedule)));
}

export async function confirmSchedule(scheduleId: string) {
  await requestScheduleJson(`/${encodeURIComponent(scheduleId)}/confirm`, { method: 'PUT' });
}

export async function ignoreSchedule(scheduleId: string) {
  await requestScheduleJson(`/${encodeURIComponent(scheduleId)}/ignore`, { method: 'PUT' });
}

export async function createManualSchedule(input: ManualScheduleInput) {
  const data = await requestScheduleJson('/manual', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      status: input.status || 'confirmed',
    }),
  });
  return normalizeScheduleItem(data as RawSchedule);
}

export function getScheduleTypeLabel(type: ScheduleType) {
  return TYPE_LABELS[type] || TYPE_LABELS.etc;
}

export function getScheduleTypeIcon(type: ScheduleType) {
  return TYPE_ICONS[type] || TYPE_ICONS.etc;
}

export function getScheduleStatusLabel(status: ScheduleStatus) {
  return STATUS_LABELS[status] || STATUS_LABELS.confirmed;
}
