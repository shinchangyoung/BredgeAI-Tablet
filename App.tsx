import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import type { DocumentPickerAsset } from 'expo-document-picker';
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { RecorderState } from 'expo-audio';
import Feather from 'expo/node_modules/@expo/vector-icons/Feather';
import MaterialIcons from 'expo/node_modules/@expo/vector-icons/MaterialIcons';
import { StatusBar } from 'expo-status-bar';
import LottieView from 'lottie-react-native';
import { WebView } from 'react-native-webview';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  DeviceEventEmitter,
} from 'react-native';

import {
  confirmWorkspaceSchedule,
  createWorkspaceSession,
  deleteWorkspaceRecordingData,
  getWorkspaceAssetUrl,
  getWorkspaceApiBaseUrl,
  getWorkspaceSchedules,
  getWorkspaceSession,
  getWorkspaceTree,
  ignoreWorkspaceSchedule,
  transcribeWorkspaceRecording,
  uploadWorkspaceRecording,
  type WorkspaceScheduleItem,
  type WorkspaceFileNode,
  type WorkspaceMaterialResource,
  type WorkspaceNode,
  type WorkspaceRecordingResource,
  type WorkspaceSessionNode,
  type WorkspaceTranscription,
  type WorkspaceTranscriptSegment,
  type WorkspaceUploadFile,
} from './workspace-api';
import {
  createReadonlyPdfViewerHtml,
  normalizePdfAnnotationPayload,
  type PdfAnnotationPayload,
} from './mobile-pdf-viewer-html';

type SessionMaterialFile = {
  annotations?: PdfAnnotationPayload;
  id: string;
  meta: string;
  mimeType?: string;
  title: string;
  url?: string;
};

type SessionRecordingFile = {
  audioUrl?: string;
  createdAt?: string;
  durationLabel: string;
  id: string;
  transcriptError?: string;
  transcriptLines: SessionTranscriptLine[];
  transcriptionStatus?: string;
  title: string;
};

type SessionTranscriptLine = {
  id: string;
  recordingId: string;
  speaker?: string;
  startSeconds?: number;
  text: string;
  time: string;
};

type SessionFile = {
  audioSources: string[];
  color: string;
  date: string;
  id: string;
  materials?: SessionMaterialFile[];
  recordings?: SessionRecordingFile[];
  resourcesLoaded?: boolean;
  tag: string;
  title: string;
};

type VoiceSourceFile = {
  createdAt: string;
  durationLabel: string;
  fileName?: string | null;
  folderName: string | null;
  id: string;
  mimeType?: string | null;
  sessionId: string | null;
  title: string;
  uri: string;
};

type MobileScheduleStatus = 'pending' | 'confirmed' | 'ignored';
type MobileScheduleItem = {
  dateKey: string;
  id: string;
  note: string;
  recordingId: string;
  sourceSessionTitle: string;
  sourceText: string;
  startTime: string;
  status: MobileScheduleStatus;
  title: string;
  transcriptId: string;
  type: string;
  typeLabel: string;
  workspaceFileId: string;
};

type HomeTab = '최근' | '음성소스' | '폴더' | '캘린더';
type WorkspaceLoadStatus = 'loading' | 'connected' | 'fallback';
type RecordingSaveStatus = 'idle' | 'saving' | 'saved' | 'local' | 'failed';
type SessionResourceKind = 'material' | 'recording';
type ResourceActionTarget = {
  id: string;
  kind: SessionResourceKind;
  title: string;
};
type RecordingSessionSavePromptState = {
  sessionId: string;
  sessionTitle: string;
  sourceId: string;
};

const initialSessionFiles: SessionFile[] = [
  {
    audioSources: [],
    color: '#3b82f6',
    date: '2026. 5. 28. 오후 9:04',
    id: 'database',
    tag: '수업',
    title: '데이터베이스 5주차 - 인덱스와 트랜잭션',
  },
  {
    audioSources: [],
    color: '#3b82f6',
    date: '2026. 5. 28. 오후 9:04',
    id: 'os',
    tag: '수업',
    title: '운영체제 3주차 - 프로세스와 스레드',
  },
  {
    audioSources: [],
    color: '#3b82f6',
    date: '2026. 5. 28. 오후 9:04',
    id: 'physics',
    tag: '수업',
    title: '물리학 3주차 - 전기장과 회로',
  },
];

const tabs: HomeTab[] = ['최근', '음성소스', '폴더', '캘린더'];
const fileTags = ['수업', '회의', '프로젝트', '개인', '중요'];
const fileColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
const gridVerticalLines = Array.from({ length: 14 }, (_, index) => index);
const gridHorizontalLines = Array.from({ length: 26 }, (_, index) => index);
const waveformBars = Array.from({ length: 96 }, (_, index) => index);
const sourceWaveBars = [8, 14, 20, 28, 20, 14, 8];
const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };
const defaultSessionColor = '#3b82f6';

function workspaceTreeToSessionFiles(tree: WorkspaceNode[]) {
  const files: SessionFile[] = [];

  const visit = (nodes: WorkspaceNode[] = []) => {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        visit(node.children ?? []);
        return;
      }

      files.push(workspaceFileToSession(node));
    });
  };

  visit(tree);
  return files;
}

function replaceWorkspaceFileNode(tree: WorkspaceNode[], nextFile: WorkspaceFileNode): WorkspaceNode[] {
  return tree.map((node) => {
    if (node.type === 'file') {
      return node.id === nextFile.id ? nextFile : node;
    }

    return {
      ...node,
      children: replaceWorkspaceFileNode(node.children ?? [], nextFile),
    };
  });
}

function countWorkspaceTree(tree: WorkspaceNode[]): { files: number; folders: number } {
  return tree.reduce(
    (counts, node) => {
      if (node.type === 'file') {
        return { files: counts.files + 1, folders: counts.folders };
      }

      const childCounts = countWorkspaceTree(node.children ?? []);
      return {
        files: counts.files + childCounts.files,
        folders: counts.folders + childCounts.folders + 1,
      };
    },
    { files: 0, folders: 0 },
  );
}

function getWorkspaceFileResourceCounts(file: WorkspaceFileNode) {
  return {
    materials: file.attachments?.length ?? 0,
    recordings: file.recordings?.length ?? 0,
  };
}

function getFolderFileCount(node: WorkspaceNode): number {
  if (node.type === 'file') {
    return 1;
  }

  return (node.children ?? []).reduce((count, child) => count + getFolderFileCount(child), 0);
}

function getWorkspaceFileTag(file: WorkspaceFileNode) {
  return file.tag?.trim() || (file.fileKind === 'meeting' ? '회의' : '수업');
}

function getWorkspaceTags(tree: WorkspaceNode[], options: { includeFallback: boolean } = { includeFallback: false }) {
  const tags = new Set<string>();

  const visit = (nodes: WorkspaceNode[] = []) => {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        visit(node.children ?? []);
        return;
      }

      const tag = options.includeFallback ? getWorkspaceFileTag(node) : node.tag?.trim();

      if (tag) {
        tags.add(tag);
      }
    });
  };

  visit(tree);
  return Array.from(tags);
}

function getWorkspaceTagOptions(tree: WorkspaceNode[]) {
  return Array.from(new Set([...fileTags, ...getWorkspaceTags(tree)]));
}

function collectWorkspaceSessionIds(tree: WorkspaceNode[]) {
  const sessionIds = new Set<string>();

  const visit = (nodes: WorkspaceNode[] = []) => {
    nodes.forEach((node) => {
      if (node.type === 'file') {
        sessionIds.add(node.id);
        return;
      }

      visit(node.children ?? []);
    });
  };

  visit(tree);
  return sessionIds;
}

function normalizeHexColor(value?: string) {
  const color = value?.trim();
  if (!color) return defaultSessionColor;

  const shortHex = color.match(/^#([0-9a-f]{3})$/i);
  if (shortHex?.[1]) {
    return `#${shortHex[1]
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`;
  }

  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color;
  }

  return defaultSessionColor;
}

function hexToRgba(value: string | undefined, alpha: number) {
  const color = normalizeHexColor(value).replace('#', '');
  const red = parseInt(color.slice(0, 2), 16);
  const green = parseInt(color.slice(2, 4), 16);
  const blue = parseInt(color.slice(4, 6), 16);

  return `rgba(${red},${green},${blue},${alpha})`;
}

function workspaceFileToSession(file: WorkspaceFileNode): SessionFile {
  const recordings = (file.recordings ?? []).map(workspaceRecordingToSessionRecording);

  return {
    audioSources: recordings.map((recording) => recording.id),
    color: file.color || '#3b82f6',
    date: file.date || '',
    id: file.id,
    materials: (file.attachments ?? []).map(workspaceMaterialToSessionMaterial),
    recordings,
    resourcesLoaded: file.resourcesLoaded,
    tag: file.tag || (file.fileKind === 'meeting' ? '회의' : '수업'),
    title: file.name || '새 파일',
  };
}

function getWorkspaceRecordingId(recording: WorkspaceRecordingResource, index: number) {
  return String(recording.id || recording.recordingId || `recording-${index}`);
}

function workspaceRecordingToSessionRecording(
  recording: WorkspaceRecordingResource,
  index: number,
): SessionRecordingFile {
  const recordingId = getWorkspaceRecordingId(recording, index);
  const storedName = getRecordString(recording, ['storedName']);
  const audioPath =
    getRecordString(recording, ['audioUrl', 'url']) ??
    (storedName ? `/workspace/uploads/recordings/${storedName}` : undefined);

  return {
    audioUrl: getWorkspaceAssetUrl(audioPath),
    createdAt: getRecordString(recording, ['endedAt', 'createdAt', 'uploadedAt', 'startedAt']),
    durationLabel:
      getRecordString(recording, ['durationText']) ??
      formatSecondsLabel(getRecordNumber(recording, ['durationSeconds', 'duration'])),
    id: recordingId,
    transcriptError: getRecordString(recording, ['transcriptionError']),
    transcriptLines: buildRecordingTranscriptLines(recording, recordingId),
    transcriptionStatus: getRecordString(recording, ['transcriptionStatus']),
    title: getRecordString(recording, ['title', 'name', 'originalName', 'storedName']) ?? `음성소스 ${index + 1}`,
  };
}

function workspaceMaterialToSessionMaterial(
  material: WorkspaceMaterialResource,
  index: number,
): SessionMaterialFile {
  const title = decodeFileName(
    getRecordString(material, ['name', 'title', 'fileName', 'originalName', 'storedName']) ?? `강의자료 ${index + 1}`,
  );
  const type = getRecordString(material, ['mimeType', 'type']);
  const size = getRecordNumber(material, ['size']);
  const storedName = getRecordString(material, ['storedName']);
  const urlPath =
    getRecordString(material, ['url', 'fileUrl', 'materialUrl']) ??
    (storedName ? `/workspace/uploads/materials/${encodeURIComponent(storedName)}` : undefined);

  return {
    annotations: normalizePdfAnnotationPayload(material.annotations ?? material.pdfAnnotations ?? material.inkAnnotations),
    id: getRecordString(material, ['id', 'materialId', 'fileId', 'storedName', 'fileName']) ?? `material-${index}`,
    meta: [type, formatFileSize(size)].filter(Boolean).join(' · ') || '강의자료',
    mimeType: type,
    title,
    url: getWorkspaceAssetUrl(urlPath),
  };
}

function isPdfMaterial(material: SessionMaterialFile) {
  const mimeType = material.mimeType?.toLowerCase() ?? '';
  const meta = material.meta.toLowerCase();
  const title = material.title.toLowerCase();
  const urlPath = material.url?.split('?')[0]?.toLowerCase() ?? '';

  return mimeType.includes('pdf') || meta.includes('pdf') || title.endsWith('.pdf') || urlPath.endsWith('.pdf');
}

