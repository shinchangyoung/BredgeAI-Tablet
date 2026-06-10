import {
  type WorkspaceMaterialResource,
  type WorkspaceRecordingResource,
  type WorkspaceSessionNode,
} from '@/lib/workspace-api';

export type PdfMaterial = {
  id: string;
  name: string;
  uri: string;
  base64: string;
  size?: number;
  mimeType?: string;
};

export type AudioSource = {
  duration: string;
  id: string;
  name: string;
};

export type SessionSourceKind = 'material' | 'recording';

export type SessionSourceItem = {
  fileId: string;
  icon: string;
  id: string;
  isLocal?: boolean;
  kind: SessionSourceKind;
  materialId?: string;
  meta: string;
  name: string;
  recordingId?: string;
  uid: string;
  weekId: string;
  weekLabel: string;
};

export type SessionSourceGroup = {
  id: string;
  isActive: boolean;
  sourceCount: number;
  sources: SessionSourceItem[];
  title: string;
};

export type WorkspaceWeekResource = {
  id?: string;
  label?: string;
  materials?: WorkspaceMaterialResource[];
  name?: string;
  recordings?: WorkspaceRecordingResource[];
  title?: string;
  weekId?: string;
  weekKey?: string;
  [key: string]: unknown;
};

export type TranscriptLine = {
  id: string;
  recordingId: string;
  speaker?: string;
  startSeconds?: number;
  endSeconds?: number;
  text: string;
  time: string;
};

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function getStringValue(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function getNumberValue(source: Record<string, unknown> | undefined, keys: string[]) {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

export function getMaterialResourceId(material: WorkspaceMaterialResource, index: number) {
  return (
    getStringValue(material, ['id', 'materialId', 'fileId', 'storedName', 'fileName', 'name']) ??
    `material-${index}`
  );
}

function normalizeDisplayFileName(value: string) {
  try {
    return decodeURIComponent(value).normalize('NFC');
  } catch {
    return value.normalize('NFC');
  }
}

export function getMaterialResourceName(material: WorkspaceMaterialResource, index: number) {
  const materialName = getStringValue(material, ['name', 'title', 'fileName', 'originalName', 'storedName']);
  return materialName ? normalizeDisplayFileName(materialName) : `강의자료 ${index + 1}`;
}

export function getRecordingResourceId(recording: WorkspaceRecordingResource, index: number) {
  return getStringValue(recording, ['id', 'recordingId', 'audioUrl', 'title', 'name']) ?? `recording-${index}`;
}

export function getRecordingResourceName(recording: WorkspaceRecordingResource, index: number) {
  return getStringValue(recording, ['title', 'name']) ?? `음성소스 ${index + 1}`;
}

export function getRecordingResourceMeta(recording: WorkspaceRecordingResource) {
  const durationText = getStringValue(recording, ['durationText']);
  if (durationText) return durationText;

  const duration = getNumberValue(recording, ['duration']);
  if (typeof duration === 'number') return formatTranscriptSecond(duration);

  const transcriptionCount = recording.transcriptions?.length ?? 0;
  return transcriptionCount > 0 ? `전사 ${transcriptionCount}개` : '음성소스';
}

export function getSessionFolderTitle(session: WorkspaceSessionNode | null) {
  return (
    getStringValue(session ?? undefined, ['folderName', 'folderTitle', 'category', 'subject', 'tag']) ??
    '현재 과목'
  );
}

export function getSessionFileId(session: WorkspaceSessionNode | null) {
  return getStringValue(session ?? undefined, ['id', 'fileId', 'sessionId']) ?? 'current-session';
}

export function getSourceWeekLabel(week: WorkspaceWeekResource | undefined, index: number) {
  return (
    getStringValue(week, ['label', 'name', 'title', 'weekLabel']) ??
    `${index + 1}주차`
  );
}

export function getSourceWeekId(week: WorkspaceWeekResource | undefined, index: number) {
  return getStringValue(week, ['id', 'weekId', 'weekKey', 'label']) ?? `week-${index + 1}`;
}

export function appendMaterialToSessionWeeks(session: WorkspaceSessionNode, material: WorkspaceMaterialResource) {
  const weeks = getSessionWeeks(session);
  const materialId = getMaterialResourceId(material, 0);
  const baseWeeks =
    weeks.length > 0
      ? weeks.map((week, index) => normalizeWeekResourceForSave(week, index))
      : [
          createCurrentWeekResourceShell({
            materials: session.attachments ?? [],
            recordings: session.recordings ?? [],
          }),
        ];
  const targetKey = getWeekResourceKey(baseWeeks[0], 0);
  let inserted = false;

  const nextWeeks = baseWeeks.map((week, index) => {
    const weekKey = getWeekResourceKey(week, index);
    const existingMaterials = (week.materials ?? []).filter(
      (item, materialIndex) => getMaterialResourceId(item, materialIndex) !== materialId,
    );
    const nextWeek = {
      ...week,
      materials: existingMaterials,
      recordings: week.recordings ?? [],
    };

    if (!inserted && weekKey === targetKey) {
      nextWeek.materials = [material, ...existingMaterials];
      inserted = true;
    }

    return nextWeek;
  });

  if (!inserted) {
    const shell = createCurrentWeekResourceShell();
    shell.materials = [material];
    return [shell, ...nextWeeks];
  }

  return nextWeeks;
}

export function normalizeWeekResourceForSave(week: WorkspaceWeekResource, index: number): WorkspaceWeekResource {
  const id = getStringValue(week, ['id', 'weekId', 'weekKey']) ?? `week-${index + 1}`;
  return {
    ...week,
    id,
    label: getSourceWeekLabel(week, index),
    materials: Array.isArray(week.materials) ? week.materials : [],
    recordings: Array.isArray(week.recordings) ? week.recordings : [],
    weekId: getStringValue(week, ['weekId']) ?? id,
  };
}

export function createCurrentWeekResourceShell(resources: Partial<WorkspaceWeekResource> = {}): WorkspaceWeekResource {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  const weekKey = weekStart.toISOString().slice(0, 10);
  const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

  return {
    id: `week-${weekKey}`,
    dateLabel: `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. ${weekdays[now.getDay()]}`,
    label: '1주차',
    materials: [],
    recordings: [],
    weekId: `week-${weekKey}`,
    weekKey,
    ...resources,
  };
}

export function getWeekResourceKey(week: WorkspaceWeekResource | undefined, index: number) {
  return getStringValue(week, ['id', 'weekId', 'weekKey', 'label']) ?? `week-${index + 1}`;
}

export function getSessionWeeks(session: WorkspaceSessionNode | null): WorkspaceWeekResource[] {
  const weeks = Array.isArray(session?.weeks) ? session.weeks : [];
  return weeks.filter((week): week is WorkspaceWeekResource => Boolean(week && typeof week === 'object'));
}

export function getSessionMaterialResources(session: WorkspaceSessionNode | null) {
  const materials = [...(session?.attachments ?? [])];
  getSessionWeeks(session).forEach((week) => {
    materials.push(...(week.materials ?? []));
  });

  return dedupeResources(materials, getMaterialResourceId);
}

export function getSessionRecordingResources(session: WorkspaceSessionNode | null) {
  const recordings = [...(session?.recordings ?? [])];
  getSessionWeeks(session).forEach((week) => {
    recordings.push(...(week.recordings ?? []));
  });

  return dedupeResources(recordings, getRecordingResourceId);
}

export function dedupeResources<T>(items: T[], getId: (item: T, index: number) => string) {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const id = getId(item, index);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function getMaterialSourceIcon(material: WorkspaceMaterialResource) {
  const mimeType = getStringValue(material, ['mimeType', 'type'])?.toLowerCase() ?? '';
  const name = getStringValue(material, ['name', 'title', 'fileName', 'originalName'])?.toLowerCase() ?? '';

  if (mimeType.includes('pdf') || name.endsWith('.pdf')) return 'picture-as-pdf';
  if (mimeType.includes('presentation') || name.endsWith('.ppt') || name.endsWith('.pptx')) return 'slideshow';
  return 'description';
}

export function buildSessionSourceGroups({
  audioSources,
  isRecording,
  isRecordingPaused,
  pdfMaterials,
  recordingTimeText,
  session,
  sessionTitle,
}: {
  audioSources: AudioSource[];
  isRecording: boolean;
  isRecordingPaused: boolean;
  pdfMaterials: PdfMaterial[];
  recordingTimeText: string;
  session: WorkspaceSessionNode | null;
  sessionTitle: string;
}) {
  const fileId = getSessionFileId(session);
  const weeks = getSessionWeeks(session);
  const hasWeekResources = weeks.some(
    (week) => (week.materials?.length ?? 0) > 0 || (week.recordings?.length ?? 0) > 0,
  );
  const normalizedWeeks = hasWeekResources
    ? weeks
    : [
        {
          id: 'default-week',
          label: '1주차',
          materials: session?.attachments ?? [],
          recordings: session?.recordings ?? [],
        } satisfies WorkspaceWeekResource,
      ];
  const sources: SessionSourceItem[] = [];

  normalizedWeeks.forEach((week, weekIndex) => {
    const weekId = getSourceWeekId(week, weekIndex);
    const weekLabel = getSourceWeekLabel(week, weekIndex);

    (week.materials ?? []).forEach((material, materialIndex) => {
      const materialId = getMaterialResourceId(material, materialIndex);
      sources.push({
        fileId,
        icon: getMaterialSourceIcon(material),
        id: materialId,
        kind: 'material',
        materialId,
        meta: weekLabel,
        name: getMaterialResourceName(material, materialIndex),
        uid: `remote-material:${fileId}:${weekId}:${materialId}`,
        weekId,
        weekLabel,
      });
    });

    (week.recordings ?? []).forEach((recording, recordingIndex) => {
      const recordingId = getRecordingResourceId(recording, recordingIndex);
      sources.push({
        fileId,
        icon: 'graphic-eq',
        id: recordingId,
        kind: 'recording',
        meta: getRecordingResourceMeta(recording),
        name: getRecordingResourceName(recording, recordingIndex),
        recordingId,
        uid: `remote-recording:${fileId}:${weekId}:${recordingId}`,
        weekId,
        weekLabel,
      });
    });
  });

  const remoteMaterialIds = new Set(
    sources.filter((source) => source.kind === 'material').map((source) => source.id),
  );

  pdfMaterials.forEach((material) => {
    if (remoteMaterialIds.has(material.id)) {
      return;
    }

    sources.push({
      fileId,
      icon: 'picture-as-pdf',
      id: material.id,
      isLocal: true,
      kind: 'material',
      materialId: material.id,
      meta: '로컬 강의자료',
      name: material.name,
      uid: `local-material:${fileId}:${material.id}`,
      weekId: 'local',
      weekLabel: '로컬',
    });
  });

  const savedAudioSources = audioSources.map<SessionSourceItem>((source) => ({
    fileId,
    icon: 'graphic-eq',
    id: source.id,
    isLocal: true,
    kind: 'recording',
    meta: source.duration,
    name: source.name,
    recordingId: source.id,
    uid: `local-recording:${fileId}:${source.id}`,
    weekId: 'local',
    weekLabel: '로컬',
  }));

  if (isRecording) {
    savedAudioSources.unshift({
      fileId,
      icon: 'graphic-eq',
      id: 'recording-active',
      isLocal: true,
      kind: 'recording',
      meta: isRecordingPaused ? '일시정지됨' : recordingTimeText,
      name: isRecordingPaused ? '일시정지된 녹음' : '녹음 중인 음성',
      recordingId: 'recording-active',
      uid: `local-recording:${fileId}:recording-active`,
      weekId: 'local',
      weekLabel: '로컬',
    });
  }

  sources.push(...savedAudioSources);

  return [
    {
      id: fileId,
      isActive: true,
      sourceCount: sources.length,
      sources,
      title: sessionTitle,
    },
  ];
}

export function buildTranscriptLines(recordings: WorkspaceRecordingResource[]) {
  return recordings.flatMap((recording, recordingIndex) => {
    const recordingId = getRecordingResourceId(recording, recordingIndex);
    const transcriptions = recording.transcriptions ?? [];

    return transcriptions.flatMap((transcription, transcriptionIndex) => {
      const segments = transcription.segments ?? [];

      if (segments.length > 0) {
        const lines: TranscriptLine[] = [];

        segments.forEach((segment, segmentIndex) => {
          const text = getStringValue(segment, ['text']);
          if (!text) return;

          const startSeconds =
            getNumberValue(segment, ['start', 'startTime', 'startSeconds']) ??
            getNumberValue(transcription, ['start', 'startTime', 'startSeconds']);

          const endSeconds =
            getNumberValue(segment, ['end', 'endTime', 'endSeconds']) ??
            getNumberValue(transcription, ['end', 'endTime', 'endSeconds']);

          lines.push({
            id: `${recordingId}-${transcriptionIndex}-${segmentIndex}`,
            recordingId,
            speaker:
              getStringValue(segment, ['speakerName', 'speaker']) ??
              getStringValue(transcription, ['speakerName', 'speaker']),
            startSeconds: typeof startSeconds === 'number' ? Math.max(0, startSeconds) : undefined,
            endSeconds: typeof endSeconds === 'number' ? Math.max(0, endSeconds) : undefined,
            text,
            time: formatTranscriptTime(segment, transcription),
          });
        });

        return lines;
      }

      const text = getStringValue(transcription, ['text']);
      if (!text) return [];

      return [
        {
          id: `${recordingId}-${transcriptionIndex}`,
          recordingId,
          speaker: getStringValue(transcription, ['speakerName', 'speaker']),
          startSeconds: (() => {
            const startSeconds = getNumberValue(transcription, ['start', 'startTime', 'startSeconds']);
            return typeof startSeconds === 'number' ? Math.max(0, startSeconds) : undefined;
          })(),
          endSeconds: (() => {
            const endSeconds = getNumberValue(transcription, ['end', 'endTime', 'endSeconds']);
            return typeof endSeconds === 'number' ? Math.max(0, endSeconds) : undefined;
          })(),
          text,
          time: formatTranscriptTime(transcription),
        } satisfies TranscriptLine,
      ];
    });
  });
}

export function formatTranscriptTime(primary: Record<string, unknown> | undefined, fallback?: Record<string, unknown>) {
  const label = getStringValue(primary, ['time']) ?? getStringValue(fallback, ['time']);
  if (label) return label;

  const start = getNumberValue(primary, ['start']) ?? getNumberValue(fallback, ['start']);
  return typeof start === 'number' ? formatTranscriptSecond(start) : '00:00';
}

export function formatTranscriptSecond(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function formatRecordingTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function sanitizeFileName(name: string) {
  const normalized = name
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);

  return normalized || `workspace-material-${Date.now()}.pdf`;
}