function getRecordString(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function getRecordNumber(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function buildRecordingTranscriptLines(recording: WorkspaceRecordingResource, recordingId: string) {
  const transcriptions = recording.transcriptions ?? [];

  return transcriptions.flatMap((transcription, transcriptionIndex) => {
    const segments = Array.isArray(transcription.segments) ? transcription.segments : [];

    if (segments.length > 0) {
      return segments.flatMap((segment, segmentIndex) => {
        const text = getRecordString(segment, ['text']);
        if (!text) return [];

        const startSeconds = getTranscriptSeconds(segment, transcription);

        return [
          {
            id: `${recordingId}-${transcriptionIndex}-${segmentIndex}`,
            recordingId,
            speaker:
              getRecordString(segment, ['speakerName', 'speaker']) ??
              getRecordString(transcription, ['speakerName', 'speaker']),
            startSeconds,
            text,
            time: formatTranscriptLineTime(segment, transcription),
          } satisfies SessionTranscriptLine,
        ];
      });
    }

    const text = getRecordString(transcription, ['text']);
    if (!text) return [];

    const startSeconds = getTranscriptSeconds(transcription);

    return [
      {
        id: `${recordingId}-${transcriptionIndex}`,
        recordingId,
        speaker: getRecordString(transcription, ['speakerName', 'speaker']),
        startSeconds,
        text,
        time: formatTranscriptLineTime(transcription),
      } satisfies SessionTranscriptLine,
    ];
  });
}

function getTranscriptSeconds(
  primary: WorkspaceTranscriptSegment | WorkspaceTranscription,
  fallback?: WorkspaceTranscription,
) {
  const seconds =
    getRecordNumber(primary, ['start', 'startTime', 'startSeconds']) ??
    getRecordNumber(fallback, ['start', 'startTime', 'startSeconds']);

  return typeof seconds === 'number' ? Math.max(0, seconds) : undefined;
}

function formatTranscriptLineTime(
  primary: WorkspaceTranscriptSegment | WorkspaceTranscription,
  fallback?: WorkspaceTranscription,
) {
  const label = getRecordString(primary, ['time']) ?? getRecordString(fallback, ['time']);
  if (label) return label;

  const startSeconds = getTranscriptSeconds(primary, fallback);
  return typeof startSeconds === 'number' ? formatTranscriptSecond(startSeconds) : '00:00';
}

function formatTranscriptSecond(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSecondsLabel(seconds?: number) {
  if (typeof seconds !== 'number') {
    return '';
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    remainingSeconds,
  ).padStart(2, '0')}`;
}

function formatDisplayDateTime(value?: string) {
  if (!value) {
    return undefined;
  }

  const normalizedValue = value.replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(normalizedValue);

  if (Number.isNaN(date.getTime())) {
    const fallback = value
      .replace('T', ' ')
      .replace(/\.\d+/, '')
      .replace(/([+-]\d{2}:\d{2}|Z)$/i, '')
      .trim();

    return fallback || value;
  }

  const meridiem = date.getHours() >= 12 ? '오후' : '오전';
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${meridiem} ${hour}:${minute}`;
}

const scheduleTypeLabels: Record<string, string> = {
  assignment: '과제',
  etc: '기타',
  exam: '시험',
  lecture: '수업',
  meeting: '회의',
  presentation: '발표',
  project: '프로젝트',
};

const scheduleEventTypeMap: Record<string, string> = {
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

function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatKoreanDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function formatKoreanScheduleTime(date: Date) {
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hour < 12 ? '오전' : '오후';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${meridiem} ${String(hour).padStart(2, '0')}:${minute}`;
}

function parseScheduleDueDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeScheduleStatus(status?: string | null, hasSourceText = false): MobileScheduleStatus {
  if (status === 'pending' || status === 'confirmed' || status === 'ignored') return status;
  if (status === '예정') return 'confirmed';
  return hasSourceText ? 'pending' : 'confirmed';
}

function getScheduleStatusLabel(status: MobileScheduleStatus) {
  if (status === 'pending') return '확인 필요';
  if (status === 'ignored') return '무시됨';
  return '예정';
}

function normalizeScheduleType(type?: string | null, hasSourceText = false) {
  if (type && scheduleTypeLabels[type]) return type;
  if (type && scheduleEventTypeMap[type]) return scheduleEventTypeMap[type];
  return hasSourceText ? 'meeting' : 'etc';
}

function workspaceScheduleToMobileSchedule(item: WorkspaceScheduleItem): MobileScheduleItem {
  const dueDate = parseScheduleDueDate(item.due_date);
  const hasSourceText = Boolean(item.source_text);
  const type = normalizeScheduleType(item.event_type, hasSourceText);
  const status = normalizeScheduleStatus(item.status, hasSourceText);

  return {
    dateKey: dueDate ? formatDateKey(dueDate) : formatDateKey(),
    id: item.schedule_id,
    note: item.description || '',
    recordingId: item.recording_id || '',
    sourceSessionTitle: item.session_title || item.course_title || '',
    sourceText: item.source_text || '',
    startTime: dueDate ? formatKoreanScheduleTime(dueDate) : '',
    status,
    title: item.title || '제목 없는 일정',
    transcriptId: item.transcript_id || '',
    type,
    typeLabel: scheduleTypeLabels[type] || '기타',
    workspaceFileId: item.session_id || '',
  };
}

function sortMobileSchedules(schedules: MobileScheduleItem[]) {
  return [...schedules].sort((a, b) => {
    const dateCompare = a.dateKey.localeCompare(b.dateKey);
    if (dateCompare !== 0) return dateCompare;
    return (a.startTime || '').localeCompare(b.startTime || '', 'ko-KR');
  });
}

function buildCalendarDays(activeMonthDate: Date, schedules: MobileScheduleItem[]) {
  const year = activeMonthDate.getFullYear();
  const month = activeMonthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const prevLastDay = new Date(year, month, 0);
  const leadingCount = firstDay.getDay();
  const trailingCount = 6 - lastDay.getDay();
  const todayKey = formatDateKey();
  const days: Array<{
    dateKey: string;
    hasConfirmedSchedule: boolean;
    hasPendingSchedule: boolean;
    isToday: boolean;
    label: number;
    muted: boolean;
    schedules: MobileScheduleItem[];
  }> = [];

  const createDay = (date: Date, label: number, muted: boolean) => {
    const dateKey = formatDateKey(date);
    const daySchedules = schedules.filter((schedule) => schedule.dateKey === dateKey);
    days.push({
      dateKey,
      hasConfirmedSchedule: daySchedules.some((schedule) => schedule.status === 'confirmed'),
      hasPendingSchedule: daySchedules.some((schedule) => schedule.status === 'pending'),
      isToday: dateKey === todayKey,
      label,
      muted,
      schedules: daySchedules,
    });
  };

  for (let index = leadingCount - 1; index >= 0; index -= 1) {
    const label = prevLastDay.getDate() - index;
    createDay(new Date(year, month - 1, label), label, true);
  }

  for (let label = 1; label <= lastDay.getDate(); label += 1) {
    createDay(new Date(year, month, label), label, false);
  }

  for (let label = 1; label <= trailingCount; label += 1) {
    createDay(new Date(year, month + 1, label), label, true);
  }

  return days;
}

function formatFileSize(size?: number) {
  if (typeof size !== 'number') {
    return undefined;
  }

  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function isRemoteSessionId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function getSessionRecordingCount(session: SessionFile) {
  return Math.max(session.audioSources.length, session.recordings?.length ?? 0);
}

function formatRecordingResourceMeta(recording: SessionRecordingFile) {
  const metaParts = [formatDisplayDateTime(recording.createdAt), recording.durationLabel].filter(Boolean);

  return metaParts.join(' · ') || '음성소스';
}

function formatPlaybackTime(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return '00:00';
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      remainingSeconds,
    ).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function parseDurationLabel(value?: string) {
  if (!value) return 0;

  const parts = value
    .split(':')
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return 0;
}

function getFileNameFromUri(uri: string, fallbackName: string) {
  const cleanUri = uri.split('?')[0] ?? uri;
  const rawName = decodeURIComponent(cleanUri.split('/').filter(Boolean).pop() ?? '');
  const safeName = rawName.trim().replace(/[^\w.-]+/g, '_');
  const fileName = safeName || fallbackName;

  return /\.[a-z0-9]+$/i.test(fileName) ? fileName : `${fileName}.m4a`;
}

function getAudioMimeType(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'm4a':
      return 'audio/m4a';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    case 'webm':
      return 'audio/webm';
    default:
      return 'audio/m4a';
  }
}

function buildRecordingUploadFile(uri: string, title: string) {
  const fileName = getFileNameFromUri(uri, `${title.replace(/[^\w.-]+/g, '_') || 'mobile-recording'}.m4a`);

  return {
    mimeType: getAudioMimeType(fileName),
    name: fileName,
    uri,
  };
}

function decodeFileName(value?: string | null) {
  if (!value) return '';

  try {
    return decodeURIComponent(value).normalize('NFC');
  } catch {
    return value.normalize('NFC');
  }
}

function getPickedAudioTitle(asset: DocumentPickerAsset) {
  const rawName =
    decodeFileName(asset.name) ||
    decodeFileName(asset.uri.split('?')[0]?.split('/').filter(Boolean).pop()) ||
    '업로드 음성';

  return rawName.replace(/\.[^/.]+$/, '').trim() || '업로드 음성';
}

function buildPickedAudioUploadFile(asset: DocumentPickerAsset, title: string): WorkspaceUploadFile {
  const fallbackName = `${title.replace(/[^\w.-]+/g, '_') || 'uploaded-audio'}.m4a`;
  const decodedName = decodeFileName(asset.name);
  const fileName = decodedName.trim()
    ? getFileNameFromUri(`file:///${decodedName}`, fallbackName)
    : getFileNameFromUri(asset.uri, fallbackName);

  return {
    mimeType: asset.mimeType || getAudioMimeType(fileName),
    name: fileName,
    uri: asset.uri,
  };
}

function buildVoiceSourceUploadFile(source: VoiceSourceFile): WorkspaceUploadFile {
  const fallbackName = `${source.title.replace(/[^\w.-]+/g, '_') || 'voice-source'}.m4a`;
  const fileName = source.fileName?.trim() || getFileNameFromUri(source.uri, fallbackName);

  return {
    mimeType: source.mimeType || getAudioMimeType(fileName),
    name: fileName,
    uri: source.uri,
  };
}

export default function App() {
  const [sessions, setSessions] = useState<SessionFile[]>(initialSessionFiles);
  const [recentSessionIds, setRecentSessionIds] = useState<string[]>(
    initialSessionFiles.slice(0, 3).map((session) => session.id),
  );
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceNode[]>([]);
  const [voiceSources, setVoiceSources] = useState<VoiceSourceFile[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSessionDetail, setSelectedSessionDetail] = useState<SessionFile | null>(null);
  const [selectedMaterialSource, setSelectedMaterialSource] = useState<SessionMaterialFile | null>(null);
  const [selectedRecordingSource, setSelectedRecordingSource] = useState<SessionRecordingFile | null>(null);
  const [resourceActionTarget, setResourceActionTarget] = useState<ResourceActionTarget | null>(null);
  const [renameResourceTarget, setRenameResourceTarget] = useState<ResourceActionTarget | null>(null);
  const [resourceActionError, setResourceActionError] = useState<string | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailError, setSessionDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HomeTab>('최근');
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceLoadStatus>('loading');
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [calendarSchedules, setCalendarSchedules] = useState<MobileScheduleItem[]>([]);
  const [calendarStatus, setCalendarStatus] = useState<WorkspaceLoadStatus>('loading');
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [isCalendarRefreshing, setIsCalendarRefreshing] = useState(false);
  const [updatingScheduleId, setUpdatingScheduleId] = useState<string | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [quickActionMenuVisible, setQuickActionMenuVisible] = useState(false);
  const [quickActionError, setQuickActionError] = useState<string | null>(null);
  const [isPickingVoiceFile, setIsPickingVoiceFile] = useState(false);
  const [voiceSourceSavedPromptVisible, setVoiceSourceSavedPromptVisible] = useState(false);
  const [recordingSessionSavePrompt, setRecordingSessionSavePrompt] =
    useState<RecordingSessionSavePromptState | null>(null);
  const [voiceSaveSourceId, setVoiceSaveSourceId] = useState<string | null>(null);
  const [voiceSaveError, setVoiceSaveError] = useState<string | null>(null);
  const [savingVoiceSourceId, setSavingVoiceSourceId] = useState<string | null>(null);
  const [draftFolderId, setDraftFolderId] = useState<string | null>(null);
  const [saveCompletionNotification, setSaveCompletionNotification] = useState<{
    sessionId: string;
    sessionTitle: string;
  } | null>(null);
  const [pendingUploadAsset, setPendingUploadAsset] = useState<DocumentPickerAsset | null>(null);
  const [isUploadDestinationModalVisible, setIsUploadDestinationModalVisible] = useState(false);
  const [uploadDestinationError, setUploadDestinationError] = useState<string | null>(null);
  const [isUploadingToDestination, setIsUploadingToDestination] = useState(false);
  const [draftSessionTitle, setDraftSessionTitle] = useState('');
  const [draftSessionTag, setDraftSessionTag] = useState(fileTags[0]);
  const [draftSessionColor, setDraftSessionColor] = useState(fileColors[0]);
  const [isCustomTagInputOpen, setIsCustomTagInputOpen] = useState(false);
  const [draftCustomTag, setDraftCustomTag] = useState('');
  const [recordingSheetVisible, setRecordingSheetVisible] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingElapsedMillis, setRecordingElapsedMillis] = useState(0);
  const [recordingSaveStatus, setRecordingSaveStatus] = useState<RecordingSaveStatus>('idle');
  const [recordingTitle, setRecordingTitle] = useState('새 음성 녹음');
  const [isPreparingRecording, setIsPreparingRecording] = useState(false);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const recordingAccumulatedMillisRef = useRef(0);
  const recordingSessionIdRef = useRef<string | null>(null);
  const hasSavedCurrentRecordingRef = useRef(false);
  const recordingPulseOpacity = useRef(new Animated.Value(1)).current;
  const audioRecorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(audioRecorder, 150);
  const selectedSession =
    selectedSessionDetail ?? sessions.find((session) => session.id === selectedSessionId) ?? null;
  const workspaceTagOptions = getWorkspaceTagOptions(workspaceTree);
  const selectedVoiceSaveSource = voiceSources.find((source) => source.id === voiceSaveSourceId) ?? null;

  const getDefaultRecordingTitle = () => (selectedSession ? `${selectedSession.title} 녹음` : '새 음성 녹음');

  const getCommittedRecordingTitle = () => recordingTitle.trim() || getDefaultRecordingTitle();

  const commitRecordingTitle = () => {
    setRecordingTitle((currentTitle) => currentTitle.trim() || getDefaultRecordingTitle());
  };

  const rememberRecentSession = (sessionId: string) => {
    setRecentSessionIds((currentIds) => [sessionId, ...currentIds.filter((id) => id !== sessionId)].slice(0, 3));
  };

  const openSession = (sessionId: string) => {
    rememberRecentSession(sessionId);
    setSelectedSessionId(sessionId);
  };

  const appendRecordingToSession = (sessionId: string, recording: SessionRecordingFile) => {
    const appendRecording = (session: SessionFile): SessionFile => ({
      ...session,
      audioSources: [recording.id, ...session.audioSources.filter((recordingId) => recordingId !== recording.id)],
      recordings: [recording, ...(session.recordings ?? []).filter((source) => source.id !== recording.id)],
    });

    setSessions((currentSessions) =>
      currentSessions.map((session) => (session.id === sessionId ? appendRecording(session) : session)),
    );
    setSelectedSessionDetail((currentSession) =>
      currentSession?.id === sessionId ? appendRecording(currentSession) : currentSession,
    );
  };

  const updateSessionFromWorkspaceNode = (node: WorkspaceSessionNode) => {
    const nextSession = workspaceFileToSession(node);
    setSelectedSessionDetail((currentSession) =>
      currentSession?.id === nextSession.id || selectedSessionId === nextSession.id ? nextSession : currentSession,
    );
    setSessions((currentSessions) =>
      currentSessions.map((session) => (session.id === nextSession.id ? nextSession : session)),
    );
    setWorkspaceTree((currentTree) => replaceWorkspaceFileNode(currentTree, node));
    setSelectedRecordingSource((currentRecording) => {
      if (!currentRecording) return currentRecording;
      return nextSession.recordings?.find((recording) => recording.id === currentRecording.id) ?? currentRecording;
    });
  };

  const loadCalendarSchedules = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') {
      setIsCalendarRefreshing(true);
    } else {
      setCalendarStatus('loading');
    }

    try {
      const schedules = await getWorkspaceSchedules();
      setCalendarSchedules(
        sortMobileSchedules(
          schedules
            .map(workspaceScheduleToMobileSchedule)
            .filter((schedule) => schedule.status !== 'ignored'),
        ),
      );
      setCalendarStatus('connected');
      setCalendarError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '일정 목록을 불러오지 못했습니다.';
      setCalendarStatus('fallback');
      setCalendarError(`${message} API 주소: ${getWorkspaceApiBaseUrl()}`);
      setCalendarSchedules([]);
    } finally {
      setIsCalendarRefreshing(false);
    }
  }, []);

  const updateCalendarScheduleStatus = async (scheduleId: string, status: MobileScheduleStatus) => {
    if (status !== 'confirmed' && status !== 'ignored') return;

    setUpdatingScheduleId(scheduleId);
    try {
      if (status === 'confirmed') {
        await confirmWorkspaceSchedule(scheduleId);
      } else {
        await ignoreWorkspaceSchedule(scheduleId);
      }

      setCalendarSchedules((currentSchedules) =>
        sortMobileSchedules(
          currentSchedules
            .map((schedule) => (schedule.id === scheduleId ? { ...schedule, status } : schedule))
            .filter((schedule) => schedule.status !== 'ignored'),
        ),
      );
      await loadCalendarSchedules('refresh');
    } catch (error) {
      Alert.alert('일정 동기화 실패', error instanceof Error ? error.message : '일정 상태를 변경하지 못했습니다.');
    } finally {
      setUpdatingScheduleId(null);
    }
  };

  const loadWorkspaceData = useCallback(() => {
    setWorkspaceStatus('loading');
    getWorkspaceTree()
      .then((tree) => {
        const nextSessions = workspaceTreeToSessionFiles(tree);
        const nextSessionIds = nextSessions.map((session) => session.id);

        setSessions(nextSessions);
        setRecentSessionIds((currentIds) => {
          const validRecentIds = currentIds.filter((id) => nextSessionIds.includes(id));
          return (validRecentIds.length > 0 ? validRecentIds : nextSessionIds).slice(0, 3);
        });
        setWorkspaceTree(tree);
        setWorkspaceStatus('connected');
        setWorkspaceError(null);
      })
      .catch((error) => {
        setWorkspaceStatus('error');
        setWorkspaceError(error instanceof Error ? error.message : '워크스페이스를 불러오지 못했습니다.');
      });
  }, []);

  const loadGlobalData = useCallback(() => {
    setActiveTab('최근');
    void loadCalendarSchedules('refresh');
    loadWorkspaceData();
  }, [loadCalendarSchedules, loadWorkspaceData]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('globalRefresh', loadGlobalData);
    return () => sub.remove();
  }, [loadGlobalData]);

  useEffect(() => {
    let isMounted = true;

    setWorkspaceStatus('loading');
    getWorkspaceTree()
      .then((tree) => {
        if (!isMounted) {
          return;
        }

        const nextSessions = workspaceTreeToSessionFiles(tree);
        const nextSessionIds = nextSessions.map((session) => session.id);

        setSessions(nextSessions);
        setRecentSessionIds((currentIds) => {
          const validRecentIds = currentIds.filter((id) => nextSessionIds.includes(id));
          return (validRecentIds.length > 0 ? validRecentIds : nextSessionIds).slice(0, 3);
        });
        setWorkspaceTree(tree);
        setWorkspaceStatus('connected');
        setWorkspaceError(null);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : '워크스페이스 목록을 불러오지 못했습니다.';
        setWorkspaceStatus('fallback');
        setWorkspaceTree([]);
        setWorkspaceError(`${message} API 주소: ${getWorkspaceApiBaseUrl()}`);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    void loadCalendarSchedules();
  }, [loadCalendarSchedules]);

  useEffect(() => {
    let isMounted = true;

    setSelectedSessionDetail(null);
    setSelectedRecordingSource(null);
    setSelectedMaterialSource(null);
    setResourceActionTarget(null);
    setRenameResourceTarget(null);
    setResourceActionError(null);
    setSessionDetailError(null);

    if (!selectedSessionId || !isRemoteSessionId(selectedSessionId)) {
      setSessionDetailLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setSessionDetailLoading(true);
    getWorkspaceSession(selectedSessionId)
      .then((node) => {
        if (!isMounted) {
          return;
        }

        updateSessionFromWorkspaceNode(node);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }

        const message = error instanceof Error ? error.message : '세션 파일을 불러오지 못했습니다.';
        setSessionDetailError(message);
      })
      .finally(() => {
        if (!isMounted) {
          return;
        }

        setSessionDetailLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedSessionId]);

  const saveLocalVoiceSource = (
    uri: string,
    durationMillis: number,
    sessionId: string | null,
    titleOverride?: string,
    options: { showSavedPrompt?: boolean } = {},
  ) => {
    const now = new Date();
    const durationLabel = formatRecordingDuration(durationMillis);
    const title = titleOverride?.trim() || `음성 녹음 ${voiceSources.length + 1}`;
    const uploadFile = buildRecordingUploadFile(uri, title);
    const nextSource: VoiceSourceFile = {
      createdAt: formatDemoDate(now),
      durationLabel,
      fileName: uploadFile.name,
      folderName: sessionId ? '기본폴더' : null,
      id: `voice-source-${Date.now()}`,
      mimeType: uploadFile.mimeType,
      sessionId,
      title,
      uri,
    };
    const nextRecording: SessionRecordingFile = {
      audioUrl: uri,
      createdAt: now.toISOString(),
      durationLabel,
      id: nextSource.id,
      title: nextSource.title,
      transcriptLines: [],
      transcriptionStatus: 'local',
    };

    if (sessionId) {
      appendRecordingToSession(sessionId, nextRecording);
    } else {
      setVoiceSources((currentSources) => [nextSource, ...currentSources]);
      if (options.showSavedPrompt ?? true) {
        setVoiceSourceSavedPromptVisible(true);
      }
    }

    return nextSource;
  };

  const saveVoiceSource = async (uri: string, durationMillis: number, sessionId: string | null) => {
    const canUploadToWorkspace = Boolean(sessionId && isRemoteSessionId(sessionId) && uri.startsWith('file'));
    const title = getCommittedRecordingTitle();

    if (!canUploadToWorkspace || !sessionId) {
      saveLocalVoiceSource(uri, durationMillis, sessionId, title);
      setRecordingSaveStatus('local');
      return;
    }

    try {
      setRecordingSaveStatus('saving');
      const result = await uploadWorkspaceRecording(sessionId, buildRecordingUploadFile(uri, title), {
        durationSeconds: durationMillis / 1000,
        title,
      });

      if (result.node && typeof result.node === 'object') {
        updateSessionFromWorkspaceNode(result.node);
      } else {
        updateSessionFromWorkspaceNode(await getWorkspaceSession(sessionId));
      }

      setRecordingSaveStatus('saved');
    } catch (error) {
      saveLocalVoiceSource(uri, durationMillis, sessionId, title);
      setRecordingSaveStatus('failed');
      setRecordingError(error instanceof Error ? `DB 저장 실패: ${error.message}` : 'DB 저장에 실패했습니다.');
    }
  };

  useEffect(() => {
    if (!isRecordingActive || isRecordingPaused) {
      return;
    }

    const timer = setInterval(() => {
      const startedAt = recordingStartedAtRef.current;

      if (startedAt !== null) {
        setRecordingElapsedMillis(recordingAccumulatedMillisRef.current + Date.now() - startedAt);
      }
    }, 100);

    return () => clearInterval(timer);
  }, [isRecordingActive, isRecordingPaused]);

  useEffect(() => {
    if (!isRecordingActive || isRecordingPaused) {
      recordingPulseOpacity.stopAnimation();
      recordingPulseOpacity.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(recordingPulseOpacity, {
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.28,
          useNativeDriver: true,
        }),
        Animated.timing(recordingPulseOpacity, {
          duration: 620,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
      recordingPulseOpacity.setValue(1);
    };
  }, [isRecordingActive, isRecordingPaused, recordingPulseOpacity]);

  const stopRecording = async () => {
    try {
      const status = audioRecorder.getStatus();
      const shouldSaveRecording = status.isRecording || status.canRecord || isRecordingActive || isRecordingPaused;
      const startedSessionId = recordingSessionIdRef.current;
      const currentSessionAtStop = selectedSession;
      const stoppedTitle = getCommittedRecordingTitle();

      if (status.isRecording || status.canRecord) {
        await audioRecorder.stop();
      }

      const startedAt = recordingStartedAtRef.current;
      const finalDurationMillis =
        recordingAccumulatedMillisRef.current + (startedAt === null ? 0 : Date.now() - startedAt);
      setRecordingElapsedMillis(finalDurationMillis);

      recordingStartedAtRef.current = null;
      recordingAccumulatedMillisRef.current = finalDurationMillis;
      setIsRecordingActive(false);
      setIsRecordingPaused(false);
      const stoppedStatus = audioRecorder.getStatus();
      const stoppedUri = audioRecorder.uri ?? stoppedStatus.url ?? `local-recording-${Date.now()}`;
      setLastRecordingUri(stoppedUri);

      if (shouldSaveRecording && !hasSavedCurrentRecordingRef.current) {
        hasSavedCurrentRecordingRef.current = true;
        if (!startedSessionId && currentSessionAtStop) {
          const nextSource = saveLocalVoiceSource(stoppedUri, finalDurationMillis, null, stoppedTitle, {
            showSavedPrompt: false,
          });
          setRecordingSaveStatus('local');
          setVoiceSourceSavedPromptVisible(false);
          setVoiceSaveError(null);
          setRecordingSessionSavePrompt({
            sessionId: currentSessionAtStop.id,
            sessionTitle: currentSessionAtStop.title,
            sourceId: nextSource.id,
          });
        } else {
          await saveVoiceSource(stoppedUri, finalDurationMillis, startedSessionId);
          if (!startedSessionId) {
            setVoiceSourceSavedPromptVisible(true);
          }
        }
      }

      recordingSessionIdRef.current = null;
      await setAudioModeAsync({ allowsRecording: false });

      try {
        // 녹음 종료음 재생 (마이크 해제 후 재생하여 음질 동일하게 유지)
        const stopSoundPlayer = createAudioPlayer('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
        stopSoundPlayer.play();
      } catch (e) {
        console.warn('Failed to play stop sound', e);
      }
    } catch (error) {
      recordingStartedAtRef.current = null;
      recordingAccumulatedMillisRef.current = 0;
      recordingSessionIdRef.current = null;
      setIsRecordingActive(false);
      setIsRecordingPaused(false);
      setRecordingError(error instanceof Error ? error.message : '녹음을 정지하지 못했습니다.');
    }
  };

  const toggleRecordingPause = async () => {
    if (!isRecordingActive && !isRecordingPaused) {
      return;
    }

    try {
      if (isRecordingPaused) {
        audioRecorder.record();
        recordingStartedAtRef.current = Date.now();
        setIsRecordingPaused(false);
        setIsRecordingActive(true);
        return;
      }

      audioRecorder.pause();
      const startedAt = recordingStartedAtRef.current;
      if (startedAt !== null) {
        recordingAccumulatedMillisRef.current += Date.now() - startedAt;
        setRecordingElapsedMillis(recordingAccumulatedMillisRef.current);
      }
      recordingStartedAtRef.current = null;
      setIsRecordingPaused(true);
      setIsRecordingActive(false);
    } catch (error) {
      setRecordingError(error instanceof Error ? error.message : '녹음을 일시정지하지 못했습니다.');
    }
  };

  const closeRecordingSheet = async () => {
    setRecordingSheetVisible(false);
    setIsPreparingRecording(false);
  };

  const startRecording = async () => {
    setQuickActionMenuVisible(false);
    setQuickActionError(null);
    setRecordingSheetVisible(true);
    setRecordingError(null);

    const status = audioRecorder.getStatus();

    if (status.isRecording || status.canRecord || isRecordingActive || isRecordingPaused) {
      return;
    }

    setRecordingElapsedMillis(0);
    setLastRecordingUri(null);
    setRecordingSaveStatus('idle');
    setRecordingTitle(getDefaultRecordingTitle());
    recordingStartedAtRef.current = null;
    recordingAccumulatedMillisRef.current = 0;
    recordingSessionIdRef.current = selectedSessionId;
    hasSavedCurrentRecordingRef.current = false;
    setIsRecordingPaused(false);

    try {
      setIsPreparingRecording(true);
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        setIsRecordingActive(false);
        setRecordingError('마이크 권한이 필요합니다. iPhone 설정에서 마이크 접근을 허용해 주세요.');
        return;
      }

      try {
        // 녹음 시작음 재생 (마이크 활성화 전 일반 모드에서 재생하여 종료음과 음질 동일하게 유지)
        const startSoundPlayer = createAudioPlayer('https://actions.google.com/sounds/v1/alarms/beep_short.ogg');
        startSoundPlayer.play();
        await new Promise((resolve) => setTimeout(resolve, 250)); // 효과음이 짤리지 않도록 아주 잠시 대기
      } catch (e) {
        console.warn('Failed to play start sound', e);
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      recordingStartedAtRef.current = Date.now();
      recordingAccumulatedMillisRef.current = 0;
      setIsRecordingActive(true);
    } catch (error) {
      recordingStartedAtRef.current = null;
      recordingAccumulatedMillisRef.current = 0;
      setIsRecordingActive(false);
      setIsRecordingPaused(false);
      setRecordingError(error instanceof Error ? error.message : '녹음을 시작하지 못했습니다.');
    } finally {
      setIsPreparingRecording(false);
    }
  };

  const openCreateModal = () => {
    setDraftSessionTitle('');
    setDraftSessionTag(fileTags[0]);
    setDraftSessionColor(fileColors[0]);
    setDraftCustomTag('');
    setIsCustomTagInputOpen(false);
    setDraftFolderId(null);
    setCreateModalVisible(true);
  };

  const selectDraftSessionTag = (tag: string) => {
    setDraftSessionTag(tag);
    setDraftCustomTag('');
    setIsCustomTagInputOpen(false);
  };

  const updateDraftCustomTag = (tag: string) => {
    setDraftCustomTag(tag);
    setDraftSessionTag(tag.trim() || fileTags[0]);
  };

  const createDemoSession = async () => {
    const title = draftSessionTitle.trim();
    if (!title) {
      return;
    }

    const tag = draftSessionTag.trim() || fileTags[0];
    const color = draftSessionColor;

    try {
      setWorkspaceStatus('loading');
      const response = await createWorkspaceSession({
        course_id: draftFolderId,
        title,
        tag,
        color,
        file_kind: 'lecture',
      });

      if (response.ok && response.node) {
        const nextSession = workspaceFileToSession(response.node);

        setSessions((currentSessions) => [nextSession, ...currentSessions]);

        const nextTree = await getWorkspaceTree();
        setWorkspaceTree(nextTree);

        openSession(nextSession.id);
        setCreateModalVisible(false);
      }
    } catch (error) {
      console.error(error);
      Alert.alert('오류', error instanceof Error ? error.message : '세션 파일을 생성하지 못했습니다.');
    } finally {
      setWorkspaceStatus('connected');
    }
  };

  const openSavedVoiceSourceTab = () => {
    setVoiceSourceSavedPromptVisible(false);
    setSelectedSessionId(null);
    setActiveTab('음성소스');
    setRecordingSheetVisible(false);
  };

  const addUploadedVoiceSource = (asset: DocumentPickerAsset) => {
    const now = new Date();
    const title = getPickedAudioTitle(asset);
    const uploadFile = buildPickedAudioUploadFile(asset, title);
    const nextSource: VoiceSourceFile = {
      createdAt: formatDemoDate(now),
      durationLabel: '00:00',
      fileName: uploadFile.name,
      folderName: null,
      id: `uploaded-voice-source-${Date.now()}`,
      mimeType: uploadFile.mimeType,
      sessionId: null,
      title,
      uri: asset.uri,
    };

    setVoiceSources((currentSources) => [nextSource, ...currentSources]);
    setSelectedSessionId(null);
    setActiveTab('음성소스');
  };

  const addUploadedVoiceToSession = async (asset: DocumentPickerAsset, sessionId: string) => {
    const now = new Date();
    const title = getPickedAudioTitle(asset);
    const uploadFile = buildPickedAudioUploadFile(asset, title);
    const nextRecording: SessionRecordingFile = {
      audioUrl: asset.uri,
      createdAt: now.toISOString(),
      durationLabel: '00:00',
      id: `uploaded-recording-${Date.now()}`,
      title,
      transcriptLines: [],
      transcriptionStatus: 'local',
    };

    if (isRemoteSessionId(sessionId)) {
      const result = await uploadWorkspaceRecording(sessionId, uploadFile, {
        durationSeconds: 0,
        title,
      });

      if (result.node && typeof result.node === 'object') {
        updateSessionFromWorkspaceNode(result.node);
      } else {
        updateSessionFromWorkspaceNode(await getWorkspaceSession(sessionId));
      }

      return;
    }

    appendRecordingToSession(sessionId, nextRecording);
  };

  const pickVoiceSourceFile = async () => {
    setQuickActionMenuVisible(false);
    setQuickActionError(null);

    try {
      setIsPickingVoiceFile(true);
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: 'audio/*',
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];

      if (selectedSessionId) {
        await addUploadedVoiceToSession(asset, selectedSessionId);
      } else {
        setPendingUploadAsset(asset);
        setUploadDestinationError(null);
        setIsUploadDestinationModalVisible(true);
      }
    } catch (error) {
      setQuickActionError(error instanceof Error ? error.message : '음성소스를 업로드하지 못했습니다.');
      setQuickActionMenuVisible(true);
    } finally {
      setIsPickingVoiceFile(false);
    }
  };

  const handleUploadToSession = async (sessionId: string) => {
    if (!pendingUploadAsset) return;
    try {
      setIsUploadingToDestination(true);
      setUploadDestinationError(null);
      await addUploadedVoiceToSession(pendingUploadAsset, sessionId);
      setIsUploadDestinationModalVisible(false);
      setPendingUploadAsset(null);
      openSession(sessionId);
    } catch (error) {
      setUploadDestinationError(error instanceof Error ? error.message : '음성파일을 세션에 업로드하지 못했습니다.');
    } finally {
      setIsUploadingToDestination(false);
    }
  };

  const openQuickActionCreateModal = () => {
    setQuickActionMenuVisible(false);
    setQuickActionError(null);
    openCreateModal();
  };

  const removeVoiceSource = (sourceId: string) => {
    setVoiceSources((currentSources) => currentSources.filter((source) => source.id !== sourceId));

    if (voiceSaveSourceId === sourceId) {
      setVoiceSaveSourceId(null);
      setVoiceSaveError(null);
    }
  };

  const renameVoiceSource = (sourceId: string, nextTitle: string) => {
    const title = nextTitle.trim();

    if (!title) {
      return;
    }

    setVoiceSources((currentSources) =>
      currentSources.map((source) => (source.id === sourceId ? { ...source, title } : source)),
    );
  };

  const renameRecordingSource = (recordingId: string, nextTitle: string) => {
    const title = nextTitle.trim();

    if (!title) {
      return;
    }

    const renameRecording = (recording: SessionRecordingFile) =>
      recording.id === recordingId ? { ...recording, title } : recording;
    const renameSessionRecordings = (session: SessionFile): SessionFile => ({
      ...session,
      recordings: session.recordings?.map(renameRecording),
    });

    setSessions((currentSessions) => currentSessions.map(renameSessionRecordings));
    setSelectedSessionDetail((currentSession) => (currentSession ? renameSessionRecordings(currentSession) : currentSession));
    setSelectedRecordingSource((currentRecording) =>
      currentRecording?.id === recordingId ? { ...currentRecording, title } : currentRecording,
    );
  };

  const renameMaterialSource = (materialId: string, nextTitle: string) => {
    const title = nextTitle.trim();

    if (!title) {
      return;
    }

    const renameMaterial = (material: SessionMaterialFile) =>
      material.id === materialId ? { ...material, title } : material;
    const renameSessionMaterials = (session: SessionFile): SessionFile => ({
      ...session,
      materials: session.materials?.map(renameMaterial),
    });

    setSessions((currentSessions) => currentSessions.map(renameSessionMaterials));
    setSelectedSessionDetail((currentSession) => (currentSession ? renameSessionMaterials(currentSession) : currentSession));
    setSelectedMaterialSource((currentMaterial) =>
      currentMaterial?.id === materialId ? { ...currentMaterial, title } : currentMaterial,
    );
  };

  const removeRecordingLocally = (recordingId: string) => {
    const removeRecording = (session: SessionFile): SessionFile => ({
      ...session,
      audioSources: session.audioSources.filter((sourceId) => sourceId !== recordingId),
      recordings: session.recordings?.filter((recording) => recording.id !== recordingId),
    });

    setSessions((currentSessions) => currentSessions.map(removeRecording));
    setSelectedSessionDetail((currentSession) => (currentSession ? removeRecording(currentSession) : currentSession));
    setSelectedRecordingSource((currentRecording) => (currentRecording?.id === recordingId ? null : currentRecording));
  };

  const removeMaterialLocally = (materialId: string) => {
    const removeMaterial = (session: SessionFile): SessionFile => ({
      ...session,
      materials: session.materials?.filter((material) => material.id !== materialId),
    });

    setSessions((currentSessions) => currentSessions.map(removeMaterial));
    setSelectedSessionDetail((currentSession) => (currentSession ? removeMaterial(currentSession) : currentSession));
    setSelectedMaterialSource((currentMaterial) => (currentMaterial?.id === materialId ? null : currentMaterial));
  };

  const deleteRecordingSource = async (recordingId: string) => {
    const sessionId = selectedSession?.id ?? selectedSessionId;

    if (!sessionId) {
      removeRecordingLocally(recordingId);
      return;
    }

    try {
      setResourceActionError(null);

      if (isRemoteSessionId(sessionId)) {
        const result = await deleteWorkspaceRecordingData(sessionId, recordingId);

        if (result.node && typeof result.node === 'object') {
          updateSessionFromWorkspaceNode(result.node);
        } else {
          removeRecordingLocally(recordingId);
        }
      } else {
        removeRecordingLocally(recordingId);
      }

      setSelectedRecordingSource((currentRecording) => (currentRecording?.id === recordingId ? null : currentRecording));
    } catch (error) {
      const message = error instanceof Error ? error.message : '음성소스를 삭제하지 못했습니다.';
      setResourceActionError(message);
      setSessionDetailError(message);
    }
  };

  const deleteResource = async (target: ResourceActionTarget) => {
    setResourceActionTarget(null);

    if (target.kind === 'recording') {
      await deleteRecordingSource(target.id);
      return;
    }

    removeMaterialLocally(target.id);
  };

  const openRenameResourceModal = (target: ResourceActionTarget) => {
    setResourceActionTarget(null);
    setRenameResourceTarget(target);
  };

  const renameResource = (target: ResourceActionTarget, nextTitle: string) => {
    if (target.kind === 'recording') {
      renameRecordingSource(target.id, nextTitle);
    } else {
      renameMaterialSource(target.id, nextTitle);
    }

    setRenameResourceTarget(null);
  };

  const saveVoiceSourceToSession = async (sourceId: string, sessionId: string) => {
    const source = voiceSources.find((currentSource) => currentSource.id === sourceId);
    const targetSession = sessions.find((session) => session.id === sessionId);

    if (!source || !targetSession) {
      setVoiceSaveError('저장할 음성소스나 세션 파일을 찾지 못했습니다.');
      return false;
    }

    const appendLocalRecording = (session: SessionFile): SessionFile => {
      const nextRecording: SessionRecordingFile = {
        audioUrl: source.uri,
        createdAt: new Date().toISOString(),
        durationLabel: source.durationLabel,
        id: source.id,
        title: source.title,
        transcriptLines: [],
        transcriptionStatus: 'local',
      };

      return {
        ...session,
        audioSources: [source.id, ...session.audioSources.filter((recordingId) => recordingId !== source.id)],
        recordings: [nextRecording, ...(session.recordings ?? []).filter((recording) => recording.id !== source.id)],
      };
    };

    try {
      setSavingVoiceSourceId(sourceId);
      setVoiceSaveError(null);

      if (isRemoteSessionId(sessionId) && source.uri) {
        const result = await uploadWorkspaceRecording(sessionId, buildVoiceSourceUploadFile(source), {
          durationSeconds: parseDurationLabel(source.durationLabel),
          title: source.title,
        });

        if (result.node && typeof result.node === 'object') {
          updateSessionFromWorkspaceNode(result.node);
        } else {
          updateSessionFromWorkspaceNode(await getWorkspaceSession(sessionId));
        }
      } else {
        setSessions((currentSessions) =>
          currentSessions.map((session) => (session.id === sessionId ? appendLocalRecording(session) : session)),
        );
        setSelectedSessionDetail((currentSession) =>
          currentSession?.id === sessionId ? appendLocalRecording(currentSession) : currentSession,
        );
      }

      setVoiceSources((currentSources) => currentSources.filter((currentSource) => currentSource.id !== sourceId));
      setVoiceSaveSourceId(null);
      setSaveCompletionNotification({
        sessionId,
        sessionTitle: targetSession.title,
      });
      return true;
    } catch (error) {
      setVoiceSaveError(error instanceof Error ? error.message : '음성소스를 세션 파일에 저장하지 못했습니다.');
      return false;
    } finally {
      setSavingVoiceSourceId(null);
    }
  };

  const hasRecordingSession = isRecordingActive || isRecordingPaused || recorderState.isRecording;
  const shouldShowBottomActions =
    !recordingSheetVisible && (!selectedMaterialSource || hasRecordingSession) && (activeTab !== '캘린더' || hasRecordingSession);

  return (
    <View style={styles.appRoot}>
      <View pointerEvents="none" style={styles.topBackdrop} />

      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />

        <View style={styles.screen}>
          {selectedMaterialSource ? (
            <MaterialViewerScreen material={selectedMaterialSource} onBack={() => setSelectedMaterialSource(null)} />
          ) : selectedSession ? (
            <SessionDetailScreen
              error={sessionDetailError}
              isLoading={sessionDetailLoading}
              onOpenMaterial={setSelectedMaterialSource}
              onOpenRecording={setSelectedRecordingSource}
              onOpenResourceMenu={(target) => {
                setResourceActionError(null);
                setResourceActionTarget(target);
              }}
              session={selectedSession}
              onBack={() => setSelectedSessionId(null)}
            />
          ) : (
            <HomeScreen
              activeTab={activeTab}
              calendarError={calendarError}
              calendarSchedules={calendarSchedules}
              calendarStatus={calendarStatus}
              isCalendarRefreshing={isCalendarRefreshing}
              onChangeTab={(tab) => {
                setActiveTab(tab);
                if (tab === '캘린더') {
                  void loadCalendarSchedules('refresh');
                } else if (tab === '폴더' || tab === '최근' || tab === '음성소스') {
                  loadWorkspaceData();
                }
              }}
              onConfirmSchedule={(scheduleId) => {
                void updateCalendarScheduleStatus(scheduleId, 'confirmed');
              }}
              onIgnoreSchedule={(scheduleId) => {
                void updateCalendarScheduleStatus(scheduleId, 'ignored');
              }}
              onOpenSession={openSession}
              onOpenVoiceSaveModal={(sourceId) => {
                setVoiceSaveError(null);
                setVoiceSaveSourceId(sourceId);
              }}
              onRemoveVoiceSource={removeVoiceSource}
              onRenameVoiceSource={renameVoiceSource}
              onRefreshCalendar={() => {
                void loadCalendarSchedules('refresh');
              }}
              recentSessionIds={recentSessionIds}
              sessions={sessions}
              updatingScheduleId={updatingScheduleId}
              voiceSources={voiceSources}
              workspaceError={workspaceError}
              workspaceStatus={workspaceStatus}
              workspaceTree={workspaceTree}
            />
          )}

          {recordingSheetVisible && (
            <RecordingBottomSheet
              isRecordingActive={isRecordingActive}
              isRecordingPaused={isRecordingPaused}
              onChangeTitle={setRecordingTitle}
              onCommitTitle={commitRecordingTitle}
              onClose={closeRecordingSheet}
              onPauseToggle={toggleRecordingPause}
              onStop={stopRecording}
              recordingElapsedMillis={recordingElapsedMillis}
              recorderState={recorderState}
              title={recordingTitle}
            />
          )}

          <RecordingSourcePanel
            onClose={() => setSelectedRecordingSource(null)}
            onDeleteRecording={(recordingId) => {
              void deleteRecordingSource(recordingId);
            }}
            onRenameRecording={renameRecordingSource}
            onTranscriptionComplete={(node) => updateSessionFromWorkspaceNode(node)}
            recording={selectedRecordingSource}
            sessionId={selectedSession?.id ?? null}
            visible={Boolean(selectedRecordingSource)}
          />

          {quickActionMenuVisible && !selectedMaterialSource && (
            <QuickActionMenu
              canCreateFile={!selectedSession}
              error={quickActionError}
              isUploading={isPickingVoiceFile}
              onClose={() => {
                setQuickActionMenuVisible(false);
                setQuickActionError(null);
              }}
              onCreateFile={openQuickActionCreateModal}
              onUploadVoice={() => {
                void pickVoiceSourceFile();
              }}
            />
          )}

          {shouldShowBottomActions && (
            <View style={styles.bottomActions}>
              <Pressable
                accessibilityLabel="녹음 상태 카드 열기"
                onPress={startRecording}
                style={[styles.micButton, hasRecordingSession && styles.micButtonRecording]}>
                <VoiceIcon />
                {hasRecordingSession && (
                  <Animated.View
                    style={[
                      styles.micRecordingDot,
                      isRecordingPaused && styles.micRecordingDotPaused,
                      isRecordingActive && !isRecordingPaused && { opacity: recordingPulseOpacity },
                    ]}
                  />
                )}
              </Pressable>

              {!hasRecordingSession && !selectedMaterialSource && (
                <Pressable
                  accessibilityLabel={quickActionMenuVisible ? '작업 메뉴 닫기' : '작업 메뉴 열기'}
                  onPress={() => {
                    setQuickActionMenuVisible((isVisible) => !isVisible);
                    setQuickActionError(null);
                  }}
                  style={[styles.quickAddButton, quickActionMenuVisible && styles.quickAddButtonOpen]}>
                  <Text style={styles.quickAddText}>{quickActionMenuVisible ? '×' : '+'}</Text>
                </Pressable>
              )}
            </View>
          )}

          <CreateSessionModal
            onCancel={() => setCreateModalVisible(false)}
            customTagValue={draftCustomTag}
            isCustomTagInputOpen={isCustomTagInputOpen}
            onChangeCustomTag={updateDraftCustomTag}
            onChangeColor={setDraftSessionColor}
            onSelectTag={selectDraftSessionTag}
            onToggleCustomTag={() => setIsCustomTagInputOpen((isOpen) => !isOpen)}
            onChangeTitle={setDraftSessionTitle}
            onCreate={createDemoSession}
            selectedColor={draftSessionColor}
            selectedTag={draftSessionTag}
            tagOptions={workspaceTagOptions}
            title={draftSessionTitle}
            visible={createModalVisible}
            tree={workspaceTree}
            selectedFolderId={draftFolderId}
            onSelectFolder={setDraftFolderId}
          />

          <VoiceSaveCompletionModal
            visible={Boolean(saveCompletionNotification)}
            sessionTitle={saveCompletionNotification?.sessionTitle ?? ''}
            onClose={() => setSaveCompletionNotification(null)}
            onMove={() => {
              if (saveCompletionNotification) {
                openSession(saveCompletionNotification.sessionId);
                setSaveCompletionNotification(null);
              }
            }}
          />

          <VoiceSourceSavedPrompt
            onClose={() => setVoiceSourceSavedPromptVisible(false)}
            onMove={openSavedVoiceSourceTab}
            visible={voiceSourceSavedPromptVisible}
          />

          <RecordingSessionSavePrompt
            error={voiceSaveError}
            isSaving={savingVoiceSourceId === recordingSessionSavePrompt?.sourceId}
            onClose={() => {
              setRecordingSessionSavePrompt(null);
              setVoiceSaveError(null);
            }}
            onSave={() => {
              if (!recordingSessionSavePrompt) {
                return;
              }

              void saveVoiceSourceToSession(
                recordingSessionSavePrompt.sourceId,
                recordingSessionSavePrompt.sessionId,
              ).then((saved) => {
                if (saved) {
                  setRecordingSessionSavePrompt(null);
                  setVoiceSaveError(null);
                }
              });
            }}
            prompt={recordingSessionSavePrompt}
          />

          <VoiceSaveDestinationModal
            error={voiceSaveError}
            isSaving={savingVoiceSourceId === voiceSaveSourceId}
            onClose={() => {
              if (savingVoiceSourceId) {
                return;
              }

              setVoiceSaveSourceId(null);
              setVoiceSaveError(null);
            }}
            onSelectSession={(sessionId) => {
              if (voiceSaveSourceId) {
                void saveVoiceSourceToSession(voiceSaveSourceId, sessionId);
              }
            }}
            sessions={sessions}
            source={selectedVoiceSaveSource}
            tree={workspaceTree}
            visible={Boolean(voiceSaveSourceId)}
          />

          <UploadDestinationModal
            error={uploadDestinationError}
            isSaving={isUploadingToDestination}
            onClose={() => {
              setIsUploadDestinationModalVisible(false);
              setPendingUploadAsset(null);
              setUploadDestinationError(null);
            }}
            onSelectSession={(sessionId) => {
              void handleUploadToSession(sessionId);
            }}
            tree={workspaceTree}
            visible={isUploadDestinationModalVisible}
          />

          <ResourceActionMenu
            error={resourceActionError}
            onClose={() => {
              setResourceActionTarget(null);
              setResourceActionError(null);
            }}
            onDelete={(target) => {
              void deleteResource(target);
            }}
            onRename={openRenameResourceModal}
            target={resourceActionTarget}
          />

          <RenameResourceModal
            onCancel={() => setRenameResourceTarget(null)}
            onSave={renameResource}
            target={renameResourceTarget}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

function HomeScreen({
  activeTab,
  calendarError,
  calendarSchedules,
  calendarStatus,
  isCalendarRefreshing,
  onChangeTab,
  onConfirmSchedule,
  onIgnoreSchedule,
  onOpenSession,
  onOpenVoiceSaveModal,
  onRemoveVoiceSource,
  onRenameVoiceSource,
  onRefreshCalendar,
  recentSessionIds,
  sessions,
  updatingScheduleId,
  voiceSources,
  workspaceError,
  workspaceStatus,
  workspaceTree,
}: {
  activeTab: HomeTab;
  calendarError: string | null;
  calendarSchedules: MobileScheduleItem[];
  calendarStatus: WorkspaceLoadStatus;
  isCalendarRefreshing: boolean;
  onChangeTab: (tab: HomeTab) => void;
  onConfirmSchedule: (scheduleId: string) => void;
  onIgnoreSchedule: (scheduleId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenVoiceSaveModal: (sourceId: string) => void;
  onRemoveVoiceSource: (sourceId: string) => void;
  onRenameVoiceSource: (sourceId: string, title: string) => void;
  onRefreshCalendar: () => void;
  recentSessionIds: string[];
  sessions: SessionFile[];
  updatingScheduleId: string | null;
  voiceSources: VoiceSourceFile[];
  workspaceError: string | null;
  workspaceStatus: WorkspaceLoadStatus;
  workspaceTree: WorkspaceNode[];
}) {
  const openedRecentSessions = recentSessionIds
    .map((sessionId) => sessions.find((session) => session.id === sessionId))
    .filter((session): session is SessionFile => Boolean(session));
  const fallbackSessions = sessions.filter((session) => !recentSessionIds.includes(session.id));
  const recentSessions = [...openedRecentSessions, ...fallbackSessions].slice(0, 2);

  const upcomingSchedule = calendarSchedules[0];
  const pendingSchedule = calendarSchedules.find((s) => s.status === 'pending' && s.id !== upcomingSchedule?.id);

  return (
    <>
      <View style={styles.topPanel}>
        <View style={styles.header}>
          <Pressable onPress={() => DeviceEventEmitter.emit('globalRefresh')}>
            <Image source={require('./assets/groupchat/logo.png')} style={styles.projectLogo} />
          </Pressable>
          <Image source={require('./assets/groupchat/Btitle.png')} style={styles.headerTitleImage} />
        </View>

        <View style={styles.tabRow}>
          {tabs.map((tab) => (
            <Pressable
              accessibilityLabel={`${tab} 탭`}
              key={tab}
              onPress={() => onChangeTab(tab)}
              style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}>
              <HomeTabIcon active={activeTab === tab} tab={tab} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.contentArea}>
        <AnimatedGridBackground />

        <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
          {activeTab === '최근' && (
            <>
              <WelcomeAnimation />
              <WorkspaceStatusBanner error={workspaceError} status={workspaceStatus} />

              {upcomingSchedule && (
                <View style={{ marginBottom: pendingSchedule ? 14 : 14 }}>
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '900',
                    color: '#8A8F98',
                    marginBottom: 8,
                    marginLeft: 6
                  }}>다가오는 일정</Text>
                  <Pressable 
                    onPress={() => {
                      onChangeTab('캘린더');
                      setTimeout(() => {
                        DeviceEventEmitter.emit('goToCalendarDate', upcomingSchedule.dateKey);
                      }, 50);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#FFFFFF',
                      borderColor: '#E3E7EF',
                      borderWidth: 1,
                      borderRadius: 30,
                      paddingHorizontal: 20,
                      paddingVertical: 16,
                    }}>
                    <Text style={{ color: upcomingSchedule.status === 'pending' ? '#F97316' : '#355CFF', fontWeight: '900', fontSize: 15, marginRight: 14 }}>
                      {upcomingSchedule.dateKey.slice(5).replace('-', '.')}
                    </Text>
                    <Text style={{ flex: 1, color: '#111318', fontWeight: '800', fontSize: 15 }} numberOfLines={1}>
                      {upcomingSchedule.title}
                    </Text>
                    <Text style={{ color: upcomingSchedule.status === 'pending' ? '#F97316' : '#8A8F98', fontWeight: '700', fontSize: 13, marginLeft: 10 }}>
                      {upcomingSchedule.status === 'pending' ? '확인 대기' : '예정'}
                    </Text>
                  </Pressable>
                </View>
              )}

              {pendingSchedule && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '900',
                    color: '#8A8F98',
                    marginBottom: 8,
                    marginLeft: 6
                  }}>확인 대기 일정</Text>
                  <Pressable 
                    onPress={() => {
                      onChangeTab('캘린더');
                      setTimeout(() => {
                        DeviceEventEmitter.emit('goToCalendarDate', pendingSchedule.dateKey);
                      }, 50);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: '#FFFFFF',
                      borderColor: '#E3E7EF',
                      borderWidth: 1,
                      borderRadius: 30,
                      paddingHorizontal: 20,
                      paddingVertical: 16,
                    }}>
                    <Text style={{ color: '#F97316', fontWeight: '900', fontSize: 15, marginRight: 14 }}>
                      {pendingSchedule.dateKey.slice(5).replace('-', '.')}
                    </Text>
                    <Text style={{ flex: 1, color: '#111318', fontWeight: '800', fontSize: 15 }} numberOfLines={1}>
                      {pendingSchedule.title}
                    </Text>
                    <Text style={{ color: '#F97316', fontWeight: '700', fontSize: 13, marginLeft: 10 }}>
                      확인 대기
                    </Text>
                  </Pressable>
                </View>
              )}

              {recentSessions.length > 0 ? (
                recentSessions.map((file) => (
                  <SessionFileCard key={file.id} file={file} onPress={() => onOpenSession(file.id)} />
                ))
              ) : (
                <RecentEmptyState status={workspaceStatus} />
              )}
            </>
          )}

          {activeTab === '음성소스' && (
            <VoiceSourceTab
              onOpenSaveModal={onOpenVoiceSaveModal}
              onRemoveSource={onRemoveVoiceSource}
              onRenameSource={onRenameVoiceSource}
              sessions={sessions}
              voiceSources={voiceSources}
            />
          )}

          {activeTab === '폴더' && (
            <WorkspaceFolderTab
              onOpenSession={onOpenSession}
              status={workspaceStatus}
              tree={workspaceTree}
            />
          )}

          {activeTab === '캘린더' && (
            <CalendarTab
              error={calendarError}
              isRefreshing={isCalendarRefreshing}
              onConfirmSchedule={onConfirmSchedule}
              onIgnoreSchedule={onIgnoreSchedule}
              onOpenSession={onOpenSession}
              onRefresh={onRefreshCalendar}
              schedules={calendarSchedules}
              status={calendarStatus}
              updatingScheduleId={updatingScheduleId}
            />
          )}

        </ScrollView>
      </View>
    </>
  );
}

function HomeTabIcon({ active, tab }: { active: boolean; tab: HomeTab }) {
  const iconColor = active ? '#FFFFFF' : 'rgba(255,255,255,0.72)';

  if (tab === '음성소스') {
    return <SourceVoiceIcon color={iconColor} size={30} />;
  }

  if (tab === '캘린더') {
    return <Feather color={iconColor} name="calendar" size={26} strokeWidth={2.5} />;
  }

  const iconName = tab === '최근' ? 'home' : 'folder';

  return <Feather color={iconColor} name={iconName} size={26} strokeWidth={2.5} />;
}

function QuickActionMenu({
  canCreateFile,
  error,
  isUploading,
  onClose,
  onCreateFile,
  onUploadVoice,
}: {
  canCreateFile: boolean;
  error: string | null;
  isUploading: boolean;
  onClose: () => void;
  onCreateFile: () => void;
  onUploadVoice: () => void;
}) {
  return (
    <View style={styles.quickActionLayer}>
      <Pressable accessibilityLabel="작업 메뉴 닫기" onPress={onClose} style={styles.quickActionBackdrop} />

      <View style={styles.quickActionMenu}>
        {canCreateFile && (
          <Pressable onPress={onCreateFile} style={styles.quickActionItem}>
            <MaterialIcons color="#FFFFFF" name="note-add" size={24} />
            <Text style={styles.quickActionText}>파일 만들기</Text>
          </Pressable>
        )}

        <Pressable
          disabled={isUploading}
          onPress={onUploadVoice}
          style={[styles.quickActionItem, isUploading && styles.quickActionItemDisabled]}>
          <Feather color="#FFFFFF" name="upload" size={24} strokeWidth={2.6} />
          <Text style={styles.quickActionText}>{isUploading ? '업로드 중...' : '음성소스 업로드'}</Text>
        </Pressable>

        {error && <Text style={styles.quickActionError}>{error}</Text>}
      </View>
    </View>
  );
}

function MaterialViewerScreen({
  material,
  onBack,
}: {
  material: SessionMaterialFile;
  onBack: () => void;
}) {
  const shouldUsePdfViewer = Boolean(material.url && isPdfMaterial(material));
  const webViewSource =
    material.url && shouldUsePdfViewer
      ? {
          baseUrl: getWorkspaceApiBaseUrl(),
          html: createReadonlyPdfViewerHtml(material.url, material.annotations),
        }
      : material.url
        ? { uri: material.url }
        : undefined;

  return (
    <>
      <View style={styles.detailTopPanel}>
        <View style={styles.detailHeader}>
          <Pressable accessibilityLabel="강의자료 뒤로가기" onPress={onBack} style={styles.detailBackButton}>
            <Text style={styles.detailBackText}>‹</Text>
          </Pressable>

          <View style={styles.detailTitleWrap}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.detailTitle}>
              {material.title}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.contentArea}>
        <AnimatedGridBackground />

        {webViewSource ? (
          <View style={styles.materialViewerFrame}>
            <WebView
              allowFileAccess
              allowUniversalAccessFromFileURLs
              allowsBackForwardNavigationGestures
              domStorageEnabled
              javaScriptEnabled
              key={`${material.id}-${shouldUsePdfViewer ? 'pdf' : 'raw'}`}
              mixedContentMode="always"
              originWhitelist={['*']}
              source={webViewSource}
              startInLoadingState
              style={styles.materialWebView}
            />
          </View>
        ) : (
          <View style={styles.materialViewerEmpty}>
            <View style={styles.documentIconBox}>
              <SourceMaterialIcon />
            </View>
            <Text style={styles.materialViewerEmptyTitle}>강의자료 주소가 없습니다.</Text>
            <Text style={styles.materialViewerEmptyDescription}>
              DB에 저장된 파일 주소가 있어야 앱 안에서 자료를 볼 수 있습니다.
            </Text>
          </View>
        )}
      </View>
    </>
  );
}

function ResourceActionMenu({
  error,
  onClose,
  onDelete,
  onRename,
  target,
}: {
  error: string | null;
  onClose: () => void;
  onDelete: (target: ResourceActionTarget) => void;
  onRename: (target: ResourceActionTarget) => void;
  target: ResourceActionTarget | null;
}) {
  if (!target) {
    return null;
  }

  const deleteLabel = target.kind === 'recording' ? '음성 소스 삭제' : '강의자료 삭제';

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={styles.resourceActionLayer}>
        <Pressable accessibilityLabel="편집 메뉴 닫기" onPress={onClose} style={styles.resourceActionBackdrop} />

        <View style={styles.resourceActionCard}>
          <Text numberOfLines={1} style={styles.resourceActionTitle}>
            {target.title}
          </Text>

          <Pressable onPress={() => onRename(target)} style={styles.resourceActionItem}>
            <MaterialIcons color="#202329" name="edit" size={21} />
            <Text style={styles.resourceActionText}>이름 변경</Text>
          </Pressable>

          <View style={styles.resourceActionDivider} />

          <Pressable onPress={() => onDelete(target)} style={styles.resourceActionItem}>
            <MaterialIcons color="#D92D20" name="delete" size={21} />
            <Text style={styles.resourceActionDangerText}>{deleteLabel}</Text>
          </Pressable>

          {error && <Text style={styles.resourceActionError}>{error}</Text>}
        </View>
      </View>
    </Modal>
  );
}

function RenameResourceModal({
  onCancel,
  onSave,
  target,
}: {
  onCancel: () => void;
  onSave: (target: ResourceActionTarget, title: string) => void;
  target: ResourceActionTarget | null;
}) {
  const [draftTitle, setDraftTitle] = useState(target?.title ?? '');

  useEffect(() => {
    setDraftTitle(target?.title ?? '');
  }, [target?.id, target?.title]);

  if (!target) {
    return null;
  }

  const title = target.kind === 'recording' ? '음성소스 이름 변경' : '강의자료 이름 변경';
  const canSave = draftTitle.trim().length > 0;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onCancel}>
      <View style={styles.resourceActionLayer}>
        <Pressable accessibilityLabel="이름 변경 닫기" onPress={onCancel} style={styles.resourceActionBackdrop} />

        <View style={styles.renameResourceCard}>
          <Text style={styles.renameResourceTitle}>{title}</Text>
          <TextInput
            maxLength={80}
            onChangeText={setDraftTitle}
            placeholder="이름 입력"
            placeholderTextColor="#9AA2B1"
            returnKeyType="done"
            selectTextOnFocus
            style={styles.renameResourceInput}
            value={draftTitle}
          />

          <View style={styles.renameResourceActions}>
            <Pressable onPress={onCancel} style={styles.renameResourceCancelButton}>
              <Text style={styles.renameResourceCancelText}>취소</Text>
            </Pressable>
            <Pressable
              disabled={!canSave}
              onPress={() => onSave(target, draftTitle)}
              style={[styles.renameResourceSaveButton, !canSave && styles.renameResourceSaveButtonDisabled]}>
              <Text style={styles.renameResourceSaveText}>저장</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SessionDetailScreen({
  error,
  isLoading,
  onBack,
  onOpenMaterial,
  onOpenRecording,
  onOpenResourceMenu,
  session,
}: {
  error: string | null;
  isLoading: boolean;
  onBack: () => void;
  onOpenMaterial: (material: SessionMaterialFile) => void;
  onOpenRecording: (recording: SessionRecordingFile) => void;
  onOpenResourceMenu: (target: ResourceActionTarget) => void;
  session: SessionFile;
}) {
  const materials = session.materials ?? [];
  const recordings = session.recordings ?? [];
  const hasResources = materials.length > 0 || recordings.length > 0;

  return (
    <>
      <View style={styles.detailTopPanel}>
        <View style={styles.detailHeader}>
          <Pressable accessibilityLabel="뒤로가기" onPress={onBack} style={styles.detailBackButton}>
            <Text style={styles.detailBackText}>‹</Text>
          </Pressable>

          <View style={styles.detailTitleWrap}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72} style={styles.detailTitle}>
              {session.title}
            </Text>
            <Text style={styles.detailSubtitle}>
              자료 {materials.length}개 · 음성 소스 {getSessionRecordingCount(session)}개
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.contentArea}>
        <AnimatedGridBackground />

        <ScrollView
          bounces={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.sessionDetailContent}>
          {isLoading && <DetailStatusCard message="DB 세션 정보를 불러오는 중..." tone="info" />}
          {error && <DetailStatusCard message={error} tone="warning" />}

          {materials.length > 0 && (
            <SessionResourceSection title="강의자료">
              {materials.map((material) => (
                <SessionResourceCard
                  key={material.id}
                  kind="material"
                  meta={material.meta}
                  onOpenMenu={() => onOpenResourceMenu({ id: material.id, kind: 'material', title: material.title })}
                  onPress={() => onOpenMaterial(material)}
                  title={material.title}
                />
              ))}
            </SessionResourceSection>
          )}

          {recordings.length > 0 && (
            <SessionResourceSection title="음성소스">
              {recordings.map((recording) => (
                <SessionResourceCard
                  key={recording.id}
                  kind="recording"
                  meta={formatRecordingResourceMeta(recording)}
                  onOpenMenu={() => onOpenResourceMenu({ id: recording.id, kind: 'recording', title: recording.title })}
                  onPress={() => onOpenRecording(recording)}
                  title={recording.title}
                />
              ))}
            </SessionResourceSection>
          )}

          {!hasResources && !isLoading && (
            <View style={styles.emptySourceCard}>
              <View style={styles.emptySourceIcon}>
                <VoiceIcon />
              </View>
              <Text style={styles.emptySourceTitle}>아직 저장된 음성 소스가 없습니다.</Text>
              <Text style={styles.emptySourceDescription}>
                DB 세션은 열렸지만 연결된 강의자료나 음성소스가 없습니다.
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    </>
  );
}

function DetailStatusCard({
  message,
  tone,
}: {
  message: string;
  tone: 'info' | 'warning';
}) {
  const isWarning = tone === 'warning';

  return (
    <View style={[styles.detailStatusCard, isWarning && styles.detailStatusCardWarning]}>
      <Text style={[styles.detailStatusText, isWarning && styles.detailStatusTextWarning]}>{message}</Text>
    </View>
  );
}

function SessionResourceSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <View style={styles.resourceSection}>
      <Text style={styles.resourceSectionTitle}>{title}</Text>
      <View style={styles.resourceList}>{children}</View>
    </View>
  );
}

function SessionResourceCard({
  kind,
  meta,
  onOpenMenu,
  onPress,
  title,
}: {
  kind: SessionResourceKind;
  meta: string;
  onOpenMenu: () => void;
  onPress?: () => void;
  title: string;
}) {
  const isRecording = kind === 'recording';
  const isMaterial = kind === 'material';
  const cardContent = (
    <>
      <View style={[styles.resourceIconBox, isRecording && styles.resourceVoiceIconBox]}>
        {isRecording ? <SourceVoiceIcon /> : <SourceMaterialIcon />}
      </View>

      <View style={styles.resourceTextColumn}>
        <Text numberOfLines={1} style={styles.resourceTitle}>
          {title}
        </Text>
        {!isMaterial && (
          <Text numberOfLines={1} style={styles.resourceMeta}>
            {meta}
          </Text>
        )}
      </View>
    </>
  );

  return (
    <View style={[styles.resourceCardFrame, isMaterial && styles.resourceMaterialCard]}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={({ pressed }) => [styles.resourceCardPressArea, pressed && styles.resourceCardPressed]}>
          {cardContent}
        </Pressable>
      ) : (
        <View style={styles.resourceCardPressArea}>{cardContent}</View>
      )}

      <Pressable accessibilityLabel={`${title} 편집 메뉴`} onPress={onOpenMenu} style={styles.resourceMoreButton}>
        <MaterialIcons color="#6F7888" name="more-horiz" size={24} />
      </Pressable>
    </View>
  );
}

function SourceMaterialIcon() {
  return (
    <View style={styles.sourcePdfIcon}>
      <View style={styles.sourcePdfBackSheet} />
      <View style={styles.sourcePdfPage}>
        <View style={styles.sourcePdfFold} />
        <Text style={styles.sourcePdfText}>PDF</Text>
      </View>
    </View>
  );
}

function SourceVoiceIcon({ color = '#F59E0B', size = 32 }: { color?: string; size?: number }) {
  const scale = size / 32;

  return (
    <View style={[styles.sourceWaveIcon, { height: size, width: size }]}>
      {sourceWaveBars.map((height, index) => (
        <View
          key={`source-wave-${index}`}
          style={[styles.sourceWaveBar, { backgroundColor: color, height: height * scale, width: 2 * scale }]}
        />
      ))}
    </View>
  );
}

function RecordingSourcePanel({
  onClose,
  onDeleteRecording,
  onRenameRecording,
  onTranscriptionComplete,
  recording,
  sessionId,
  visible,
}: {
  onClose: () => void;
  onDeleteRecording: (recordingId: string) => void;
  onRenameRecording: (recordingId: string, title: string) => void;
  onTranscriptionComplete: (node: WorkspaceSessionNode) => void;
  recording: SessionRecordingFile | null;
  sessionId: string | null;
  visible: boolean;
}) {
  const { height } = useWindowDimensions();
  const audioSource = recording?.audioUrl ? { uri: recording.audioUrl } : null;
  const player = useAudioPlayer(audioSource, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [isSourceMenuVisible, setIsSourceMenuVisible] = useState(false);
  const [draftTitle, setDraftTitle] = useState(recording?.title ?? '');
  const titleInputRef = useRef<TextInput>(null);
  const sourceSheetY = useRef(new Animated.Value(height)).current;
  const sourceSheetCurrentY = useRef(height);

  const fallbackDuration = parseDurationLabel(recording?.durationLabel);
  const duration = playerStatus.duration > 0 ? playerStatus.duration : fallbackDuration;
  const progress = duration > 0 ? Math.min(1, Math.max(0, playerStatus.currentTime / duration)) : 0;
  const transcriptLines = recording?.transcriptLines ?? [];
  const canRequestTranscription = Boolean(
    recording?.audioUrl && recording?.id && sessionId && isRemoteSessionId(sessionId),
  );
  const visiblePanelError = panelError ?? recording?.transcriptError ?? null;
  const activeTranscriptLineId =
    transcriptLines
      .filter((line) => typeof line.startSeconds === 'number' && line.startSeconds <= playerStatus.currentTime)
      .at(-1)?.id ?? transcriptLines[0]?.id;
  const expandedY = 100;
  const collapsedY = Math.max(height - 570, 190);
  const hiddenY = height + 24;

  const snapSourcePanelTo = (nextY: number, expanded: boolean, closeWhenDone = false) => {
    setIsPanelExpanded(expanded);
    Animated.spring(sourceSheetY, {
      damping: 28,
      mass: 0.9,
      stiffness: 210,
      toValue: nextY,
      useNativeDriver: true,
    }).start(() => {
      sourceSheetCurrentY.current = nextY;
      if (closeWhenDone) {
        onClose();
      }
    });
  };

  useEffect(() => {
    setPanelError(null);
    setIsTitleEditing(false);
    setIsSourceMenuVisible(false);
    setDraftTitle(recording?.title ?? '');
    player.pause();
    void player.seekTo(0).catch(() => undefined);
  }, [player, recording?.id]);

  useEffect(() => {
    if (!isTitleEditing) {
      setDraftTitle(recording?.title ?? '');
    }
  }, [isTitleEditing, recording?.title]);

  useEffect(() => {
    if (!isTitleEditing) {
      return;
    }

    const timer = setTimeout(() => titleInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isTitleEditing]);

  useEffect(() => {
    if (!visible) {
      player.pause();
    }
  }, [player, visible]);

  useEffect(() => {
    if (!visible) {
      sourceSheetCurrentY.current = hiddenY;
      sourceSheetY.setValue(hiddenY);
      setIsPanelExpanded(false);
      return;
    }

    sourceSheetCurrentY.current = hiddenY;
    sourceSheetY.setValue(hiddenY);
    snapSourcePanelTo(collapsedY, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedY, hiddenY, recording?.id, visible]);

  if (!recording) {
    return null;
  }

  const finishTitleEditing = () => {
    const nextTitle = draftTitle.trim() || recording.title;
    onRenameRecording(recording.id, nextTitle);
    setDraftTitle(nextTitle);
    setIsTitleEditing(false);
  };

  const deleteCurrentRecording = () => {
    setIsSourceMenuVisible(false);
    onDeleteRecording(recording.id);
    onClose();
  };

  const togglePlayback = async () => {
    if (!recording.audioUrl) {
      setPanelError('재생할 음성 파일 주소가 없습니다.');
      return;
    }

    try {
      setPanelError(null);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      if (playerStatus.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '음성 재생을 시작하지 못했습니다.');
    }
  };

  const seekPlayback = async (offsetSeconds: number) => {
    if (!recording.audioUrl) {
      return;
    }

    try {
      const nextTime = clamp(playerStatus.currentTime + offsetSeconds, 0, duration || playerStatus.currentTime);
      await player.seekTo(nextTime);
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '재생 위치를 이동하지 못했습니다.');
    }
  };

  const playTranscriptLine = async (line: SessionTranscriptLine) => {
    if (!recording.audioUrl) {
      setPanelError('재생할 음성 파일 주소가 없습니다.');
      return;
    }

    const nextTime = typeof line.startSeconds === 'number' ? line.startSeconds : parseDurationLabel(line.time);

    try {
      setPanelError(null);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      await player.seekTo(clamp(nextTime, 0, duration || nextTime));
      player.play();
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '해당 구간을 재생하지 못했습니다.');
    }
  };

  const requestTranscription = async () => {
    if (!canRequestTranscription || !sessionId) {
      setPanelError('DB에 저장된 음성 파일만 스크립트를 생성할 수 있습니다.');
      return;
    }

    try {
      setIsTranscribing(true);
      setPanelError(null);
      const result = await transcribeWorkspaceRecording(sessionId, recording.id);
      const node = result.node;

      if (node && typeof node === 'object') {
        onTranscriptionComplete(node as WorkspaceSessionNode);
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '스크립트를 생성하지 못했습니다.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const sourcePanResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      sourceSheetY.stopAnimation((value) => {
        sourceSheetCurrentY.current = typeof value === 'number' ? value : sourceSheetCurrentY.current;
      });
    },
    onPanResponderMove: (_, gesture) => {
      const nextY = clamp(sourceSheetCurrentY.current + gesture.dy, expandedY, hiddenY);
      sourceSheetY.setValue(nextY);
    },
    onPanResponderRelease: (_, gesture) => {
      const nextY = clamp(sourceSheetCurrentY.current + gesture.dy, expandedY, hiddenY);
      const wasExpanded = isPanelExpanded || sourceSheetCurrentY.current < collapsedY - 24;

      if (gesture.vy < -0.45 || nextY < collapsedY - 80) {
        snapSourcePanelTo(expandedY, true);
        return;
      }

      if (wasExpanded && (gesture.vy > 0.45 || nextY > collapsedY - 24)) {
        snapSourcePanelTo(collapsedY, false);
        return;
      }

      if (gesture.vy > 0.75 && nextY > collapsedY + 80) {
        snapSourcePanelTo(hiddenY, false, true);
        return;
      }

      snapSourcePanelTo(collapsedY, false);
    },
  });

  return (
    <Modal animationType="none" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.recordingSourceOverlay}>
        <Pressable accessibilityLabel="음성 소스 닫기" onPress={onClose} style={styles.recordingSourceBackdrop} />

        <Animated.View
          style={[
            styles.recordingSourcePanel,
            {
              height: height + 18,
              transform: [{ translateY: sourceSheetY }],
            },
          ]}>
          <View {...sourcePanResponder.panHandlers} style={styles.recordingSourceDragArea}>
            <View style={styles.recordingSourceHandle} />
          </View>

          <Pressable
            accessibilityLabel="음성 소스 메뉴"
            onPress={() => setIsSourceMenuVisible((isVisible) => !isVisible)}
            style={styles.recordingSourceMoreButton}>
            <MaterialIcons color="#202329" name="more-horiz" size={28} />
          </Pressable>

          {isSourceMenuVisible && (
            <>
              <Pressable
                accessibilityLabel="음성 소스 메뉴 닫기"
                onPress={() => setIsSourceMenuVisible(false)}
                style={styles.recordingSourceMenuBackdrop}
              />
              <View style={styles.recordingSourceMenu}>
                <Pressable onPress={deleteCurrentRecording} style={styles.recordingSourceMenuItem}>
                  <MaterialIcons color="#D92D20" name="delete" size={20} />
                  <Text style={styles.recordingSourceMenuDangerText}>음성 소스 삭제</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable accessibilityLabel="전사 화면 닫기" onPress={onClose} style={styles.recordingSourceCloseButton}>
            <Text style={styles.recordingSourceCloseText}>×</Text>
          </Pressable>

          <View style={styles.recordingSourceHeader}>
            <View style={styles.recordingSourceTitleWrap}>
              {isTitleEditing ? (
                <TextInput
                  ref={titleInputRef}
                  maxLength={70}
                  onBlur={finishTitleEditing}
                  onChangeText={setDraftTitle}
                  onSubmitEditing={finishTitleEditing}
                  returnKeyType="done"
                  selectTextOnFocus
                  style={styles.recordingSourceTitleInput}
                  value={draftTitle}
                />
              ) : (
                <Pressable
                  accessibilityLabel="음성소스 이름 변경"
                  onPress={() => {
                    setDraftTitle(recording.title);
                    setIsTitleEditing(true);
                  }}
                  style={styles.recordingSourceTitleButton}>
                  <Text numberOfLines={1} style={styles.recordingSourceTitle}>
                    {recording.title}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          <View style={styles.sourcePlayerCard}>
            <View style={styles.sourceProgressTrack}>
              <View style={[styles.sourceProgressFill, { width: `${progress * 100}%` }]} />
              <View style={[styles.sourceProgressThumb, { left: `${progress * 100}%` }]} />
            </View>

            <View style={styles.sourcePlayerTimeRow}>
              <Text style={styles.sourcePlayerTime}>{formatPlaybackTime(playerStatus.currentTime)}</Text>
              <Text style={styles.sourcePlayerTime}>{formatPlaybackTime(duration)}</Text>
            </View>

            <View style={styles.sourcePlayerControls}>
              <Pressable onPress={() => seekPlayback(-5)} style={styles.sourceSeekButton}>
                <Text style={styles.sourceSeekButtonText}>↺5</Text>
              </Pressable>

              <Pressable onPress={togglePlayback} style={styles.sourcePlayButton}>
                <Text style={styles.sourcePlayButtonText}>{playerStatus.playing ? 'Ⅱ' : '▶'}</Text>
              </Pressable>

              <Pressable onPress={() => seekPlayback(5)} style={styles.sourceSeekButton}>
                <Text style={styles.sourceSeekButtonText}>↻5</Text>
              </Pressable>

              <Text style={styles.sourceSpeedText}>1x</Text>
            </View>
          </View>

          {visiblePanelError && (
            <View style={styles.sourcePanelError}>
              <Text style={styles.sourcePanelErrorText}>{visiblePanelError}</Text>
            </View>
          )}

          <View style={styles.transcriptPanelHeader}>
            <Text style={styles.transcriptPanelTitle}>스크립트</Text>
          </View>

          {transcriptLines.length > 0 ? (
            <ScrollView
              bounces
              showsVerticalScrollIndicator={false}
              style={[styles.transcriptScroll, isPanelExpanded && { maxHeight: Math.max(260, height - expandedY - 250) }]}>
              {transcriptLines.map((line) => {
                const isActiveLine = line.id === activeTranscriptLineId;

                return (
                  <Pressable key={line.id} onPress={() => playTranscriptLine(line)} style={styles.transcriptLineBlock}>
                    <Text style={[styles.transcriptLineTime, isActiveLine && styles.transcriptLineTimeActive]}>
                      {line.time}
                    </Text>
                    <Text style={[styles.transcriptLineText, isActiveLine && styles.transcriptLineTextActive]}>
                      {line.text}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.transcriptEmptyCard}>
              <Text style={styles.transcriptEmptyTitle}>
                {recording.transcriptionStatus === 'processing' || isTranscribing
                  ? '스크립트를 생성하는 중입니다.'
                  : '저장된 스크립트가 없습니다.'}
              </Text>
              <Text style={styles.transcriptEmptyDescription}>
                {canRequestTranscription
                  ? '필요하면 이 음성 파일을 전사해서 스크립트를 만들 수 있습니다.'
                  : '음성 파일 주소가 없으면 재생과 전사 요청을 할 수 없습니다.'}
              </Text>

              {canRequestTranscription && (
                <Pressable
                  disabled={isTranscribing}
                  onPress={requestTranscription}
                  style={[styles.transcriptRequestButton, isTranscribing && styles.transcriptRequestButtonDisabled]}>
                  <Text style={styles.transcriptRequestButtonText}>
                    {isTranscribing ? '생성 중...' : '스크립트 생성'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

function WorkspaceStatusBanner({
  error,
  status,
}: {
  error: string | null;
  status: WorkspaceLoadStatus;
}) {
  if (status === 'connected') {
    return null;
  }

  return (
    <View style={[styles.workspaceStatusCard, status === 'fallback' && styles.workspaceStatusCardWarning]}>
      <Text style={[styles.workspaceStatusText, status === 'fallback' && styles.workspaceStatusTextWarning]}>
        {status === 'loading' ? 'DB 파일을 불러오는 중...' : (error ?? 'DB 연결 실패 · 데모 파일 표시 중')}
      </Text>
    </View>
  );
}

function RecentEmptyState({ status }: { status: WorkspaceLoadStatus }) {
  const isConnected = status === 'connected';

  return (
    <View style={styles.recentEmptyCard}>
      <View style={[styles.emptySourceIcon, styles.emptyDocumentIcon]}>
        <DocumentIcon />
      </View>
      <Text style={styles.emptySourceTitle}>
        {isConnected ? 'DB에 표시할 파일이 없습니다.' : '최근 파일을 준비 중입니다.'}
      </Text>
      <Text style={styles.emptySourceDescription}>
        {isConnected
          ? 'Windows 백엔드는 연결됐지만 세션 파일이 비어 있습니다.'
          : 'DB 연결이 완료되면 최근 파일이 여기에 표시됩니다.'}
      </Text>
    </View>
  );
}

function WorkspaceFolderTab({
  onOpenSession,
  status,
  tree,
}: {
  onOpenSession: (sessionId: string) => void;
  status: WorkspaceLoadStatus;
  tree: WorkspaceNode[];
}) {
  const counts = countWorkspaceTree(tree);
  const isLoading = status === 'loading';
  const isEmpty = tree.length === 0;

  return (
    <View style={styles.folderTab}>
      <View style={styles.folderTabHeader}>
        <Text style={styles.folderTabTitle}>폴더</Text>
        <Text style={styles.folderTabSubtitle}>
          {isLoading ? 'DB 폴더를 불러오는 중...' : `폴더 ${counts.folders}개 · 파일 ${counts.files}개`}
        </Text>
      </View>

      {isEmpty ? (
        <View style={styles.folderEmptyCard}>
          <View style={styles.folderEmptyIcon}>
            <FolderIcon />
          </View>
          <Text style={styles.folderEmptyTitle}>
            {isLoading ? '폴더를 불러오는 중입니다.' : '표시할 DB 폴더가 없습니다.'}
          </Text>
          <Text style={styles.folderEmptyDescription}>
            {status === 'fallback'
              ? 'Windows DB 연결을 확인하면 저장된 폴더와 파일이 여기에 표시됩니다.'
              : 'DB에 폴더나 파일을 만들면 이 탭에서 한눈에 볼 수 있습니다.'}
          </Text>
        </View>
      ) : (
        <View style={styles.folderTreeList}>
          {tree.map((node) => (
            <WorkspaceTreeNodeItem
              depth={0}
              key={`${node.type}-${node.id}`}
              node={node}
              onOpenSession={onOpenSession}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function WorkspaceTreeNodeItem({
  depth,
  node,
  onOpenSession,
}: {
  depth: number;
  node: WorkspaceNode;
  onOpenSession: (sessionId: string) => void;
}) {
  const marginLeft = Math.min(depth * 14, 42);
  const folderChildren = node.type === 'folder' ? (node.children ?? []) : [];
  const [isOpen, setIsOpen] = useState(false);

  if (node.type === 'file') {
    const counts = getWorkspaceFileResourceCounts(node);
    const sessionColor = normalizeHexColor(node.color);
    const fileTag = getWorkspaceFileTag(node);

    return (
      <Pressable
        onPress={() => onOpenSession(node.id)}
        style={({ pressed }) => [
          styles.folderFileCard,
          {
            backgroundColor: hexToRgba(sessionColor, 0.1),
            borderColor: hexToRgba(sessionColor, 0.22),
            marginLeft,
          },
          pressed && styles.resourceCardPressed,
        ]}>
        <View style={[styles.folderFileIconBox, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
          <DocumentIcon color={sessionColor} />
        </View>

        <View style={styles.folderFileTextColumn}>
          <View style={styles.folderFileTitleRow}>
            <Text numberOfLines={1} style={styles.folderFileTitle}>
              {node.name}
            </Text>

            <View style={[styles.folderFileTag, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
              <Text numberOfLines={1} style={[styles.folderFileTagText, { color: sessionColor }]}>
                {fileTag}
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} style={styles.folderFileMeta}>
            자료 {counts.materials}개 · 음성 {counts.recordings}개
          </Text>
        </View>
      </Pressable>
    );
  }

  const children = folderChildren;
  const fileCount = getFolderFileCount(node);

  return (
    <View style={[styles.folderNodeGroup, { marginLeft }]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setIsOpen((current) => !current)}
        style={({ pressed }) => [styles.folderNodeHeader, pressed && styles.resourceCardPressed]}>
        <View style={styles.folderIconBox}>
          <FolderIcon />
        </View>

        <View style={styles.folderNodeTextColumn}>
          <Text numberOfLines={1} style={styles.folderNodeTitle}>
            {node.name}
          </Text>
          <Text numberOfLines={1} style={styles.folderNodeMeta}>
            파일 {fileCount}개
          </Text>
        </View>

        <FolderToggleIcon expanded={isOpen} />
      </Pressable>

      {isOpen && children.length > 0 ? (
        <View style={styles.folderChildrenList}>
          {children.map((child) => (
            <WorkspaceTreeNodeItem
              depth={depth + 1}
              key={`${child.type}-${child.id}`}
              node={child}
              onOpenSession={onOpenSession}
            />
          ))}
        </View>
      ) : isOpen ? (
        <Text style={styles.folderEmptyInlineText}>비어 있는 폴더입니다.</Text>
      ) : null}
    </View>
  );
}

function CalendarTab({
  error,
  isRefreshing,
  onConfirmSchedule,
  onIgnoreSchedule,
  onOpenSession,
  onRefresh,
  schedules,
  status,
  updatingScheduleId,
}: {
  error: string | null;
  isRefreshing: boolean;
  onConfirmSchedule: (scheduleId: string) => void;
  onIgnoreSchedule: (scheduleId: string) => void;
  onOpenSession: (sessionId: string) => void;
  onRefresh: () => void;
  schedules: MobileScheduleItem[];
  status: WorkspaceLoadStatus;
  updatingScheduleId: string | null;
}) {
  const today = new Date();
  const todayKey = formatDateKey(today);
  const [activeMonthDate, setActiveMonthDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const visibleSchedules = sortMobileSchedules(schedules.filter((schedule) => schedule.status !== 'ignored'));
  const calendarDays = buildCalendarDays(activeMonthDate, visibleSchedules);
  const selectedSchedules = visibleSchedules.filter((schedule) => schedule.dateKey === selectedDateKey);
  const upcomingSchedules = visibleSchedules.filter((schedule) => schedule.dateKey >= todayKey).slice(0, 5);
  const isLoading = status === 'loading';
  const currentMonthLabel = `${activeMonthDate.getFullYear()}년 ${activeMonthDate.getMonth() + 1}월`;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('goToCalendarDate', (dateKey: string) => {
      setSelectedDateKey(dateKey);
      const date = parseDateKey(dateKey);
      setActiveMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
    });
    return () => sub.remove();
  }, []);

  const moveMonth = (offset: number) => {
    setActiveMonthDate((currentDate) => {
      const nextDate = new Date(currentDate);
      nextDate.setMonth(nextDate.getMonth() + offset);
      return nextDate;
    });
  };

  const moveToday = () => {
    const nextToday = new Date();
    setActiveMonthDate(new Date(nextToday.getFullYear(), nextToday.getMonth(), 1));
    setSelectedDateKey(formatDateKey(nextToday));
  };

  const selectDay = (day: ReturnType<typeof buildCalendarDays>[number]) => {
    setSelectedDateKey(day.dateKey);
    if (day.muted) {
      const date = parseDateKey(day.dateKey);
      setActiveMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  return (
    <View style={styles.calendarTab}>
      <View style={styles.calendarHeader}>
        <View>
          <Text style={styles.calendarTitle}>캘린더</Text>
          <Text style={styles.calendarSubtitle}>
            {isLoading ? '웹 일정 데이터를 불러오는 중...' : `${visibleSchedules.length}개 일정 · 웹 DB 동기화`}
          </Text>
        </View>

        <Pressable
          disabled={isRefreshing}
          onPress={onRefresh}
          style={[styles.calendarRefreshButton, isRefreshing && styles.calendarRefreshButtonDisabled]}>
          <Feather color="#202329" name="refresh-cw" size={18} strokeWidth={2.5} />
        </Pressable>
      </View>

      {status === 'fallback' ? (
        <View style={[styles.workspaceStatusCard, styles.workspaceStatusCardWarning]}>
          <Text style={[styles.workspaceStatusText, styles.workspaceStatusTextWarning]}>
            {error ?? '일정 데이터 연결에 실패했습니다.'}
          </Text>
        </View>
      ) : null}

      <View style={styles.calendarMonthCard}>
        <View style={styles.calendarMonthToolbar}>
          <Pressable onPress={() => moveMonth(-1)} style={styles.calendarMonthNavButton}>
            <Feather color="#202329" name="chevron-left" size={22} strokeWidth={2.6} />
          </Pressable>
          <Text style={styles.calendarMonthTitle}>{currentMonthLabel}</Text>
          <View style={styles.calendarMonthActions}>
            <Pressable onPress={moveToday} style={styles.calendarTodayButton}>
              <Text style={styles.calendarTodayText}>오늘</Text>
            </Pressable>
            <Pressable onPress={() => moveMonth(1)} style={styles.calendarMonthNavButton}>
              <Feather color="#202329" name="chevron-right" size={22} strokeWidth={2.6} />
            </Pressable>
          </View>
        </View>

        <View style={styles.calendarWeekdayRow}>
          {['일', '월', '화', '수', '목', '금', '토'].map((dayName) => (
            <Text key={dayName} style={styles.calendarWeekdayText}>
              {dayName}
            </Text>
          ))}
        </View>

        <View style={styles.calendarGrid}>
          {calendarDays.map((day) => {
            const isSelected = day.dateKey === selectedDateKey;
            const hasSchedule = day.schedules.length > 0;

            return (
              <Pressable
                key={day.dateKey}
                onPress={() => selectDay(day)}
                style={[
                  styles.calendarDayCell,
                  day.isToday && !isSelected && styles.calendarDayCellToday,
                  isSelected && styles.calendarDayCellSelected,
                ]}>
                <Text
                  style={[
                    styles.calendarDayNumber,
                    day.isToday && !isSelected && styles.calendarDayNumberToday,
                    day.muted && styles.calendarDayNumberMuted,
                    isSelected && styles.calendarDayNumberSelected,
                  ]}>
                  {day.label}
                </Text>
                {hasSchedule ? (
                  <View style={styles.calendarDayDots}>
                    {day.hasConfirmedSchedule && <View style={[styles.calendarDayDot, styles.calendarDayDotConfirmed]} />}
                    {day.hasPendingSchedule && <View style={[styles.calendarDayDot, styles.calendarDayDotPending]} />}
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.calendarSelectedSection}>
        <View style={styles.calendarSectionHeader}>
          <Text style={styles.calendarSectionTitle}>{formatKoreanDateLabel(selectedDateKey)}</Text>
          <Text style={styles.calendarSectionMeta}>{selectedSchedules.length}개 일정</Text>
        </View>

        {selectedSchedules.length > 0 ? (
          selectedSchedules.map((schedule) => (
            <MobileScheduleCard
              key={schedule.id}
              onConfirm={onConfirmSchedule}
              onIgnore={onIgnoreSchedule}
              onOpenSession={onOpenSession}
              schedule={schedule}
              updatingScheduleId={updatingScheduleId}
            />
          ))
        ) : (
          <View style={styles.calendarEmptyCard}>
            <MaterialIcons color="#9AA2B1" name="event-busy" size={34} />
            <Text style={styles.calendarEmptyTitle}>
              {isLoading ? '일정을 불러오는 중입니다.' : '선택한 날짜의 일정이 없습니다.'}
            </Text>
            <Text style={styles.calendarEmptyDescription}>
              웹에서 저장되거나 확정한 일정이 있으면 이 캘린더에 함께 표시됩니다.
            </Text>
          </View>
        )}
      </View>

      {upcomingSchedules.length > 0 ? (
        <View style={styles.calendarUpcomingSection}>
          <Text style={styles.calendarSectionTitle}>다가오는 일정</Text>
          <View style={styles.calendarUpcomingList}>
            {upcomingSchedules.map((schedule) => (
              <Pressable
                key={`upcoming-${schedule.id}`}
                onPress={() => {
                  const date = parseDateKey(schedule.dateKey);
                  setSelectedDateKey(schedule.dateKey);
                  setActiveMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
                }}
                style={styles.calendarUpcomingItem}>
                <Text style={styles.calendarUpcomingDate}>{schedule.dateKey.slice(5).replace('-', '.')}</Text>
                <Text numberOfLines={1} style={styles.calendarUpcomingTitle}>
                  {schedule.title}
                </Text>
                <Text style={styles.calendarUpcomingStatus}>{getScheduleStatusLabel(schedule.status)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function MobileScheduleCard({
  onConfirm,
  onIgnore,
  onOpenSession,
  schedule,
  updatingScheduleId,
}: {
  onConfirm: (scheduleId: string) => void;
  onIgnore: (scheduleId: string) => void;
  onOpenSession: (sessionId: string) => void;
  schedule: MobileScheduleItem;
  updatingScheduleId: string | null;
}) {
  const isUpdating = updatingScheduleId === schedule.id;
  const isPending = schedule.status === 'pending';
  const canOpenSession = Boolean(schedule.workspaceFileId);

  return (
    <View style={[styles.scheduleCard, isPending && styles.scheduleCardPending]}>
      <View style={styles.scheduleCardTopRow}>
        <View style={styles.scheduleTypeChip}>
          <MaterialIcons color="#2563EB" name={schedule.type === 'meeting' ? 'groups' : 'event-note'} size={15} />
          <Text style={styles.scheduleTypeText}>{schedule.typeLabel}</Text>
        </View>
        <Text style={[styles.scheduleStatusText, isPending && styles.scheduleStatusPendingText]}>
          {getScheduleStatusLabel(schedule.status)}
        </Text>
      </View>

      <Text numberOfLines={2} style={styles.scheduleCardTitle}>
        {schedule.title}
      </Text>

      <View style={styles.scheduleMetaRow}>
        <Feather color="#7E8797" name="clock" size={14} strokeWidth={2.5} />
        <Text numberOfLines={1} style={styles.scheduleMetaText}>
          {[schedule.startTime, schedule.sourceSessionTitle || '웹 일정'].filter(Boolean).join(' · ')}
        </Text>
      </View>

      {schedule.note ? (
        <Text numberOfLines={2} style={styles.scheduleNoteText}>
          {schedule.note}
        </Text>
      ) : null}

      {schedule.sourceText ? (
        <Text numberOfLines={2} style={styles.scheduleSourceText}>
          “{schedule.sourceText}”
        </Text>
      ) : null}

      <View style={styles.scheduleActionRow}>
        {isPending ? (
          <>
            <Pressable
              disabled={isUpdating}
              onPress={() => onConfirm(schedule.id)}
              style={[styles.scheduleActionButton, styles.scheduleConfirmButton, isUpdating && styles.scheduleActionButtonDisabled]}>
              <Text style={styles.scheduleConfirmText}>{isUpdating ? '동기화 중' : '확정'}</Text>
            </Pressable>
            <Pressable
              disabled={isUpdating}
              onPress={() => onIgnore(schedule.id)}
              style={[styles.scheduleActionButton, styles.scheduleIgnoreButton, isUpdating && styles.scheduleActionButtonDisabled]}>
              <Text style={styles.scheduleIgnoreText}>무시</Text>
            </Pressable>
          </>
        ) : null}

        {canOpenSession ? (
          <Pressable onPress={() => onOpenSession(schedule.workspaceFileId)} style={styles.scheduleOpenButton}>
            <Text style={styles.scheduleOpenText}>파일 열기</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function VoiceSourceTab({
  onOpenSaveModal,
  onRemoveSource,
  onRenameSource,
  sessions,
  voiceSources,
}: {
  onOpenSaveModal: (sourceId: string) => void;
  onRemoveSource: (sourceId: string) => void;
  onRenameSource: (sourceId: string, title: string) => void;
  sessions: SessionFile[];
  voiceSources: VoiceSourceFile[];
}) {
  return (
    <View style={styles.voiceSourceTab}>
      <View style={styles.voiceSourceHeader}>
        <Text style={styles.voiceSourceTitle}>음성소스</Text>
        <Text style={styles.voiceSourceSubtitle}>
          {voiceSources.length}개 항목 · 세션과 폴더를 나중에 지정할 수 있어요.
        </Text>
      </View>

      {voiceSources.length === 0 ? (
        <View style={styles.voiceSourceEmptyCard}>
          <View style={styles.voiceSourceEmptyIcon}>
            <VoiceIcon />
            <View style={styles.voiceSourceEmptySlash} />
          </View>
          <Text style={styles.voiceSourceEmptyTitle}>저장된 음성소스가 없습니다.</Text>
          <Text style={styles.voiceSourceEmptyDescription}>
            최근 탭에서 녹음을 종료하면 세션이 지정되지 않은 음성 파일이 여기에 저장됩니다.
          </Text>
        </View>
      ) : (
        voiceSources.map((source) => (
          <VoiceSourceCard
            key={source.id}
            onOpenSaveModal={onOpenSaveModal}
            onRemove={onRemoveSource}
            onRename={onRenameSource}
            sessions={sessions}
            source={source}
          />
        ))
      )}
    </View>
  );
}

function VoiceSourceCard({
  onOpenSaveModal,
  onRemove,
  onRename,
  sessions,
  source,
}: {
  onOpenSaveModal: (sourceId: string) => void;
  onRemove: (sourceId: string) => void;
  onRename: (sourceId: string, title: string) => void;
  sessions: SessionFile[];
  source: VoiceSourceFile;
}) {
  const assignedSession = sessions.find((session) => session.id === source.sessionId) ?? null;
  const audioSource = source.uri ? { uri: source.uri } : null;
  const player = useAudioPlayer(audioSource, { updateInterval: 250 });
  const playerStatus = useAudioPlayerStatus(player);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(source.title);
  const titleInputRef = useRef<TextInput>(null);
  const duration = playerStatus.duration > 0 ? playerStatus.duration : parseDurationLabel(source.durationLabel);
  const progress = duration > 0 ? Math.min(1, Math.max(0, playerStatus.currentTime / duration)) : 0;

  useEffect(() => {
    setPlayerError(null);
    setIsTitleEditing(false);
    setDraftTitle(source.title);
    player.pause();
    void player.seekTo(0).catch(() => undefined);
  }, [player, source.id]);

  useEffect(() => {
    if (!isTitleEditing) {
      setDraftTitle(source.title);
    }
  }, [isTitleEditing, source.title]);

  useEffect(() => {
    if (!isTitleEditing) {
      return;
    }

    const timer = setTimeout(() => titleInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isTitleEditing]);

  const togglePlayback = async () => {
    if (!source.uri) {
      setPlayerError('재생할 음성 파일 주소가 없습니다.');
      return;
    }

    try {
      setPlayerError(null);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      if (playerStatus.playing) {
        player.pause();
      } else {
        player.play();
      }
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : '음성 재생을 시작하지 못했습니다.');
    }
  };

  const seekPlayback = async (offsetSeconds: number) => {
    try {
      const nextTime = clamp(playerStatus.currentTime + offsetSeconds, 0, duration || playerStatus.currentTime);
      await player.seekTo(nextTime);
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : '재생 위치를 이동하지 못했습니다.');
    }
  };

  const finishTitleEditing = () => {
    const nextTitle = draftTitle.trim() || source.title;
    onRename(source.id, nextTitle);
    setDraftTitle(nextTitle);
    setIsTitleEditing(false);
  };

  return (
    <View style={styles.voiceSourceCard}>
      <Pressable accessibilityLabel="음성소스 삭제" onPress={() => onRemove(source.id)} style={styles.voiceSourceDeleteButton}>
        <Text style={styles.voiceSourceDeleteText}>×</Text>
      </Pressable>

      <View style={styles.voiceSourceCardTop}>
        <View style={styles.voiceSourceWaveIconBox}>
          <SourceVoiceIcon />
        </View>

        <View style={styles.voiceSourceMeta}>
          {isTitleEditing ? (
            <TextInput
              ref={titleInputRef}
              maxLength={70}
              onBlur={finishTitleEditing}
              onChangeText={setDraftTitle}
              onSubmitEditing={finishTitleEditing}
              returnKeyType="done"
              selectTextOnFocus
              style={styles.voiceSourceNameInput}
              value={draftTitle}
            />
          ) : (
            <Pressable
              accessibilityLabel="음성소스 이름 변경"
              onPress={() => {
                setDraftTitle(source.title);
                setIsTitleEditing(true);
              }}
              style={styles.voiceSourceNameButton}>
              <Text numberOfLines={1} style={styles.voiceSourceName}>
                {source.title}
              </Text>
            </Pressable>
          )}
          <Text numberOfLines={1} style={styles.voiceSourceDate}>
            {source.createdAt} · {source.durationLabel}
          </Text>
        </View>
      </View>

      <View style={styles.voiceSourcePlayer}>
        <View style={styles.voiceSourceProgressTrack}>
          <View style={[styles.voiceSourceProgressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.voiceSourcePlayerTimeRow}>
          <Text style={styles.voiceSourcePlayerTime}>{formatPlaybackTime(playerStatus.currentTime)}</Text>
          <Text style={styles.voiceSourcePlayerTime}>{formatPlaybackTime(duration)}</Text>
        </View>

        <View style={styles.voiceSourcePlayerControls}>
          <Pressable onPress={() => seekPlayback(-5)} style={styles.voiceSourceControlButton}>
            <Text style={styles.voiceSourceControlText}>↺5</Text>
          </Pressable>

          <Pressable onPress={togglePlayback} style={styles.voiceSourcePlayButton}>
            <Text style={styles.voiceSourcePlayText}>{playerStatus.playing ? 'Ⅱ' : '▶'}</Text>
          </Pressable>

          <Pressable onPress={() => seekPlayback(5)} style={styles.voiceSourceControlButton}>
            <Text style={styles.voiceSourceControlText}>↻5</Text>
          </Pressable>

          <Pressable onPress={() => onOpenSaveModal(source.id)} style={styles.voiceSourceSaveButton}>
            <Text style={styles.voiceSourceSaveText}>{assignedSession ? '다시 저장' : '저장'}</Text>
          </Pressable>
        </View>
      </View>

      {playerError && <Text style={styles.voiceSourcePlayerError}>{playerError}</Text>}
    </View>
  );
}

function UploadDestinationModal({
  error,
  isSaving,
  onClose,
  onSelectSession,
  tree,
  visible,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  tree: WorkspaceNode[];
  visible: boolean;
}) {
  const hasDestinations = tree.length > 0;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.voiceSaveLayer}>
        <Pressable accessibilityLabel="업로드 위치 닫기" onPress={onClose} style={styles.voiceSaveBackdrop} />

        <View style={styles.voiceSaveCard}>
          <View style={styles.voiceSaveHeader}>
            <View style={styles.voiceSaveHeaderText}>
              <Text style={styles.voiceSaveTitle}>업로드할 세션 선택</Text>
              <Text numberOfLines={1} style={styles.voiceSaveDescription}>
                음성소스를 업로드할 세션 파일을 선택해주세요.
              </Text>
            </View>

            <Pressable disabled={isSaving} onPress={onClose} style={styles.voiceSaveCloseButton}>
              <Text style={styles.voiceSaveCloseText}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={[styles.voiceSaveList, styles.folderTreeList]}
            showsVerticalScrollIndicator={false}>
            {tree.map((node) => (
              <VoiceSaveTreeNode
                depth={0}
                disabled={isSaving}
                key={`${node.type}-${node.id}`}
                node={node}
                onSelectSession={onSelectSession}
              />
            ))}

            {!hasDestinations && <Text style={styles.voiceSaveEmptyText}>업로드할 세션 파일이 없습니다.</Text>}
          </ScrollView>

          {error && <Text style={styles.voiceSaveErrorText}>{error}</Text>}
          {isSaving && <Text style={styles.voiceSaveSavingText}>업로드 중...</Text>}
        </View>
      </View>
    </Modal>
  );
}

function VoiceSaveCompletionModal({
  visible,
  sessionTitle,
  onClose,
  onMove,
}: {
  visible: boolean;
  sessionTitle: string;
  onClose: () => void;
  onMove: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.voicePromptLayer}>
        <Pressable accessibilityLabel="음성소스 저장 완료 닫기" onPress={onClose} style={styles.voicePromptBackdrop} />

        <View style={styles.voicePromptCard}>
          <Pressable accessibilityLabel="음성소스 저장 완료 닫기" onPress={onClose} style={styles.voicePromptCloseButton}>
            <Text style={styles.voicePromptCloseText}>×</Text>
          </Pressable>

          <View style={styles.voicePromptIconBox}>
            <SourceVoiceIcon />
          </View>

          <Text style={styles.voicePromptTitle}>{sessionTitle}에 저장되었습니다.</Text>
          <Text style={styles.voicePromptDescription}>
            저장된 세션 파일 상세 페이지에서 녹음본과 요약을 확인하실 수 있습니다.
          </Text>

          <View style={styles.voicePromptActions}>
            <Pressable onPress={onClose} style={styles.voicePromptCancelButton}>
              <Text style={styles.voicePromptCancelText}>취소</Text>
            </Pressable>

            <Pressable onPress={onMove} style={styles.voicePromptMoveButtonFlex}>
              <Text style={styles.voicePromptMoveText}>이동하기</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VoiceSourceSavedPrompt({
  onClose,
  onMove,
  visible,
}: {
  onClose: () => void;
  onMove: () => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.voicePromptLayer}>
        <Pressable accessibilityLabel="음성소스 저장 알림 닫기" onPress={onClose} style={styles.voicePromptBackdrop} />

        <View style={styles.voicePromptCard}>
          <Pressable accessibilityLabel="음성소스 저장 알림 닫기" onPress={onClose} style={styles.voicePromptCloseButton}>
            <Text style={styles.voicePromptCloseText}>×</Text>
          </Pressable>

          <View style={styles.voicePromptIconBox}>
            <SourceVoiceIcon />
          </View>

          <Text style={styles.voicePromptTitle}>음성소스가 저장되었습니다.</Text>
          <Text style={styles.voicePromptDescription}>파일이 지정되지 않은 녹음은 음성소스 탭에서 확인할 수 있어요.</Text>

          <View style={styles.voicePromptActions}>
            <Pressable onPress={onClose} style={styles.voicePromptCancelButton}>
              <Text style={styles.voicePromptCancelText}>취소</Text>
            </Pressable>

            <Pressable onPress={onMove} style={styles.voicePromptMoveButtonFlex}>
              <Text style={styles.voicePromptMoveText}>이동하기</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RecordingSessionSavePrompt({
  error,
  isSaving,
  onClose,
  onSave,
  prompt,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  prompt: RecordingSessionSavePromptState | null;
}) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(prompt)} onRequestClose={onClose}>
      <View style={styles.voicePromptLayer}>
        <Pressable accessibilityLabel="파일 저장 확인 닫기" onPress={onClose} style={styles.voicePromptBackdrop} />

        <View style={styles.voicePromptCard}>
          <Pressable accessibilityLabel="파일 저장 확인 닫기" onPress={onClose} style={styles.voicePromptCloseButton}>
            <Text style={styles.voicePromptCloseText}>×</Text>
          </Pressable>

          <View style={styles.voicePromptIconBox}>
            <SourceVoiceIcon />
          </View>

          <Text style={styles.voicePromptTitle}>{prompt?.sessionTitle ?? '현재 파일'}에 저장하시겠습니까?</Text>
          <Text style={styles.voicePromptDescription}>
            파일이 지정되지 않은 녹음은 음성소스 탭에서 확인할 수 있습니다.
          </Text>

          {error && <Text style={styles.voicePromptErrorText}>{error}</Text>}

          <Pressable
            disabled={isSaving}
            onPress={onSave}
            style={[styles.voicePromptMoveButton, isSaving && styles.voicePromptMoveButtonDisabled]}>
            <Text style={styles.voicePromptMoveText}>{isSaving ? '저장 중...' : '저장하기'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function VoiceSaveDestinationModal({
  error,
  isSaving,
  onClose,
  onSelectSession,
  sessions,
  source,
  tree,
  visible,
}: {
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
  sessions: SessionFile[];
  source: VoiceSourceFile | null;
  tree: WorkspaceNode[];
  visible: boolean;
}) {
  const hasDestinations = tree.length > 0;

  return (
    <Modal animationType="fade" transparent visible={visible && Boolean(source)} onRequestClose={onClose}>
      <View style={styles.voiceSaveLayer}>
        <Pressable accessibilityLabel="음성소스 저장 위치 닫기" onPress={onClose} style={styles.voiceSaveBackdrop} />

        <View style={styles.voiceSaveCard}>
          <View style={styles.voiceSaveHeader}>
            <View style={styles.voiceSaveHeaderText}>
              <Text style={styles.voiceSaveTitle}>저장할 세션 선택</Text>
              <Text numberOfLines={1} style={styles.voiceSaveDescription}>
                {source?.title ?? '음성소스'}를 저장할 파일을 선택해주세요.
              </Text>
            </View>

            <Pressable disabled={isSaving} onPress={onClose} style={styles.voiceSaveCloseButton}>
              <Text style={styles.voiceSaveCloseText}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            bounces={false}
            contentContainerStyle={[styles.voiceSaveList, styles.folderTreeList]}
            showsVerticalScrollIndicator={false}>
            {tree.map((node) => (
              <VoiceSaveTreeNode
                depth={0}
                disabled={isSaving}
                key={`${node.type}-${node.id}`}
                node={node}
                onSelectSession={onSelectSession}
              />
            ))}

            {!hasDestinations && <Text style={styles.voiceSaveEmptyText}>저장할 세션 파일이 없습니다.</Text>}
          </ScrollView>

          {error && <Text style={styles.voiceSaveErrorText}>{error}</Text>}
          {isSaving && <Text style={styles.voiceSaveSavingText}>저장 중...</Text>}
        </View>
      </View>
    </Modal>
  );
}

function VoiceSaveTreeNode({
  depth,
  disabled,
  node,
  onSelectSession,
}: {
  depth: number;
  disabled: boolean;
  node: WorkspaceNode;
  onSelectSession: (sessionId: string) => void;
}) {
  const marginLeft = Math.min(depth * 12, 36);
  const [isOpen, setIsOpen] = useState(false);

  if (node.type === 'folder') {
    const children = node.children ?? [];

    return (
      <View style={[styles.folderNodeGroup, { marginLeft }]}>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => setIsOpen((current) => !current)}
          style={({ pressed }) => [styles.folderNodeHeader, pressed && !disabled && styles.resourceCardPressed]}>
          <View style={styles.folderIconBox}>
            <FolderIcon />
          </View>

          <View style={styles.folderNodeTextColumn}>
            <Text numberOfLines={1} style={styles.folderNodeTitle}>
              {node.name}
            </Text>
            <Text numberOfLines={1} style={styles.folderNodeMeta}>
              파일 {getFolderFileCount(node)}개
            </Text>
          </View>

          <FolderToggleIcon expanded={isOpen} />
        </Pressable>

        {isOpen && children.length > 0 ? (
          <View style={styles.folderChildrenList}>
            {children.map((child) => (
              <VoiceSaveTreeNode
                depth={depth + 1}
                disabled={disabled}
                key={`${child.type}-${child.id}`}
                node={child}
                onSelectSession={onSelectSession}
              />
            ))}
          </View>
        ) : isOpen ? (
          <Text style={styles.folderEmptyInlineText}>비어 있는 폴더입니다.</Text>
        ) : null}
      </View>
    );
  }

  const sessionColor = normalizeHexColor(node.color);
  const counts = getWorkspaceFileResourceCounts(node);

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onSelectSession(node.id)}
      style={({ pressed }) => [
        styles.folderFileCard,
        {
          backgroundColor: hexToRgba(sessionColor, 0.1),
          borderColor: hexToRgba(sessionColor, 0.22),
          marginLeft,
        },
        pressed && !disabled && styles.resourceCardPressed,
      ]}>
      <View style={[styles.folderFileIconBox, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
        <DocumentIcon color={sessionColor} />
      </View>

      <View style={styles.folderFileTextColumn}>
        <View style={styles.folderFileTitleRow}>
          <Text numberOfLines={1} style={styles.folderFileTitle}>
            {node.name}
          </Text>

          <View style={[styles.folderFileTag, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
            <Text numberOfLines={1} style={[styles.folderFileTagText, { color: sessionColor }]}>
              {getWorkspaceFileTag(node)}
            </Text>
          </View>
        </View>

        <Text numberOfLines={1} style={styles.folderFileMeta}>
          자료 {counts.materials}개 · 음성 {counts.recordings}개
        </Text>
      </View>
    </Pressable>
  );
}

function VoiceSaveLocalSessionGroup({
  disabled,
  onSelectSession,
  sessions,
}: {
  disabled: boolean;
  onSelectSession: (sessionId: string) => void;
  sessions: SessionFile[];
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <View style={styles.folderNodeGroup}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setIsOpen((current) => !current)}
        style={({ pressed }) => [styles.folderNodeHeader, pressed && !disabled && styles.resourceCardPressed]}>
        <View style={styles.folderIconBox}>
          <FolderIcon />
        </View>

        <View style={styles.folderNodeTextColumn}>
          <Text numberOfLines={1} style={styles.folderNodeTitle}>
            기타 파일
          </Text>
          <Text numberOfLines={1} style={styles.folderNodeMeta}>
            파일 {sessions.length}개
          </Text>
        </View>

        <FolderToggleIcon expanded={isOpen} />
      </Pressable>

      {isOpen && (
        <View style={styles.folderChildrenList}>
          {sessions.map((session) => {
            const sessionColor = normalizeHexColor(session.color);

            return (
              <Pressable
                disabled={disabled}
                key={session.id}
                onPress={() => onSelectSession(session.id)}
                style={({ pressed }) => [
                  styles.folderFileCard,
                  {
                    backgroundColor: hexToRgba(sessionColor, 0.1),
                    borderColor: hexToRgba(sessionColor, 0.22),
                    marginLeft: 12,
                  },
                  pressed && !disabled && styles.resourceCardPressed,
                ]}>
                <View style={[styles.folderFileIconBox, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
                  <DocumentIcon color={sessionColor} />
                </View>

                <View style={styles.folderFileTextColumn}>
                  <View style={styles.folderFileTitleRow}>
                    <Text numberOfLines={1} style={styles.folderFileTitle}>
                      {session.title}
                    </Text>

                    <View style={[styles.folderFileTag, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
                      <Text numberOfLines={1} style={[styles.folderFileTagText, { color: sessionColor }]}>
                        {session.tag}
                      </Text>
                    </View>
                  </View>

                  <Text numberOfLines={1} style={styles.folderFileMeta}>
                    자료 {session.materials?.length ?? 0}개 · 음성 {getSessionRecordingCount(session)}개
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function getFoldersFromTree(tree: WorkspaceNode[]): { id: string; name: string }[] {
  const folders: { id: string; name: string }[] = [];
  const visit = (nodes: WorkspaceNode[] = []) => {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        folders.push({ id: node.id, name: node.name });
        visit(node.children ?? []);
      }
    });
  };
  visit(tree);
  return folders;
}

function CreateSessionModal({
  customTagValue,
  isCustomTagInputOpen,
  onCancel,
  onChangeColor,
  onChangeCustomTag,
  onChangeTitle,
  onCreate,
  onSelectTag,
  onToggleCustomTag,
  selectedColor,
  selectedTag,
  tagOptions,
  title,
  visible,
  tree,
  selectedFolderId,
  onSelectFolder,
}: {
  customTagValue: string;
  isCustomTagInputOpen: boolean;
  onCancel: () => void;
  onChangeColor: (color: string) => void;
  onChangeCustomTag: (tag: string) => void;
  onChangeTitle: (title: string) => void;
  onCreate: () => void;
  onSelectTag: (tag: string) => void;
  onToggleCustomTag: () => void;
  selectedColor: string;
  selectedTag: string;
  tagOptions: string[];
  title: string;
  visible: boolean;
  tree: WorkspaceNode[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
}) {
  const canCreate = title.trim().length > 0;
  const folders = getFoldersFromTree(tree);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <View style={styles.modalLayer}>
        <Pressable accessibilityLabel="새 파일 만들기 닫기" onPress={onCancel} style={styles.modalBackdrop} />

        <View style={styles.createModalCard}>
          <Text style={styles.createModalTitle}>새 파일 생성</Text>
          <Text style={styles.createModalDescription}>이름, 태그와 색상을 지정해주세요.</Text>

          <TextInput
            onChangeText={onChangeTitle}
            placeholder="파일 이름 입력"
            placeholderTextColor="#9CA3AF"
            returnKeyType="done"
            style={styles.createModalInput}
            value={title}
          />

          <Text style={styles.createSectionLabel}>태그</Text>
          <View style={styles.createTagRow}>
            {tagOptions.map((tag) => (
              <Pressable
                key={tag}
                onPress={() => onSelectTag(tag)}
                style={[styles.createTagChoice, selectedTag === tag && styles.createTagChoiceSelected]}>
                <Text style={[styles.createTagText, selectedTag === tag && styles.createTagTextSelected]}>{tag}</Text>
              </Pressable>
            ))}

            <Pressable
              accessibilityLabel="직접 태그 추가"
              onPress={onToggleCustomTag}
              style={[styles.createTagChoice, styles.createTagAddChoice, isCustomTagInputOpen && styles.createTagChoiceSelected]}>
              <Text style={[styles.createTagText, isCustomTagInputOpen && styles.createTagTextSelected]}>+</Text>
            </Pressable>
          </View>

          {isCustomTagInputOpen && (
            <TextInput
              onChangeText={onChangeCustomTag}
              placeholder="직접 태그 입력"
              placeholderTextColor="#9CA3AF"
              returnKeyType="done"
              style={[styles.createModalInput, styles.createModalCompactInput]}
              value={customTagValue}
            />
          )}

          <Text style={styles.createSectionLabel}>테마 색상</Text>
          <View style={styles.createColorRow}>
            {fileColors.map((color) => (
              <Pressable
                accessibilityLabel={`${color} 색상 선택`}
                key={color}
                onPress={() => onChangeColor(color)}
                style={[styles.createColorChoice, selectedColor === color && styles.createColorChoiceSelected]}>
                <View style={[styles.createColorSwatch, { backgroundColor: color }]} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.createSectionLabel}>저장할 폴더</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.createFolderRow}>
            <Pressable
              onPress={() => onSelectFolder(null)}
              style={[
                styles.createFolderChoice,
                selectedFolderId === null && styles.createFolderChoiceSelected,
              ]}>
              <Text style={[
                styles.createFolderText,
                selectedFolderId === null && styles.createFolderTextSelected,
              ]}>기본폴더</Text>
            </Pressable>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                onPress={() => onSelectFolder(folder.id)}
                style={[
                  styles.createFolderChoice,
                  selectedFolderId === folder.id && styles.createFolderChoiceSelected,
                ]}>
                <Text style={[
                  styles.createFolderText,
                  selectedFolderId === folder.id && styles.createFolderTextSelected,
                ]}>{folder.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.createModalActions}>
            <Pressable onPress={onCancel} style={styles.createModalCancelButton}>
              <Text style={styles.createModalCancelText}>취소</Text>
            </Pressable>

            <Pressable
              disabled={!canCreate}
              onPress={onCreate}
              style={[styles.createModalSubmitButton, !canCreate && styles.createModalSubmitButtonDisabled]}>
              <Text style={styles.createModalSubmitText}>생성</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RecordingBottomSheet({
  isRecordingActive,
  isRecordingPaused,
  onChangeTitle,
  onCommitTitle,
  onClose,
  onPauseToggle,
  onStop,
  recordingElapsedMillis,
  recorderState,
  title,
}: {
  isRecordingActive: boolean;
  isRecordingPaused: boolean;
  onChangeTitle: (title: string) => void;
  onCommitTitle: () => void;
  onClose: () => Promise<void>;
  onPauseToggle: () => Promise<void>;
  onStop: () => Promise<void>;
  recordingElapsedMillis: number;
  recorderState: RecorderState;
  title: string;
}) {
  const { height } = useWindowDimensions();
  const sheetY = useRef(new Animated.Value(height)).current;
  const currentY = useRef(height);
  const titleInputRef = useRef<TextInput>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const elapsedLabel = formatRecordingDuration(recordingElapsedMillis);
  const inputLevel = recorderState.metering === undefined ? 0.45 : clamp((recorderState.metering + 56) / 56, 0.08, 1);
  const isRecording = isRecordingActive || recorderState.isRecording;
  const hasActiveRecordingSession = isRecording || isRecordingPaused;
  const expandedY = 6;
  const collapsedY = Math.max(height - 430, 220);
  const hiddenY = height + 24;


  const snapTo = (nextY: number, expanded: boolean, closeWhenDone = false) => {
    setIsExpanded(expanded);
    Animated.spring(sheetY, {
      damping: 27,
      mass: 0.9,
      stiffness: 210,
      toValue: nextY,
      useNativeDriver: true,
    }).start(() => {
      currentY.current = nextY;
      if (closeWhenDone) {
        void onClose();
      }
    });
  };

  useEffect(() => {
    currentY.current = hiddenY;
    sheetY.setValue(hiddenY);
    snapTo(collapsedY, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedY, hiddenY]);

  useEffect(() => {
    if (!isTitleEditing) {
      return;
    }

    const timer = setTimeout(() => titleInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [isTitleEditing]);

  const finishTitleEditing = () => {
    onCommitTitle();
    setIsTitleEditing(false);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
      onStartShouldSetPanResponder: () => false,
      onPanResponderMove: (_, gesture) => {
        const nextY = clamp(currentY.current + gesture.dy, expandedY, hiddenY);
        sheetY.setValue(nextY);
      },
      onPanResponderRelease: (_, gesture) => {
        const nextY = clamp(currentY.current + gesture.dy, expandedY, hiddenY);
        const expandThreshold = collapsedY - 92;

        if (gesture.vy < -0.45 || nextY < expandThreshold) {
          snapTo(expandedY, true);
          return;
        }

        if (gesture.vy > 0.75 && nextY > collapsedY + 72) {
          snapTo(hiddenY, false, true);
          return;
        }

        snapTo(collapsedY, false);
      },
    }),
  ).current;

  return (
    <View pointerEvents="box-none" style={styles.recordingSheetLayer}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.recordingSheet,
          {
            height: height + 18,
            transform: [{ translateY: sheetY }],
          },
        ]}>
        <View style={styles.sheetHandle} />

        <Pressable
          accessibilityLabel="녹음 닫기"
          onPress={() => snapTo(hiddenY, false, true)}
          style={styles.sheetCloseButton}>
          <Text style={styles.sheetCloseText}>×</Text>
        </Pressable>

        <View style={styles.sheetHeaderRow}>
          <View style={styles.sheetTitleWrap}>
            {isTitleEditing ? (
              <TextInput
                ref={titleInputRef}
                maxLength={60}
                onBlur={finishTitleEditing}
                onChangeText={onChangeTitle}
                onSubmitEditing={finishTitleEditing}
                placeholder="녹음 이름"
                placeholderTextColor="rgba(255,255,255,0.36)"
                returnKeyType="done"
                selectTextOnFocus
                style={styles.sheetTitleInput}
                value={title}
              />
            ) : (
              <Pressable
                accessibilityLabel="녹음 이름 변경"
                onPress={() => setIsTitleEditing(true)}
                style={styles.sheetTitleButton}>
                <Text numberOfLines={1} style={styles.sheetTitle}>
                  {title}
                </Text>
              </Pressable>
            )}
            <Text style={[styles.sheetSubtitle, styles.sheetHeaderTimer]}>{elapsedLabel}</Text>
          </View>
        </View>

        <View style={[styles.sheetWavePanel, isExpanded && styles.sheetWavePanelExpanded]}>
          <Waveform
            expanded={isExpanded}
            inputLevel={inputLevel}
            isRecording={isRecording}
            metering={recorderState.metering}
          />
        </View>

        <View style={[styles.sheetSimpleControls, isExpanded && styles.sheetSimpleControlsExpanded]}>
          <Pressable
            disabled={!hasActiveRecordingSession}
            onPress={onPauseToggle}
            style={[styles.sheetSimplePauseButton, !hasActiveRecordingSession && styles.sheetSimpleButtonDisabled]}>
            <Text style={styles.sheetSimplePauseText}>{isRecordingPaused ? '▶' : 'Ⅱ'}</Text>
          </Pressable>

          <Pressable
            disabled={!hasActiveRecordingSession}
            onPress={onStop}
            style={[styles.sheetSimpleStopButton, !hasActiveRecordingSession && styles.sheetSimpleButtonDisabled]}>
            <View style={styles.sheetStopSquare} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

function Waveform({
  expanded,
  inputLevel,
  isRecording,
  metering,
}: {
  expanded: boolean;
  inputLevel: number;
  isRecording: boolean;
  metering?: number;
}) {
  // 무음 기준 데시벨(dB)을 -30dB로 고정합니다.
  const isSilent = isRecording && metering !== undefined && metering < -30;
  const isPlaying = isRecording && !isSilent;
  
  // 기본 시작 속도를 없애고 inputLevel에 비례하여 부드럽게 움직이도록 수정합니다.
  const speed = isPlaying ? inputLevel * 1.8 : 0;

  return (
    <View style={[styles.waveform, expanded && styles.waveformExpanded]}>
      <LottieView
        autoPlay={isPlaying}
        loop
        resizeMode="contain"
        source={require('./assets/groupchat/animations/soundwave.json')}
        speed={speed}
        style={{
          width: expanded ? 320 : 220,
          height: expanded ? 137 : 94,
          alignSelf: 'center',
        }}
      />
    </View>
  );
}

function AnimatedGridBackground() {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(drift, {
        duration: 5200,
        toValue: 40,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [drift]);

  const translate = drift.interpolate({
    inputRange: [0, 40],
    outputRange: [0, 40],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.gridLayer,
          {
            transform: [{ translateX: translate }],
          },
        ]}>
        {gridVerticalLines.map((line) => (
          <View key={`v-${line}`} style={[styles.gridLineVertical, { left: -40 + line * 40 }]} />
        ))}
      </Animated.View>

      <Animated.View
        style={[
          styles.gridLayer,
          {
            transform: [{ translateY: translate }],
          },
        ]}>
        {gridHorizontalLines.map((line) => (
          <View key={`h-${line}`} style={[styles.gridLineHorizontal, { top: -40 + line * 40 }]} />
        ))}
      </Animated.View>
    </View>
  );
}

function WelcomeAnimation() {
  const { width } = useWindowDimensions();
  const animationWidth = clamp(width * 0.72, 280, 380);

  return (
    <View style={styles.welcomeAnimationWrap}>
      <LottieView
        autoPlay
        loop
        resizeMode="contain"
        source={require('./assets/groupchat/animations/welcome.json')}
        style={[
          styles.welcomeLottie,
          {
            height: animationWidth * 0.36,
            width: animationWidth,
          },
        ]}
      />
    </View>
  );
}

function SessionFileCard({
  file,
  onPress,
}: {
  file: SessionFile;
  onPress: () => void;
}) {
  const sessionColor = normalizeHexColor(file.color);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sessionCard,
        {
          backgroundColor: hexToRgba(sessionColor, 0.14),
          borderColor: hexToRgba(sessionColor, 0.24),
          shadowColor: sessionColor,
        },
        pressed && styles.resourceCardPressed,
      ]}>
      <View style={styles.cardContentRow}>
        <View style={[styles.documentIconBox, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
          <DocumentIcon color={sessionColor} />
        </View>

        <View style={styles.cardTextColumn}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={styles.cardTitle}>
            {file.title}
          </Text>

          <View style={styles.cardMetaRow}>
            <Text numberOfLines={1} style={styles.cardDate}>
              {file.date}
            </Text>

            <View style={[styles.cardTag, { backgroundColor: hexToRgba(sessionColor, 0.12) }]}>
              <Text style={[styles.cardTagText, { color: sessionColor }]}>{file.tag}</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function DocumentIcon({ color = '#202329' }: { color?: string }) {
  const iconColor = normalizeHexColor(color);

  return (
    <View style={[styles.documentIcon, { backgroundColor: iconColor }]}>
      <View style={styles.documentFold} />
      <View style={styles.documentLineLong} />
      <View style={styles.documentLineShort} />
    </View>
  );
}

function FolderIcon({ color = '#101114', size = 32 }: { color?: string; size?: number }) {
  const iconColor = normalizeHexColor(color);

  return <MaterialIcons color={iconColor} name="folder" size={size} />;
}

function FolderToggleIcon({ expanded }: { expanded: boolean }) {
  return (
    <View style={styles.folderToggleButton}>
      <View
        style={[
          styles.folderToggleLine,
          expanded ? styles.folderToggleLineLeftOpen : styles.folderToggleLineLeftClosed,
        ]}
      />
      <View
        style={[
          styles.folderToggleLine,
          expanded ? styles.folderToggleLineRightOpen : styles.folderToggleLineRightClosed,
        ]}
      />
    </View>
  );
}

function VoiceIcon() {
  return <MaterialIcons color="#FFFFFF" name="keyboard-voice" size={34} />;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatRecordingDuration(durationMillis: number) {
  const totalCentiseconds = Math.max(0, Math.floor(durationMillis / 10));
  const minutes = Math.floor(totalCentiseconds / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function formatRulerTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDemoDate(date: Date) {
  const period = date.getHours() >= 12 ? '오후' : '오전';
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}. ${period} ${hour}:${minute}`;
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBackdrop: {
    backgroundColor: '#22262B',
    height: 260,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  screen: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 0,
  },
  topPanel: {
    backgroundColor: '#22262B',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  projectLogo: {
    backgroundColor: '#111111',
    borderRadius: 25,
    height: 50,
    resizeMode: 'cover',
    width: 50,
  },
  headerTitleImage: {
    height: 34,
    resizeMode: 'contain',
    width: 168,
  },
  tabRow: {
    alignItems: 'center',
    backgroundColor: '#22262B',
    borderBottomColor: 'rgba(255,255,255,0.12)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    overflow: 'hidden',
    paddingBottom: 10,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 64,
  },
  tabButtonActive: {
    backgroundColor: '#424B4E',
  },
  contentArea: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    flex: 1,
    marginHorizontal: -16,
    overflow: 'hidden',
    position: 'relative',
  },
  detailTopPanel: {
    backgroundColor: '#22262B',
    marginHorizontal: -16,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 70,
  },
  detailBackButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  detailBackText: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '600',
    lineHeight: 40,
  },
  detailTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  detailTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 27,
  },
  detailSubtitle: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 4,
  },
  sessionDetailContent: {
    gap: 14,
    minHeight: '100%',
    paddingBottom: 138,
    paddingHorizontal: 18,
    paddingTop: 28,
  },
  emptySourceCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderColor: '#E4E8F0',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 260,
    padding: 26,
    shadowColor: '#101828',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
  },
  emptySourceIcon: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 18,
    width: 60,
  },
  emptySourceTitle: {
    color: '#202329',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
    textAlign: 'center',
  },
  emptySourceDescription: {
    color: '#8B919C',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  detailStatusCard: {
    backgroundColor: 'rgba(31,120,255,0.08)',
    borderColor: 'rgba(31,120,255,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  detailStatusCardWarning: {
    backgroundColor: '#FFF6F0',
    borderColor: '#FFD8C2',
  },
  detailStatusText: {
    color: '#2F65B8',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  detailStatusTextWarning: {
    color: '#A33B00',
  },
  materialViewerFrame: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    overflow: 'hidden',
  },
  materialWebView: {
    backgroundColor: '#FFFFFF',
    flex: 1,
  },
  materialViewerEmpty: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  materialViewerEmptyTitle: {
    color: '#202329',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
    marginTop: 16,
    textAlign: 'center',
  },
  materialViewerEmptyDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
    marginTop: 8,
    textAlign: 'center',
  },
  resourceActionLayer: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,18,22,0.34)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  resourceActionBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  resourceActionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#101828',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    width: '100%',
  },
  resourceActionTitle: {
    color: '#202329',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
    marginBottom: 8,
  },
  resourceActionItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
  },
  resourceActionText: {
    color: '#202329',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  resourceActionDangerText: {
    color: '#D92D20',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  resourceActionDivider: {
    backgroundColor: '#EEF1F6',
    height: 1,
  },
  resourceActionError: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 8,
  },
  renameResourceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    shadowColor: '#101828',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    width: '100%',
  },
  renameResourceTitle: {
    color: '#202329',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
  },
  renameResourceInput: {
    backgroundColor: '#F5F7FA',
    borderColor: '#E1E6EF',
    borderRadius: 16,
    borderWidth: 1,
    color: '#202329',
    fontSize: 17,
    fontWeight: '800',
    height: 54,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  renameResourceActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  renameResourceCancelButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  renameResourceCancelText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '800',
  },
  renameResourceSaveButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  renameResourceSaveButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  renameResourceSaveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  resourceSection: {
    gap: 10,
  },
  resourceSectionTitle: {
    color: '#202329',
    fontSize: 23,
    fontWeight: '900',
    lineHeight: 29,
    paddingHorizontal: 4,
  },
  resourceList: {
    gap: 10,
  },
  resourceCardFrame: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DFE6F1',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 74,
    overflow: 'hidden',
    paddingRight: 46,
    position: 'relative',
    shadowColor: '#101828',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.03,
    shadowRadius: 14,
  },
  resourceCardPressArea: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 74,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 10,
  },
  resourceCardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  resourceMaterialCard: {
    minHeight: 70,
  },
  resourceMoreButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 36,
    zIndex: 2,
  },
  resourceIconBox: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  resourceVoiceIconBox: {
    backgroundColor: '#FFF2CF',
  },
  sourcePdfIcon: {
    height: 32,
    position: 'relative',
    width: 32,
  },
  sourcePdfBackSheet: {
    borderBottomColor: '#2563EB',
    borderBottomWidth: 2,
    borderLeftColor: '#2563EB',
    borderLeftWidth: 2,
    borderRadius: 2,
    height: 23,
    left: 4,
    position: 'absolute',
    top: 7,
    width: 20,
  },
  sourcePdfPage: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 3,
    height: 28,
    justifyContent: 'center',
    left: 8,
    position: 'absolute',
    top: 2,
    width: 22,
  },
  sourcePdfFold: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderTopColor: '#9FC1FF',
    borderTopWidth: 7,
    height: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 0,
  },
  sourcePdfText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 10,
  },
  sourceWaveIcon: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  sourceWaveBar: {
    backgroundColor: '#F59E0B',
    borderRadius: 999,
    width: 2,
  },
  resourceTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  resourceTitle: {
    color: '#202329',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  resourceMeta: {
    color: '#7E8490',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 2,
  },
  resourceOpenIcon: {
    height: 24,
    marginLeft: 4,
    position: 'relative',
    width: 24,
  },
  resourceOpenBox: {
    borderColor: '#9AA2B1',
    borderRadius: 1.5,
    borderWidth: 2,
    bottom: 3,
    height: 13,
    left: 3,
    position: 'absolute',
    width: 13,
  },
  resourceOpenStem: {
    backgroundColor: '#9AA2B1',
    height: 2,
    position: 'absolute',
    right: 4,
    top: 8,
    transform: [{ rotate: '-45deg' }],
    width: 13,
  },
  resourceOpenHeadTop: {
    backgroundColor: '#9AA2B1',
    height: 2,
    position: 'absolute',
    right: 4,
    top: 4,
    width: 9,
  },
  resourceOpenHeadSide: {
    backgroundColor: '#9AA2B1',
    height: 9,
    position: 'absolute',
    right: 4,
    top: 4,
    width: 2,
  },
  recordingSourceOverlay: {
    backgroundColor: 'rgba(16,18,22,0.34)',
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  recordingSourceBackdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  recordingSourcePanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: '100%',
    maxWidth: 600,
    overflow: 'hidden',
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 0,
    position: 'absolute',
    top: 0,
  },
  recordingSourceDragArea: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'flex-start',
    marginHorizontal: -18,
    marginBottom: -20,
    paddingTop: 4,
  },
  recordingSourceHandle: {
    backgroundColor: '#CBD3DF',
    borderRadius: 999,
    height: 5,
    width: 54,
  },
  recordingSourceHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
    paddingTop: 2,
  },
  recordingSourceTitleWrap: {
    alignItems: 'center',
    minWidth: 0,
    paddingHorizontal: 48,
    width: '100%',
  },
  recordingSourceTitleButton: {
    alignItems: 'center',
    maxWidth: '100%',
    minHeight: 28,
    minWidth: 140,
  },
  recordingSourceTitle: {
    color: '#202329',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
    textAlign: 'center',
  },
  recordingSourceTitleInput: {
    borderBottomColor: '#CBD3DF',
    borderBottomWidth: 1,
    color: '#202329',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
    maxWidth: '100%',
    minWidth: 160,
    padding: 0,
    textAlign: 'center',
  },
  recordingSourceSubtitle: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 3,
  },
  recordingSourceMoreButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    top: 14,
    width: 36,
    zIndex: 5,
  },
  recordingSourceMenuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
  },
  recordingSourceMenu: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8F1',
    borderRadius: 16,
    borderWidth: 1,
    left: 16,
    minWidth: 170,
    paddingHorizontal: 10,
    paddingVertical: 8,
    position: 'absolute',
    shadowColor: '#101828',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    top: 56,
    zIndex: 6,
  },
  recordingSourceMenuItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
  },
  recordingSourceMenuDangerText: {
    color: '#D92D20',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  recordingSourceCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 16,
    top: 14,
    zIndex: 3,
    width: 36,
  },
  recordingSourceCloseText: {
    color: '#202329',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 25,
  },
  sourcePlayerCard: {
    backgroundColor: '#FFFFFF',
    paddingBottom: 10,
    paddingHorizontal: 4,
    paddingTop: 0,
  },
  sourcePlayerBody: {
    flex: 1,
    minWidth: 0,
  },
  sourcePlayerTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  sourcePlayButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sourcePlayButtonText: {
    color: '#101114',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 32,
  },
  sourcePlayerTimeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  sourcePlayerTime: {
    color: '#8B93A3',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  sourcePlayerControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'center',
    marginTop: 6,
  },
  sourceSeekButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 42,
  },
  sourceSeekButtonText: {
    color: '#7B8494',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  sourceSpeedText: {
    color: '#7B8494',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  sourceProgressTrack: {
    backgroundColor: '#E6EBF3',
    borderRadius: 999,
    height: 7,
    position: 'relative',
  },
  sourceProgressFill: {
    backgroundColor: '#2F80ED',
    borderRadius: 999,
    height: '100%',
  },
  sourceProgressThumb: {
    backgroundColor: '#2F80ED',
    borderRadius: 999,
    height: 20,
    marginLeft: -10,
    position: 'absolute',
    top: -6,
    width: 20,
  },
  sourcePanelError: {
    backgroundColor: '#FFF6F0',
    borderColor: '#FFD8C2',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sourcePanelErrorText: {
    color: '#A33B00',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  transcriptPanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingTop: 8,
  },
  transcriptPanelTitle: {
    color: '#202329',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
  },
  transcriptPanelCount: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  transcriptScroll: {
    maxHeight: 380,
  },
  transcriptLineBlock: {
    marginBottom: 24,
  },
  transcriptLineMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 5,
  },
  transcriptLineTime: {
    color: '#9AA2B1',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
    marginBottom: 8,
  },
  transcriptLineTimeActive: {
    color: '#2F80ED',
  },
  transcriptLineSpeaker: {
    color: '#8B919C',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  transcriptLineText: {
    color: '#202329',
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 28,
  },
  transcriptLineTextActive: {
    backgroundColor: '#EAF2FF',
    borderRadius: 6,
  },
  transcriptEmptyCard: {
    alignItems: 'center',
    backgroundColor: '#F8FAFD',
    borderColor: '#E4EAF2',
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 190,
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  transcriptEmptyTitle: {
    color: '#202329',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    textAlign: 'center',
  },
  transcriptEmptyDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  transcriptRequestButton: {
    backgroundColor: '#101114',
    borderRadius: 16,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  transcriptRequestButtonDisabled: {
    opacity: 0.52,
  },
  transcriptRequestButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  voiceSourceTab: {
    gap: 14,
  },
  voiceSourceHeader: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  voiceSourceTitle: {
    color: '#202329',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  voiceSourceSubtitle: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
    marginTop: 4,
  },
  voiceSourceEmptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 340,
    paddingHorizontal: 24,
    paddingVertical: 34,
  },
  voiceSourceEmptyIcon: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 30,
    height: 60,
    justifyContent: 'center',
    marginBottom: 16,
    overflow: 'hidden',
    position: 'relative',
    width: 60,
  },
  voiceSourceEmptySlash: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 4,
    left: 11,
    position: 'absolute',
    top: 28,
    transform: [{ rotate: '-45deg' }],
    width: 38,
  },
  voiceSourceEmptyTitle: {
    color: '#202329',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
    textAlign: 'center',
  },
  voiceSourceEmptyDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 8,
    textAlign: 'center',
  },
  voiceSourceCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DFE6F1',
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 16,
    position: 'relative',
    shadowColor: '#101828',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
  },
  voiceSourceDeleteButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 12,
    top: 12,
    width: 30,
    zIndex: 2,
  },
  voiceSourceDeleteText: {
    color: '#202329',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 24,
  },
  voiceSourceCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingRight: 36,
  },
  voiceSourceIconBox: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 18,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  voiceSourceWaveIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFF2CF',
    borderRadius: 18,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  voiceSourceMeta: {
    flex: 1,
    minWidth: 0,
  },
  voiceSourceNameButton: {
    alignItems: 'flex-start',
    minHeight: 24,
    minWidth: 0,
  },
  voiceSourceName: {
    color: '#202329',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
  },
  voiceSourceNameInput: {
    borderBottomColor: '#CBD3DF',
    borderBottomWidth: 1,
    color: '#202329',
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 22,
    minWidth: 120,
    padding: 0,
  },
  voiceSourceDate: {
    color: '#7E8490',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 3,
  },
  voiceSourcePlayer: {
    backgroundColor: '#F7F9FC',
    borderColor: '#E4EAF2',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  voiceSourceProgressTrack: {
    backgroundColor: '#E7ECF5',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
  },
  voiceSourceProgressFill: {
    backgroundColor: '#2F80ED',
    borderRadius: 999,
    height: '100%',
  },
  voiceSourcePlayerTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  voiceSourcePlayerTime: {
    color: '#7E8797',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  voiceSourcePlayerControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
  },
  voiceSourceControlButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    minWidth: 42,
  },
  voiceSourceControlText: {
    color: '#707A8A',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  voiceSourcePlayButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    width: 42,
  },
  voiceSourcePlayText: {
    color: '#101114',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
  },
  voiceSourceSaveButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    marginLeft: 2,
    paddingHorizontal: 14,
  },
  voiceSourceSaveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  voiceSourcePlayerError: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  assignmentBlock: {
    gap: 8,
  },
  assignmentLabel: {
    color: '#5D6470',
    fontSize: 12,
    fontWeight: '900',
  },
  assignmentChipRow: {
    gap: 8,
    paddingRight: 4,
  },
  assignmentChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderColor: 'rgba(255,255,255,0.8)',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    maxWidth: 220,
    paddingHorizontal: 12,
  },
  assignmentChipSelected: {
    backgroundColor: '#101114',
    borderColor: '#101114',
  },
  assignmentChipText: {
    color: '#5E6570',
    fontSize: 12,
    fontWeight: '900',
  },
  assignmentChipTextSelected: {
    color: '#FFFFFF',
  },
  voiceSourceSummaryRow: {
    borderTopColor: 'rgba(126,132,144,0.18)',
    borderTopWidth: 1,
    gap: 5,
    paddingTop: 12,
  },
  voiceSourceSummaryText: {
    color: '#6F7682',
    fontSize: 12,
    fontWeight: '800',
  },
  voicePromptLayer: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,18,22,0.28)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  voicePromptBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  voicePromptCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    maxWidth: 360,
    paddingHorizontal: 22,
    paddingBottom: 22,
    paddingTop: 26,
    shadowColor: '#101828',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 32,
    width: '100%',
  },
  voicePromptCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: 14,
    top: 14,
    width: 30,
  },
  voicePromptCloseText: {
    color: '#202329',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 24,
  },
  voicePromptIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFF2CF',
    borderRadius: 18,
    height: 62,
    justifyContent: 'center',
    marginBottom: 15,
    width: 62,
  },
  voicePromptTitle: {
    color: '#202329',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 24,
    textAlign: 'center',
  },
  voicePromptDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
    marginTop: 7,
    textAlign: 'center',
  },
  voicePromptErrorText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 10,
    textAlign: 'center',
  },
  voicePromptMoveButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 18,
    height: 44,
    justifyContent: 'center',
    marginTop: 18,
    paddingHorizontal: 26,
  },
  voicePromptMoveButtonDisabled: {
    opacity: 0.56,
  },
  voicePromptMoveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  voicePromptActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  voicePromptCancelButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 18,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  voicePromptCancelText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '900',
  },
  voicePromptMoveButtonFlex: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 18,
    flex: 1,
    height: 44,
    justifyContent: 'center',
  },
  voiceSaveLayer: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,18,22,0.34)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  voiceSaveBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  voiceSaveCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    maxHeight: '78%',
    padding: 18,
    shadowColor: '#101828',
    shadowOffset: { height: 20, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 36,
    width: '100%',
  },
  voiceSaveHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  voiceSaveHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  voiceSaveTitle: {
    color: '#202329',
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 25,
  },
  voiceSaveDescription: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 4,
  },
  voiceSaveCloseButton: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  voiceSaveCloseText: {
    color: '#202329',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 25,
  },
  voiceSaveList: {
    gap: 8,
    paddingTop: 16,
  },
  voiceSaveGroup: {
    gap: 7,
  },
  voiceSaveFolderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 42,
  },
  voiceSaveFolderIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  voiceSaveFolderTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  voiceSaveFolderTitle: {
    color: '#202329',
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  voiceSaveFolderMeta: {
    color: '#8B919C',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  voiceSaveSessionRow: {
    alignItems: 'center',
    backgroundColor: '#F7F9FC',
    borderColor: '#E4EAF2',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  voiceSaveSessionIconBox: {
    alignItems: 'center',
    borderRadius: 10,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  voiceSaveSessionTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  voiceSaveSessionTitle: {
    color: '#202329',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 19,
  },
  voiceSaveSessionMeta: {
    color: '#7E8797',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
    marginTop: 2,
  },
  voiceSaveEmptyText: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 19,
    paddingVertical: 28,
    textAlign: 'center',
  },
  voiceSaveErrorText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 10,
  },
  voiceSaveSavingText: {
    color: '#2F80ED',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
    marginTop: 10,
    textAlign: 'center',
  },
  workspaceStatusCard: {
    backgroundColor: 'rgba(31,120,255,0.08)',
    borderColor: 'rgba(31,120,255,0.18)',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  workspaceStatusCardWarning: {
    backgroundColor: '#FFF6F0',
    borderColor: '#FFD8C2',
  },
  workspaceStatusText: {
    color: '#2F65B8',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  workspaceStatusTextWarning: {
    color: '#A33B00',
  },
  recentEmptyCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#E4E8F0',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 220,
    padding: 24,
  },
  emptyDocumentIcon: {
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  placeholderCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#E4E8F0',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 220,
    padding: 24,
  },
  placeholderTitle: {
    color: '#202329',
    fontSize: 22,
    fontWeight: '900',
  },
  placeholderDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 8,
    textAlign: 'center',
  },
  folderTab: {
    gap: 14,
  },
  folderTabHeader: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  folderTabTitle: {
    color: '#202329',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  folderTabSubtitle: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 4,
  },
  folderTreeList: {
    gap: 12,
  },
  folderNodeGroup: {
    gap: 8,
  },
  folderNodeHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DFE6F1',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#101828',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.03,
    shadowRadius: 14,
  },
  folderIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  folderNodeTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  folderNodeTitle: {
    color: '#202329',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  folderNodeMeta: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 2,
  },
  folderToggleButton: {
    alignItems: 'center',
    backgroundColor: '#F3F6FA',
    borderRadius: 15,
    height: 30,
    justifyContent: 'center',
    position: 'relative',
    width: 30,
  },
  folderToggleLine: {
    backgroundColor: '#7B8494',
    borderRadius: 999,
    height: 2,
    position: 'absolute',
    top: 14,
    width: 10,
  },
  folderToggleLineLeftOpen: {
    left: 7,
    transform: [{ rotate: '35deg' }],
  },
  folderToggleLineRightOpen: {
    right: 7,
    transform: [{ rotate: '-35deg' }],
  },
  folderToggleLineLeftClosed: {
    left: 7,
    transform: [{ rotate: '-35deg' }],
  },
  folderToggleLineRightClosed: {
    right: 7,
    transform: [{ rotate: '35deg' }],
  },
  folderChildrenList: {
    gap: 8,
  },
  folderFileCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(239,246,255,0.92)',
    borderColor: '#DCE6F5',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  folderFileIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  folderFileTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  folderFileTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minWidth: 0,
  },
  folderFileTitle: {
    color: '#202329',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  folderFileTag: {
    alignItems: 'center',
    borderRadius: 999,
    flexShrink: 0,
    justifyContent: 'center',
    maxWidth: 76,
    minHeight: 22,
    paddingHorizontal: 8,
  },
  folderFileTagText: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  folderFileMeta: {
    color: '#758091',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 2,
  },
  folderEmptyInlineText: {
    color: '#9AA2B1',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    paddingHorizontal: 14,
  },
  calendarTab: {
    gap: 14,
  },
  calendarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  calendarTitle: {
    color: '#202329',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 34,
  },
  calendarSubtitle: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
    marginTop: 4,
  },
  calendarRefreshButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E7F0',
    borderRadius: 18,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  calendarRefreshButtonDisabled: {
    opacity: 0.45,
  },
  calendarMonthCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: '#E1E7F0',
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#101828',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.04,
    shadowRadius: 18,
  },
  calendarMonthToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  calendarMonthNavButton: {
    alignItems: 'center',
    backgroundColor: '#F4F7FB',
    borderRadius: 15,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  calendarMonthTitle: {
    color: '#202329',
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
    paddingHorizontal: 12,
  },
  calendarMonthActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  calendarTodayButton: {
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  calendarTodayText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  calendarWeekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  calendarWeekdayText: {
    color: '#8B919C',
    flex: 1,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 7,
  },
  calendarDayCell: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    position: 'relative',
    width: `${100 / 7}%`,
  },
  calendarDayCellSelected: {
    backgroundColor: '#202329',
    borderColor: '#202329',
  },
  calendarDayCellToday: {
    backgroundColor: '#EEF4FF',
    borderColor: 'transparent',
  },
  calendarDayNumber: {
    color: '#202329',
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 18,
  },
  calendarDayNumberToday: {
    color: '#2563EB',
  },
  calendarDayNumberMuted: {
    color: '#BCC3CE',
  },
  calendarDayNumberSelected: {
    color: '#FFFFFF',
  },
  calendarDayDots: {
    bottom: 5,
    flexDirection: 'row',
    gap: 3,
    position: 'absolute',
  },
  calendarDayDot: {
    borderRadius: 999,
    height: 4,
    width: 4,
  },
  calendarDayDotConfirmed: {
    backgroundColor: '#2F80ED',
  },
  calendarDayDotPending: {
    backgroundColor: '#F97316',
  },
  calendarSelectedSection: {
    gap: 10,
  },
  calendarSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  calendarSectionTitle: {
    color: '#202329',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  calendarSectionMeta: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  calendarEmptyCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: '#E4E8F0',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 156,
    padding: 20,
  },
  calendarEmptyTitle: {
    color: '#202329',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  calendarEmptyDescription: {
    color: '#8B919C',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 6,
    textAlign: 'center',
  },
  scheduleCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: '#E1E7F0',
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 14,
    shadowColor: '#101828',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.03,
    shadowRadius: 14,
  },
  scheduleCardPending: {
    borderColor: '#FED7AA',
  },
  scheduleCardTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  scheduleTypeChip: {
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    minHeight: 26,
    paddingHorizontal: 9,
  },
  scheduleTypeText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  scheduleStatusText: {
    color: '#2F80ED',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  scheduleStatusPendingText: {
    color: '#F97316',
  },
  scheduleCardTitle: {
    color: '#202329',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  scheduleMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  scheduleMetaText: {
    color: '#7E8797',
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  scheduleNoteText: {
    color: '#5F6877',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  scheduleSourceText: {
    backgroundColor: '#F6F8FB',
    borderRadius: 12,
    color: '#6F7785',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scheduleActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  scheduleActionButton: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 13,
  },
  scheduleActionButtonDisabled: {
    opacity: 0.45,
  },
  scheduleConfirmButton: {
    backgroundColor: '#111318',
  },
  scheduleConfirmText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  scheduleIgnoreButton: {
    backgroundColor: '#FFF1F1',
  },
  scheduleIgnoreText: {
    color: '#E5484D',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  scheduleOpenButton: {
    alignItems: 'center',
    backgroundColor: '#EEF4FF',
    borderRadius: 999,
    justifyContent: 'center',
    marginLeft: 'auto',
    minHeight: 34,
    paddingHorizontal: 13,
  },
  scheduleOpenText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
  },
  calendarUpcomingSection: {
    gap: 10,
    marginTop: 2,
  },
  calendarUpcomingList: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: '#E4E8F0',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  calendarUpcomingItem: {
    alignItems: 'center',
    borderBottomColor: '#EEF1F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 13,
  },
  calendarUpcomingDate: {
    color: '#2563EB',
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 16,
    width: 42,
  },
  calendarUpcomingTitle: {
    color: '#202329',
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  calendarUpcomingStatus: {
    color: '#8B919C',
    flexShrink: 0,
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  folderEmptyCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#E4E8F0',
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 240,
    padding: 26,
  },
  folderEmptyIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    height: 64,
    justifyContent: 'center',
    marginBottom: 16,
    width: 64,
  },
  folderEmptyTitle: {
    color: '#202329',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 23,
    textAlign: 'center',
  },
  folderEmptyDescription: {
    color: '#8B919C',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  gridLineVertical: {
    backgroundColor: '#E9EBF0',
    bottom: -40,
    opacity: 0.72,
    position: 'absolute',
    top: -40,
    width: StyleSheet.hairlineWidth,
  },
  gridLineHorizontal: {
    backgroundColor: '#E9EBF0',
    height: StyleSheet.hairlineWidth,
    left: -40,
    opacity: 0.72,
    position: 'absolute',
    right: -40,
  },
  welcomeAnimationWrap: {
    alignItems: 'center',
    height: 126,
    justifyContent: 'center',
    marginBottom: 2,
    marginTop: -20,
    overflow: 'hidden',
    width: '100%',
  },
  welcomeLottie: {
    marginTop: 4,
  },
  listContent: {
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 170,
    paddingTop: 18,
  },
  sessionCard: {
    backgroundColor: 'rgba(220,227,255,0.88)',
    borderColor: 'rgba(255,255,255,0.62)',
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 94,
    paddingHorizontal: 18,
    paddingVertical: 16,
    shadowColor: '#101828',
    shadowOffset: { height: 15, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 28,
  },
  cardContentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  documentIconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  cardTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  cardMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    marginTop: 4,
  },
  documentIcon: {
    backgroundColor: '#202329',
    borderRadius: 2,
    height: 24,
    position: 'relative',
    width: 19,
  },
  documentFold: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderTopColor: '#FFFFFF',
    borderTopWidth: 7,
    height: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 0,
  },
  documentLineLong: {
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
    height: 2,
    left: 4,
    position: 'absolute',
    top: 12,
    width: 10,
  },
  documentLineShort: {
    backgroundColor: '#FFFFFF',
    borderRadius: 1,
    height: 2,
    left: 4,
    position: 'absolute',
    top: 17,
    width: 8,
  },
  cardTag: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 22,
    paddingHorizontal: 9,
  },
  cardTagText: {
    color: '#2672FF',
    fontSize: 11,
    fontWeight: '900',
  },
  cardTitle: {
    color: '#202329',
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 21,
  },
  cardDate: {
    color: '#80858F',
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  modalLayer: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.46)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  createModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 22,
    shadowColor: '#000000',
    shadowOffset: { height: 20, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 35,
    width: '100%',
  },
  createModalTitle: {
    color: '#17191D',
    fontSize: 22,
    fontWeight: '900',
  },
  createModalDescription: {
    color: '#7A808A',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: 7,
  },
  createModalInput: {
    backgroundColor: '#F5F7FA',
    borderColor: '#E1E6EF',
    borderRadius: 16,
    borderWidth: 1,
    color: '#17191D',
    fontSize: 17,
    fontWeight: '800',
    height: 54,
    marginTop: 18,
    paddingHorizontal: 16,
  },
  createModalCompactInput: {
    height: 48,
    marginTop: 10,
  },
  createSectionLabel: {
    color: '#3A3A3C',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 10,
    marginTop: 18,
  },
  createTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  createTagChoice: {
    alignItems: 'center',
    backgroundColor: '#F2F4F8',
    borderColor: '#E5E8EF',
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  createTagChoiceSelected: {
    backgroundColor: '#101114',
    borderColor: '#101114',
  },
  createTagAddChoice: {
    minWidth: 38,
    paddingHorizontal: 0,
  },
  createTagText: {
    color: '#626975',
    fontSize: 13,
    fontWeight: '900',
  },
  createTagTextSelected: {
    color: '#FFFFFF',
  },
  createColorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  createColorChoice: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  createColorChoiceSelected: {
    borderColor: '#101114',
  },
  createColorSwatch: {
    borderColor: 'rgba(255,255,255,0.86)',
    borderRadius: 13,
    borderWidth: 2,
    height: 26,
    width: 26,
  },
  createFolderRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    paddingVertical: 4,
  },
  createFolderChoice: {
    alignItems: 'center',
    backgroundColor: '#F2F4F8',
    borderColor: '#E5E8EF',
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  createFolderChoiceSelected: {
    backgroundColor: '#101114',
    borderColor: '#101114',
  },
  createFolderText: {
    color: '#626975',
    fontSize: 13,
    fontWeight: '900',
  },
  createFolderTextSelected: {
    color: '#FFFFFF',
  },
  createModalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  createModalCancelButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  createModalCancelText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '800',
  },
  createModalSubmitButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 16,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  createModalSubmitButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  createModalSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  recordingSheetLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  recordingSheet: {
    backgroundColor: '#202329',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    left: -16,
    overflow: 'hidden',
    paddingHorizontal: 20,
    position: 'absolute',
    right: -16,
    shadowColor: '#000000',
    shadowOffset: { height: -18, width: 0 },
    shadowOpacity: 0.26,
    shadowRadius: 38,
    top: 0,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.26)',
    borderRadius: 999,
    height: 5,
    marginBottom: 14,
    marginTop: 12,
    width: 44,
  },
  sheetHeaderRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: 58,
  },
  sheetCloseButton: {
    alignItems: 'center',
    backgroundColor: '#15171B',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 23,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    position: 'absolute',
    right: 20,
    top: 28,
    width: 46,
    zIndex: 4,
  },
  sheetCloseText: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 26,
    fontWeight: '500',
    lineHeight: 28,
  },
  sheetTitleWrap: {
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  sheetTitleButton: {
    alignItems: 'center',
    maxWidth: '100%',
    minHeight: 28,
    minWidth: 140,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 26,
    maxWidth: '100%',
  },
  sheetTitleInput: {
    borderBottomColor: 'rgba(255,255,255,0.28)',
    borderBottomWidth: 1,
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '900',
    lineHeight: 26,
    maxWidth: '100%',
    minWidth: 180,
    padding: 0,
    textAlign: 'center',
  },
  sheetSubtitle: {
    color: 'rgba(255,255,255,0.54)',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  sheetHeaderTimer: {
    fontFamily: 'Menlo',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    width: 98,
  },
  sheetWavePanel: {
    backgroundColor: '#282B30',
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 22,
    borderWidth: 1,
    height: 142,
    justifyContent: 'center',
    marginTop: 20,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 16,
    position: 'relative',
  },
  sheetWavePanelExpanded: {
    height: 300,
    marginTop: 26,
    paddingVertical: 20,
  },
  waveform: {
    alignItems: 'center',
    height: 96,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  waveformExpanded: {
    height: 240,
  },
  waveformTrack: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 2.5,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  waveformBar: {
    backgroundColor: '#3b82f6',
    borderRadius: 999,
    width: 2.2,
  },
  sheetStopSquare: {
    backgroundColor: '#FF414B',
    borderRadius: 5,
    height: 22,
    width: 22,
  },
  sheetSimpleControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 22,
  },
  sheetSimpleControlsExpanded: {
    marginTop: 28,
  },
  sheetSimplePauseButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sheetSimplePauseText: {
    color: '#101114',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 28,
  },
  sheetSimpleStopButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: 'center',
    width: 126,
  },
  sheetSimpleButtonDisabled: {
    opacity: 0.46,
  },
  quickActionLayer: {
    backgroundColor: 'rgba(0,0,0,0.46)',
    bottom: -96,
    justifyContent: 'flex-end',
    left: -16,
    paddingBottom: 190,
    paddingHorizontal: 24,
    position: 'absolute',
    right: -16,
    top: -120,
    zIndex: 30,
  },
  quickActionBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  quickActionMenu: {
    alignSelf: 'center',
    backgroundColor: '#2A2A2A',
    borderRadius: 24,
    gap: 6,
    paddingHorizontal: 22,
    paddingVertical: 18,
    width: 258,
  },
  quickActionItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
    minHeight: 56,
  },
  quickActionItemDisabled: {
    opacity: 0.52,
  },
  quickActionText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  quickActionError: {
    color: '#FFB4A8',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 6,
  },
  bottomActions: {
    alignItems: 'center',
    bottom: 12,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 40,
  },
  micButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    position: 'relative',
    width: 56,
  },
  micButtonRecording: {
    borderColor: 'rgba(255,65,75,0.5)',
    borderWidth: 1,
  },
  micRecordingDot: {
    backgroundColor: '#FF414B',
    borderColor: '#101114',
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    position: 'absolute',
    right: 5,
    top: 5,
    width: 14,
  },
  micRecordingDotPaused: {
    opacity: 1,
  },
  quickAddButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  quickAddButtonOpen: {
    backgroundColor: '#4A4A4A',
  },
  quickAddText: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '300',
    lineHeight: 38,
  },
  voiceIconImage: {
    height: 30,
    resizeMode: 'contain',
    width: 30,
  },
  voiceText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: '#101114',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 13,
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  createPlus: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 32,
  },
  createText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '500',
  },
});
