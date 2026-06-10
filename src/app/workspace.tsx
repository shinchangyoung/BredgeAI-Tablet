import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import LottieView from 'lottie-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Pressable,
  PanResponder,
  Platform,
  SafeAreaView,
  ScrollView,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { FontFamily } from '@/constants/fonts';
import { useChatSessions } from '@/hooks/use-chat-sessions';
import {
  getWorkspaceAssetUrl,
  getWorkspaceSession,
  normalizeUploadFileName,
  saveSessionResources,
  transcribeWorkspaceRecording,
  uploadWorkspaceRecording,
  uploadWorkspaceMaterial,
  type WorkspaceMaterialResource,
  type WorkspaceRecordingResource,
  type WorkspaceSessionNode,
  type WorkspaceUploadFile,
} from '@/lib/workspace-api';
import {
  appendMaterialAnnotationStroke,
  getMaterialAnnotationPayload,
  normalizeAnnotationStroke,
  parseWebViewMessage,
  type DrawMode,
  type PdfAnnotationPayload,
  type PdfAnnotationStroke,
  type PenType,
} from '@/lib/pdf-annotations';
import { createPdfViewerHtml } from '@/lib/pdf-viewer-html';
import { requestChatAnswer, startChatStream, ChatMessageItem } from '@/lib/chat-api';
import CitationInlineText, { type NormalizedCitation } from '@/components/workspace/CitationInlineText';
import {
  fetchSessionSummaries,
  normalizeSummaryItems,
  type SavedSummaryItem,
  type SavedSummaryKind,
} from '@/lib/summary-api';
import {
  fetchQuizDetail,
  fetchSessionQuizzes,
  getQuizQuestionKey,
  getQuizQuestions,
  submitQuizAnswers,
  type QuizQuestion,
  type SavedQuiz,
} from '@/lib/quiz-api';
import {
  appendMaterialToSessionWeeks,
  buildSessionSourceGroups,
  buildTranscriptLines,
  clamp,
  formatRecordingTime,
  getMaterialResourceId,
  getMaterialResourceName,
  getNumberValue,
  getRecordingResourceId,
  getRecordingResourceName,
  getSessionMaterialResources,
  getSessionFolderTitle,
  getSessionRecordingResources,
  getSessionWeeks,
  getStringValue,
  isObjectRecord,
  sanitizeFileName,
  type AudioSource,
  type PdfMaterial,
  type SessionSourceGroup,
  type SessionSourceItem,
  type TranscriptLine,
} from '@/lib/workspace-resources';

declare const require: (moduleName: string) => any;

type MainTab = 'materials' | 'summary' | 'quiz';
type PdfPageCommand =
  | {
      direction: 'next' | 'previous';
      id: number;
    }
  | {
      id: number;
      page: number;
    };
type DrawTool = {
  color: string;
  mode: DrawMode;
  type: PenType;
  width: number;
};
type StrokeWidthKey = PenType | 'eraser';
type StrokeWidths = Record<StrokeWidthKey, number>;
type RecordingTranscriptState = {
  canStart: boolean;
  error?: string;
  hasTranscript: boolean;
  isFailed: boolean;
  isProcessing: boolean;
};
type WordInsight = {
  desc: string;
  error: string;
  isLoading: boolean;
  source: string;
  visible: boolean;
  word: string;
};

const tabs: { key: MainTab; label: string }[] = [
  { key: 'materials', label: '자료' },
  { key: 'summary', label: '요약' },
  { key: 'quiz', label: '퀴즈' },
];
const CLOSED_AI_SCRIPT_WIDTH_OFFSET = 60;
const OPEN_AI_SCRIPT_WIDTH = 310;
const SCRIPT_RESIZE_HANDLE_WIDTH = 12;
const voiceDotWeights = [0.65, 1.05, 1.35, 0.95, 0.7];
const defaultStrokeWidths: StrokeWidths = {
  eraser: 20,
  highlighter: 14,
  pen: 4,
};
const strokeWidthPresets: Record<StrokeWidthKey, number[]> = {
  eraser: [10, 20, 32],
  highlighter: [8, 14, 22],
  pen: [2, 4, 7],
};
const defaultDrawTool: DrawTool = {
  color: '#1F78FF',
  mode: 'pen',
  type: 'pen',
  width: defaultStrokeWidths.pen,
};
const defaultPenColors = ['#1F78FF', '#111318', '#EF4444', '#F6C344'];
const colorPickerOptions = [
  '#1F78FF',
  '#111318',
  '#EF4444',
  '#F97316',
  '#F6C344',
  '#22C55E',
  '#14B8A6',
  '#8B5CF6',
  '#EC4899',
  '#64748B',
  '#FFFFFF',
  '#A855F7',
];
const drawingToolOptions = [
  { icon: 'pencil-alt', key: 'pen' },
  { icon: 'eraser', key: 'eraser' },
  { icon: 'highlighter', key: 'highlighter' },
] as const;

const transcriptionProcessingStatuses = new Set(['pending', 'queued', 'processing', 'running', 'transcribing']);
const transcriptionFailedStatuses = new Set(['failed', 'error']);

function getRecordingTranscriptionStatus(recording?: WorkspaceRecordingResource | null) {
  return getStringValue(recording ?? undefined, ['transcriptionStatus', 'status'])?.toLowerCase() ?? '';
}

function hasRecordingTranscript(recording?: WorkspaceRecordingResource | null) {
  return (recording?.transcriptions ?? []).some((transcription) => {
    const text = getStringValue(transcription, ['text']);
    return Boolean(text || (transcription.segments?.length ?? 0) > 0);
  });
}

function getRecordingPlaybackUrl(recording?: WorkspaceRecordingResource | null) {
  const directUrl = getStringValue(recording ?? undefined, [
    'audioUrl',
    'audio_url',
    'url',
    'fileUrl',
    'file_url',
    'recordingUrl',
    'recording_url',
    'sourceUrl',
    'source_url',
    'downloadUrl',
    'download_url',
    'publicUrl',
    'public_url',
    'storageUrl',
    'storage_url',
    'uri',
    'path',
    'storedPath',
    'stored_path',
    'storagePath',
    'storage_path',
  ]);
  const storedName = getStringValue(recording ?? undefined, [
    'storedName',
    'stored_name',
    'storageName',
    'storage_name',
    'fileName',
    'file_name',
  ]);
  return getWorkspaceAssetUrl(
    directUrl ?? (storedName ? `/workspace/uploads/recordings/${encodeURIComponent(storedName)}` : undefined),
  );
}

function getRecordingStableId(recording?: WorkspaceRecordingResource | null) {
  return getStringValue(recording ?? undefined, ['id', 'recordingId', 'recording_id']);
}

function getRecordingStoredKey(recording?: WorkspaceRecordingResource | null) {
  return getStringValue(recording ?? undefined, [
    'storedName',
    'stored_name',
    'storageName',
    'storage_name',
    'fileName',
    'file_name',
    'originalName',
    'original_name',
    'audioUrl',
    'audio_url',
    'url',
  ]);
}

function resolveUploadedRecordingId(
  session: WorkspaceSessionNode | null,
  uploadedRecording?: WorkspaceRecordingResource,
  title?: string,
) {
  const uploadedId = getRecordingStableId(uploadedRecording) ?? (
    uploadedRecording ? getRecordingResourceId(uploadedRecording, 0) : null
  );
  const uploadedStoredKey = getRecordingStoredKey(uploadedRecording);
  const uploadedTitle = title?.trim() || (
    uploadedRecording ? getRecordingResourceName(uploadedRecording, 0) : null
  );
  const recordings = session ? getSessionRecordingResources(session) : [];

  const matchedIndex = recordings.findIndex((recording, index) => {
    const recordingId = getRecordingResourceId(recording, index);
    const stableId = getRecordingStableId(recording);
    const storedKey = getRecordingStoredKey(recording);
    const recordingTitle = getRecordingResourceName(recording, index);

    return Boolean(
      (uploadedId && (recordingId === uploadedId || stableId === uploadedId)) ||
        (uploadedStoredKey && storedKey === uploadedStoredKey) ||
        (uploadedTitle && recordingTitle === uploadedTitle),
    );
  });

  if (matchedIndex >= 0) {
    return getRecordingResourceId(recordings[matchedIndex], matchedIndex);
  }

  if (recordings.length > 0) {
    return getRecordingResourceId(recordings[0], 0);
  }

  return uploadedId;
}

function getRecordingDurationSeconds(recording?: WorkspaceRecordingResource | null) {
  const durationMs = getNumberValue(recording ?? undefined, ['durationMillis', 'durationMs', 'duration_ms']);
  if (typeof durationMs === 'number') {
    return durationMs / 1000;
  }

  return getNumberValue(recording ?? undefined, ['duration', 'durationSeconds', 'duration_seconds']) ?? 0;
}

function formatPlaybackTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parsePlaybackTimeLabel(label?: string) {
  if (!label) return 0;
  const parts = label
    .split(':')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  return parts[0] ?? 0;
}

function createPlaybackCacheKey(url: string, recording?: WorkspaceRecordingResource | null) {
  return `${getRecordingStableId(recording) ?? 'recording'}:${url}`;
}

function hashPlaybackCacheKey(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }

  return Math.abs(hash).toString(36);
}

function getAudioCacheExtension(url: string, recording?: WorkspaceRecordingResource | null) {
  const sourceName =
    getStringValue(recording ?? undefined, [
      'storedName',
      'stored_name',
      'storageName',
      'storage_name',
      'fileName',
      'file_name',
      'originalName',
      'original_name',
      'name',
      'title',
    ]) ??
    url.split('?')[0]?.split('/').pop() ??
    'recording.m4a';
  const extension = sourceName.match(/\.(m4a|mp3|wav|aac|caf|mp4|webm|ogg)$/i)?.[0];

  return extension?.toLowerCase() ?? '.m4a';
}

function waitForAudioSource(milliseconds = 120) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function cleanSelectedWord(word = '') {
  return String(word)
    .replace(/^[\s"'“”‘’()[\]{}.,!?;:，。！？、]+|[\s"'“”‘’()[\]{}.,!?;:，。！？、]+$/g, '')
    .trim();
}

function buildWordExplanationQuestion(word: string, context = '') {
  const contextText = context ? `\n이 단어가 나온 전사 문맥: "${context}"` : '';
  return `"${word}"라는 단어의 뜻을 한국어로 쉽게 설명해줘.${contextText}\n답변은 반드시 위 문맥을 우선 반영해서 1문장으로 짧게 설명해줘.`;
}

function splitTranscriptTextTokens(text = '') {
  return (String(text || '').match(/\s+|[^\s]+/g) ?? []).map((value, index) => ({
    id: `${index}-${value}`,
    isWord: /[0-9A-Za-z가-힣]/.test(cleanSelectedWord(value)),
    value,
  }));
}

function buildChatSourceFilter(selectedSourceIds: Set<string>, sourceItems: SessionSourceItem[]) {
  const selectedSources = sourceItems.filter((source) => selectedSourceIds.has(source.uid));
  if (!selectedSources.length) return null;

  const materialIds = selectedSources
    .filter((source) => source.kind === 'material' && source.materialId)
    .map((source) => source.materialId as string);
  const recordingIds = selectedSources
    .filter((source) => source.kind === 'recording' && source.recordingId)
    .map((source) => source.recordingId as string);

  const sourceFilter: Record<string, string[]> = {};
  if (materialIds.length) sourceFilter.material_ids = [...new Set(materialIds)];
  if (recordingIds.length) sourceFilter.recording_ids = [...new Set(recordingIds)];

  return Object.keys(sourceFilter).length ? sourceFilter : null;
}

function safeParseCitationParam(value?: string) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(decodeURIComponent(value));
    } catch {
      return null;
    }
  }
}

const workspaceRecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

if (Platform.OS === 'android') {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

export default function WorkspaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ citation?: string | string[]; sessionId?: string | string[] }>();
  const { width } = useWindowDimensions();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const citationParam = Array.isArray(params.citation) ? params.citation[0] : params.citation;
  const audioRecorder = useAudioRecorder(workspaceRecordingOptions);
  const recorderState = useAudioRecorderState(audioRecorder, 250);
  const audioPlayer = useAudioPlayer(null, { updateInterval: 250 });
  const audioPlayerStatus = useAudioPlayerStatus(audioPlayer);
  const {
    activeChatSessionId,
    appendMessages,
    chatSessionSummaries,
    messages,
    renameChatSession,
    setMessages,
    startNewChat,
    switchChatSession,
  } = useChatSessions();
  const [activeTab, setActiveTab] = useState<MainTab>('materials');
  const [aiInput, setAiInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isChatSessionMenuOpen, setIsChatSessionMenuOpen] = useState(false);
  const [editingChatSessionId, setEditingChatSessionId] = useState('');
  const [editingChatTitle, setEditingChatTitle] = useState('');
  const transcriptListRef = useRef<FlatList>(null);
  const chatScrollRef = useRef<ScrollView>(null);
  const stopChatStreamRef = useRef<(() => void) | null>(null);
  const [isAiCollapsed, setIsAiCollapsed] = useState(true);
  const [scriptPaneWidth, setScriptPaneWidth] = useState<number | null>(null);
  const [aiPanelWidth, setAiPanelWidth] = useState<number | null>(null);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSessionNode | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [pdfMaterials, setPdfMaterials] = useState<PdfMaterial[]>([]);
  const [currentPdfId, setCurrentPdfId] = useState<string | null>(null);
  const [materialLoadingId, setMaterialLoadingId] = useState<string | null>(null);
  const [isPdfListOpen, setIsPdfListOpen] = useState(false);
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isRecordingSubmitting, setIsRecordingSubmitting] = useState(false);
  const [isMaterialUploading, setIsMaterialUploading] = useState(false);
  const [isAudioUploading, setIsAudioUploading] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingAudioLevel, setRecordingAudioLevel] = useState(0);
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [selectedTranscriptLineId, setSelectedTranscriptLineId] = useState<string | null>(null);
  const [playbackRecordingId, setPlaybackRecordingId] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(() => new Set());
  const [transcribingRecordingId, setTranscribingRecordingId] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [pdfPageCommand, setPdfPageCommand] = useState<PdfPageCommand | null>(null);
  const [wordInsight, setWordInsight] = useState<WordInsight | null>(null);
  const emptyTranscriptAnimationRef = useRef<LottieView>(null);
  const transcriptionPreparingAnimationRef = useRef<LottieView>(null);
  const chatbotAnimationRef = useRef<LottieView>(null);
  const scriptDragStartWidthRef = useRef(0);
  const aiDragStartWidthRef = useRef(0);
  const annotationSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedPlaybackUrlRef = useRef<string | null>(null);
  const playbackLocalCacheRef = useRef<Record<string, string>>({});
  const pendingAnnotationSessionRef = useRef<WorkspaceSessionNode | null>(null);
  const recordingPausedRef = useRef(false);
  const wordInsightRequestRef = useRef(0);
  const handledCitationParamRef = useRef('');

  const layout = useMemo(() => {
    const gap = clamp(width * 0.006, 8, 12);
    const outerMargin = 20;
    const innerWidth = Math.max(width - outerMargin * 2, 0);
    const defaultAiWidth = clamp(width * 0.19, 270, 386);
    const minAiWidth = 240;
    const maxAiWidth = clamp(width * 0.25, 330, 430);
    const minScriptWidth = clamp(width * 0.22, 300, 420);
    const minContentWidth = clamp(width * 0.26, 380, 520);
    const defaultScriptWidth = clamp(width * 0.37, 420, 760);
    const radius = clamp(width * 0.017, 24, 32);
    const maxOpenAiWidth = Math.max(
      minAiWidth,
      Math.min(maxAiWidth, innerWidth - gap - minScriptWidth - minContentWidth),
    );

    return {
      gap,
      outerMargin,
      innerWidth,
      defaultAiWidth,
      minAiWidth,
      maxOpenAiWidth,
      minScriptWidth,
      minContentWidth,
      defaultScriptWidth,
      radius,
    };
  }, [width]);

  const openAiPanelWidth = clamp(
    aiPanelWidth ?? layout.defaultAiWidth,
    layout.minAiWidth,
    layout.maxOpenAiWidth,
  );
  const currentAiPanelWidth = isAiCollapsed ? 0 : openAiPanelWidth;
  const activeMinScriptWidth = isAiCollapsed ? layout.minScriptWidth : OPEN_AI_SCRIPT_WIDTH;
  const activeMinContentWidth = layout.minContentWidth;
  const unifiedCardWidth = Math.max(
    layout.innerWidth - (isAiCollapsed ? 0 : currentAiPanelWidth + layout.gap),
    activeMinScriptWidth + activeMinContentWidth + SCRIPT_RESIZE_HANDLE_WIDTH,
  );
  const maxScriptPaneWidth = Math.max(
    activeMinScriptWidth,
    unifiedCardWidth - activeMinContentWidth - SCRIPT_RESIZE_HANDLE_WIDTH,
  );
  const defaultScriptPaneWidth = isAiCollapsed
    ? layout.defaultScriptWidth - CLOSED_AI_SCRIPT_WIDTH_OFFSET
    : OPEN_AI_SCRIPT_WIDTH;
  const currentScriptPaneWidth = clamp(
    scriptPaneWidth ?? defaultScriptPaneWidth,
    activeMinScriptWidth,
    maxScriptPaneWidth,
  );
  const emptyAnimationWidth = clamp(currentScriptPaneWidth * 0.52, 210, 320);
  const emptyAnimationHeight = clamp(emptyAnimationWidth * 0.74, 170, 238);
  const sessionTitle = workspaceSession?.name || '물리학 3주차 - 전기장과 회로';
  const remoteMaterials = useMemo(() => getSessionMaterialResources(workspaceSession), [workspaceSession]);
  const remoteRecordings = useMemo(() => getSessionRecordingResources(workspaceSession), [workspaceSession]);
  const currentPdf = useMemo(
    () => pdfMaterials.find((material) => material.id === currentPdfId) ?? pdfMaterials[0] ?? null,
    [currentPdfId, pdfMaterials],
  );
  const currentPdfResource = useMemo(() => {
    if (!currentPdf) return null;
    return (
      remoteMaterials.find((material, index) => getMaterialResourceId(material, index) === currentPdf.id) ?? null
    );
  }, [currentPdf, remoteMaterials]);
  const currentPdfAnnotations = useMemo(
    () => getMaterialAnnotationPayload(currentPdfResource),
    [currentPdfResource],
  );
  const recordingTimeText = useMemo(() => formatRecordingTime(recordingSeconds), [recordingSeconds]);
  const sessionSourceGroups = useMemo<SessionSourceGroup[]>(
    () =>
      buildSessionSourceGroups({
        audioSources,
        isRecording,
        isRecordingPaused,
        pdfMaterials,
        recordingTimeText,
        session: workspaceSession,
        sessionTitle,
      }),
    [
      audioSources,
      isRecording,
      isRecordingPaused,
      pdfMaterials,
      recordingTimeText,
      sessionTitle,
      workspaceSession,
    ],
  );
  const sessionSourceItems = useMemo(
    () => sessionSourceGroups.flatMap((group) => group.sources),
    [sessionSourceGroups],
  );
  const sourceSelectionKey = useMemo(
    () => sessionSourceItems.map((source) => source.uid).join('|'),
    [sessionSourceItems],
  );
  const selectedTranscriptRecording = useMemo(() => {
    if (!selectedRecordingId) return null;
    return (
      remoteRecordings.find(
        (recording, index) => getRecordingResourceId(recording, index) === selectedRecordingId,
      ) ?? null
    );
  }, [remoteRecordings, selectedRecordingId]);
  const playbackRecording = useMemo(() => {
    if (!playbackRecordingId) return null;
    return (
      remoteRecordings.find(
        (recording, index) => getRecordingResourceId(recording, index) === playbackRecordingId,
      ) ?? null
    );
  }, [playbackRecordingId, remoteRecordings]);
  const playbackRecordingIndex = useMemo(
    () =>
      playbackRecording
        ? remoteRecordings.findIndex(
            (recording, index) => getRecordingResourceId(recording, index) === playbackRecordingId,
          )
        : -1,
    [playbackRecording, playbackRecordingId, remoteRecordings],
  );
  const playbackRecordingUrl = useMemo(
    () => getRecordingPlaybackUrl(playbackRecording),
    [playbackRecording],
  );
  const playbackDuration = audioPlayerStatus.duration > 0
    ? audioPlayerStatus.duration
    : getRecordingDurationSeconds(playbackRecording);
  const playbackCurrentTime = audioPlayerStatus.currentTime > 0 ? audioPlayerStatus.currentTime : 0;
  const playbackProgress = playbackDuration > 0
    ? clamp(playbackCurrentTime / playbackDuration, 0, 1)
    : 0;
  const savedTranscriptLines = useMemo(
    () => (selectedTranscriptRecording ? buildTranscriptLines([selectedTranscriptRecording]) : []),
    [selectedTranscriptRecording],
  );
  const transcriptLines = savedTranscriptLines;
  const activeTranscriptLineId = useMemo(() => {
    if (transcriptLines.length === 0) {
      return null;
    }

    if (selectedTranscriptLineId) {
      return selectedTranscriptLineId;
    }

    const shouldTrackPlayback =
      !playbackRecordingId || !selectedRecordingId || playbackRecordingId === selectedRecordingId;

    if (!shouldTrackPlayback) {
      return transcriptLines[0]?.id ?? null;
    }

    return (
      transcriptLines
        .filter((line) => {
          const startSeconds =
            typeof line.startSeconds === 'number' ? line.startSeconds : parsePlaybackTimeLabel(line.time);
          return startSeconds <= playbackCurrentTime + 0.05;
        })
        .at(-1)?.id ??
      transcriptLines[0]?.id ??
      null
    );
  }, [playbackCurrentTime, playbackRecordingId, selectedRecordingId, selectedTranscriptLineId, transcriptLines]);

  useEffect(() => {
    if (activeTranscriptLineId && transcriptListRef.current && transcriptLines.length > 0) {
      const index = transcriptLines.findIndex((line) => line.id === activeTranscriptLineId);
      if (index !== -1) {
        try {
          transcriptListRef.current.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        } catch (e) {
          // ignore scroll errors if items are not yet rendered
        }
      }
    }
  }, [activeTranscriptLineId, transcriptLines]);

  const recordingTranscriptStates = useMemo<Record<string, RecordingTranscriptState>>(() => {
    const states: Record<string, RecordingTranscriptState> = {};

    remoteRecordings.forEach((recording, index) => {
      const recordingId = getRecordingResourceId(recording, index);
      const status = getRecordingTranscriptionStatus(recording);
      const hasTranscript = hasRecordingTranscript(recording);
      const isProcessing =
        transcribingRecordingId === recordingId || transcriptionProcessingStatuses.has(status);
      const isFailed = transcriptionFailedStatuses.has(status);
      const error =
        getStringValue(recording, ['transcriptionError', 'error', 'transcription_error']) ??
        (isFailed ? '전사에 실패했습니다.' : undefined);

      states[recordingId] = {
        canStart: !hasTranscript && !isProcessing,
        error,
        hasTranscript,
        isFailed,
        isProcessing,
      };
    });

    return states;
  }, [remoteRecordings, transcribingRecordingId]);
  const selectedRecordingTranscriptState = selectedRecordingId
    ? recordingTranscriptStates[selectedRecordingId]
    : undefined;
  const isSelectedRecordingTranscribing = Boolean(selectedRecordingTranscriptState?.isProcessing);
  const selectedRecordingTranscriptionError =
    transcriptionError ?? selectedRecordingTranscriptState?.error ?? null;
  const isSelectedRecordingTranscriptionFailed = Boolean(
    selectedRecordingTranscriptState?.isFailed || selectedRecordingTranscriptionError,
  );
  const canStartSelectedRecordingTranscription = Boolean(
    !isRecording && selectedRecordingId && selectedRecordingTranscriptState?.canStart,
  );
  const allSourcesSelected =
    sessionSourceItems.length > 0 &&
    sessionSourceItems.every((source) => selectedSourceIds.has(source.uid));

  useEffect(() => {
    setSelectedSourceIds(new Set(sessionSourceItems.map((source) => source.uid)));
  }, [sourceSelectionKey]);

  useEffect(() => {
    if (!selectedRecordingId) return;
    const hasSelectedRecording = sessionSourceItems.some((source) => source.recordingId === selectedRecordingId);
    if (!hasSelectedRecording) {
      setSelectedRecordingId(null);
      setSelectedTranscriptLineId(null);
      setTranscriptionError(null);
    }
  }, [selectedRecordingId, sessionSourceItems]);

  useEffect(() => {
    setSelectedTranscriptLineId(null);
  }, [selectedRecordingId]);

  useEffect(() => {
    if (!selectedTranscriptLineId) {
      return;
    }

    const selectedLine = transcriptLines.find((line) => line.id === selectedTranscriptLineId);

    if (!selectedLine) {
      setSelectedTranscriptLineId(null);
      return;
    }

    const selectedStartSeconds =
      typeof selectedLine.startSeconds === 'number'
        ? selectedLine.startSeconds
        : parsePlaybackTimeLabel(selectedLine.time);

    if (playbackCurrentTime > selectedStartSeconds + 0.75) {
      setSelectedTranscriptLineId(null);
    }
  }, [playbackCurrentTime, selectedTranscriptLineId, transcriptLines]);
  const voiceDotStyles = useMemo(
    () =>
      voiceDotWeights.map((weight, index) => {
        const level = isRecordingPaused ? 0 : recordingAudioLevel;
        return {
          opacity: Math.min(1, 0.34 + level * (0.46 + index * 0.025)),
          transform: [{ scaleY: 0.5 + Math.min(1.45, level * weight * 1.75) }],
        };
      }),
    [isRecordingPaused, recordingAudioLevel],
  );

  const scriptResizePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          scriptDragStartWidthRef.current = currentScriptPaneWidth;
        },
        onPanResponderMove: (_, gestureState) => {
          setScriptPaneWidth(
            clamp(
              scriptDragStartWidthRef.current + gestureState.dx,
              activeMinScriptWidth,
              maxScriptPaneWidth,
            ),
          );
        },
      }),
    [activeMinScriptWidth, currentScriptPaneWidth, maxScriptPaneWidth],
  );

  const aiResizePanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => !isAiCollapsed,
        onStartShouldSetPanResponder: () => !isAiCollapsed,
        onPanResponderGrant: () => {
          aiDragStartWidthRef.current = openAiPanelWidth;
        },
        onPanResponderMove: (_, gestureState) => {
          setAiPanelWidth(
            clamp(
              aiDragStartWidthRef.current - gestureState.dx,
              layout.minAiWidth,
              layout.maxOpenAiWidth,
            ),
          );
        },
      }),
    [isAiCollapsed, layout.maxOpenAiWidth, layout.minAiWidth, openAiPanelWidth],
  );

  useEffect(() => {
    const playAnimations = () => {
      emptyTranscriptAnimationRef.current?.play();
      transcriptionPreparingAnimationRef.current?.play();
      chatbotAnimationRef.current?.play();
    };

    playAnimations();
    const timer = setInterval(playAnimations, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    setWorkspaceSession(null);
    setPdfMaterials([]);
    setCurrentPdfId(null);
    setMaterialLoadingId(null);
    setIsPdfListOpen(false);
    setIsSourceMenuOpen(false);
    setAudioSources([]);
    setSelectedRecordingId(null);
    setPlaybackRecordingId(null);
    setPlaybackError(null);
    setSelectedSourceIds(new Set());
    setTranscribingRecordingId(null);
    setTranscriptionError(null);
    setPdfPageCommand(null);
    pendingAnnotationSessionRef.current = null;
    if (annotationSaveTimerRef.current) {
      clearTimeout(annotationSaveTimerRef.current);
      annotationSaveTimerRef.current = null;
    }

    if (!sessionId) {
      setSessionError(null);
      setSessionLoading(false);
      return;
    }

    setSessionLoading(true);
    setSessionError(null);

    getWorkspaceSession(sessionId)
      .then((session) => {
        if (isCancelled) return;
        setWorkspaceSession(session);
      })
      .catch((error) => {
        if (isCancelled) return;
        const message = error instanceof Error ? error.message : '세션 파일을 불러오지 못했습니다.';
        setWorkspaceSession(null);
        setSessionError(message);
      })
      .finally(() => {
        if (isCancelled) return;
        setSessionLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [sessionId]);

  useEffect(
    () => () => {
      if (annotationSaveTimerRef.current) {
        clearTimeout(annotationSaveTimerRef.current);
      }
      audioPlayer.pause();
    },
    [audioPlayer],
  );

  useEffect(() => {
    if (!playbackRecordingId) {
      audioPlayer.pause();
      loadedPlaybackUrlRef.current = null;
      return;
    }

    audioPlayer.pause();
    loadedPlaybackUrlRef.current = null;
    setPlaybackError(null);
  }, [audioPlayer, playbackRecordingId]);

  useEffect(() => {
    if (!isRecording) {
      return;
    }

    const nextSeconds = Math.floor(Math.max(0, recorderState.durationMillis) / 1000);
    setRecordingSeconds(nextSeconds);

    if (isRecordingPaused) {
      setRecordingAudioLevel(0);
      return;
    }

    if (typeof recorderState.metering === 'number') {
      setRecordingAudioLevel(clamp((recorderState.metering + 60) / 60, 0.08, 1));
    } else {
      setRecordingAudioLevel(0.64);
    }
  }, [isRecording, isRecordingPaused, recorderState.durationMillis, recorderState.metering]);

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '알 수 없는 오류가 발생했습니다.';
  };

  const refreshWorkspaceSession = async () => {
    if (!sessionId) return null;
    const nextSession = await getWorkspaceSession(sessionId);
    setWorkspaceSession(nextSession);
    return nextSession;
  };

  const applySessionResult = async (result: unknown) => {
    if (isObjectRecord(result) && isObjectRecord(result.node)) {
      const nextSession = result.node as WorkspaceSessionNode;
      setWorkspaceSession(nextSession);
      return nextSession;
    }

    return refreshWorkspaceSession();
  };

  const uploadRecordingSource = async (
    file: WorkspaceUploadFile,
    options: { durationSeconds?: number; title: string },
  ) => {
    if (!sessionId) {
      throw new Error('DB 세션 파일을 먼저 열어주세요.');
    }

    const uploadResult = await uploadWorkspaceRecording(sessionId, file, options);
    const nextSession = await applySessionResult(uploadResult);
    const recordingId = resolveUploadedRecordingId(nextSession, uploadResult.recording, options.title);

    if (recordingId) {
      setSelectedRecordingId(recordingId);
      setPlaybackRecordingId(recordingId);
      setTranscriptionError(null);
      setPlaybackError(null);
    }

    return recordingId;
  };

  const getLocalPlaybackUri = async (url: string, recording?: WorkspaceRecordingResource | null) => {
    if (/^(file|blob):/i.test(url)) {
      return url;
    }

    const cacheKey = createPlaybackCacheKey(url, recording);
    const cachedUri = playbackLocalCacheRef.current[cacheKey];

    if (cachedUri) {
      return cachedUri;
    }

    const cacheDirectory = new Directory(Paths.cache, 'workspace-audio-playback');
    cacheDirectory.create({ idempotent: true, intermediates: true });

    const extension = getAudioCacheExtension(url, recording);
    const safeName = sanitizeFileName(`recording-${hashPlaybackCacheKey(cacheKey)}${extension}`);
    const targetFile = new File(cacheDirectory, safeName);

    if (targetFile.exists) {
      playbackLocalCacheRef.current[cacheKey] = targetFile.uri;
      return targetFile.uri;
    }

    const downloadedFile = await File.downloadFileAsync(url, targetFile);
    playbackLocalCacheRef.current[cacheKey] = downloadedFile.uri;

    return downloadedFile.uri;
  };

  const toggleRecordingPlayback = async () => {
    if (!playbackRecording) {
      return;
    }

    if (!playbackRecordingUrl) {
      setPlaybackError('음성 파일 주소를 찾지 못했습니다.');
      Alert.alert('음성을 재생할 수 없어요', '음성 파일 주소를 찾지 못했습니다.');
      return;
    }

    try {
      setPlaybackError(null);
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (audioPlayerStatus.playing) {
        audioPlayer.pause();
        return;
      }

      const localPlaybackUri = await getLocalPlaybackUri(playbackRecordingUrl, playbackRecording);

      if (loadedPlaybackUrlRef.current !== localPlaybackUri) {
        audioPlayer.replace({ uri: localPlaybackUri });
        loadedPlaybackUrlRef.current = localPlaybackUri;
        await waitForAudioSource();
      }

      if (
        audioPlayerStatus.didJustFinish ||
        (playbackDuration > 0 && playbackCurrentTime >= playbackDuration - 0.2)
      ) {
        await audioPlayer.seekTo(0);
      }

      audioPlayer.play();
    } catch (error) {
      const message = getErrorMessage(error);
      setPlaybackError(message);
      Alert.alert('음성을 재생할 수 없어요', message);
    }
  };

  const seekRecordingPlaybackBy = async (amountSeconds: number) => {
    if (!playbackRecordingUrl) {
      return;
    }

    try {
      setPlaybackError(null);

      const localPlaybackUri = await getLocalPlaybackUri(playbackRecordingUrl, playbackRecording);

      if (loadedPlaybackUrlRef.current !== localPlaybackUri) {
        audioPlayer.replace({ uri: localPlaybackUri });
        loadedPlaybackUrlRef.current = localPlaybackUri;
        await waitForAudioSource();
      }

      const fallbackDuration = playbackDuration > 0 ? playbackDuration : playbackCurrentTime + amountSeconds;
      const nextTime = clamp(playbackCurrentTime + amountSeconds, 0, Math.max(fallbackDuration, 0));
      await audioPlayer.seekTo(nextTime);
    } catch (error) {
      const message = getErrorMessage(error);
      setPlaybackError(message);
    }
  };

  const seekRecordingPlaybackTo = async (
    targetSeconds: number,
    options?: {
      play?: boolean;
      recording?: WorkspaceRecordingResource | null;
      recordingId?: string | null;
    },
  ) => {
    const targetRecording = options?.recording ?? playbackRecording;
    const targetUrl = getRecordingPlaybackUrl(targetRecording);

    if (!targetUrl) {
      setPlaybackError('음성 파일 주소를 찾지 못했습니다.');
      return;
    }

    try {
      setPlaybackError(null);
      setPlaybackRecordingId(options?.recordingId ?? playbackRecordingId);

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const localPlaybackUri = await getLocalPlaybackUri(targetUrl, targetRecording);

      if (loadedPlaybackUrlRef.current !== localPlaybackUri) {
        audioPlayer.replace({ uri: localPlaybackUri });
        loadedPlaybackUrlRef.current = localPlaybackUri;
        await waitForAudioSource();
      }

      const safeTargetSeconds = Math.max(0, targetSeconds);
      await audioPlayer.seekTo(safeTargetSeconds);

      if (options?.play) {
        audioPlayer.play();
      }
    } catch (error) {
      const message = getErrorMessage(error);
      setPlaybackError(message);
      Alert.alert('음성을 재생할 수 없어요', message);
    }
  };

  const closeRecordingPlayback = () => {
    audioPlayer.pause();
    loadedPlaybackUrlRef.current = null;
    setPlaybackRecordingId(null);
    setPlaybackError(null);
  };

  const handleTranscriptLinePress = async (line: TranscriptLine) => {
    if (!selectedTranscriptRecording) {
      return;
    }

    setSelectedTranscriptLineId(line.id);

    const targetSeconds =
      typeof line.startSeconds === 'number' ? line.startSeconds : parsePlaybackTimeLabel(line.time);

    await seekRecordingPlaybackTo(targetSeconds, {
      play: true,
      recording: selectedTranscriptRecording,
      recordingId: line.recordingId,
    });
  };

  const startRecordingTranscription = async (recordingId?: string | null) => {
    if (!sessionId) {
      Alert.alert('세션 파일이 필요해요', 'DB에 저장된 세션 파일을 연 뒤 전사를 시작해 주세요.');
      return;
    }

    if (!recordingId) {
      Alert.alert('음성소스가 필요해요', '전사할 음성소스를 먼저 선택해 주세요.');
      return;
    }

    if (transcribingRecordingId) {
      return;
    }

    setSelectedRecordingId(recordingId);
    setTranscribingRecordingId(recordingId);
    setTranscriptionError(null);
    setIsSourceMenuOpen(false);

    try {
      const transcribeResult = await transcribeWorkspaceRecording(sessionId, recordingId);
      await applySessionResult(transcribeResult);
      setSelectedRecordingId(recordingId);
    } catch (error) {
      setTranscriptionError(getErrorMessage(error));
    } finally {
      setTranscribingRecordingId(null);
    }
  };

  const createRecordingTitle = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${sessionTitle} 녹음 ${hours}:${minutes}`;
  };

  const startWorkspaceRecording = async () => {
    if (isRecordingSubmitting) return;

    if (!sessionId || !workspaceSession) {
      Alert.alert('세션 파일이 필요해요', 'DB에 저장된 세션 파일을 연 뒤 녹음을 시작해 주세요.');
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('마이크 권한이 필요해요', '설정에서 마이크 권한을 허용한 뒤 다시 시도해 주세요.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      recordingPausedRef.current = false;
      setTranscriptionError(null);
      await audioRecorder.prepareToRecordAsync(workspaceRecordingOptions);
      audioRecorder.record();

      setIsRecording(true);
      setIsRecordingPaused(false);
      setRecordingSeconds(0);
      setRecordingAudioLevel(0.64);
    } catch (error) {
      recordingPausedRef.current = false;
      Alert.alert('녹음을 시작하지 못했어요', getErrorMessage(error));
      setIsRecording(false);
      setIsRecordingPaused(false);
      setRecordingSeconds(0);
      setRecordingAudioLevel(0);
    }
  };

  const toggleWorkspaceRecordingPause = async () => {
    if (!isRecording || isRecordingSubmitting) return;

    try {
      if (isRecordingPaused) {
        audioRecorder.record();
        recordingPausedRef.current = false;
        setIsRecordingPaused(false);
        return;
      }

      audioRecorder.pause();
      recordingPausedRef.current = true;
      setIsRecordingPaused(true);
    } catch (error) {
      Alert.alert('녹음 상태를 변경하지 못했어요', getErrorMessage(error));
    }
  };

  const stopWorkspaceRecording = async () => {
    if (!isRecording || isRecordingSubmitting) return;

    setIsRecordingSubmitting(true);

    try {
      await audioRecorder.stop();
      const recordingUri = audioRecorder.uri ?? recorderState.url;
      if (!recordingUri) {
        throw new Error('녹음 파일 주소를 찾지 못했습니다.');
      }

      const title = createRecordingTitle();
      const durationSeconds = Math.max(1, Math.round(recordingSeconds || recorderState.durationMillis / 1000));
      await uploadRecordingSource(
        {
          mimeType: 'audio/m4a',
          name: `${sanitizeFileName(title)}.m4a`,
          type: 'audio/m4a',
          uri: recordingUri,
        },
        { durationSeconds, title },
      );
    } catch (error) {
      Alert.alert('녹음 저장에 실패했어요', getErrorMessage(error));
    } finally {
      setIsRecording(false);
      setIsRecordingPaused(false);
      setRecordingSeconds(0);
      setRecordingAudioLevel(0);
      setIsRecordingSubmitting(false);
      recordingPausedRef.current = false;
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
  };

  const addMaterialToRemoteSession = async (material: WorkspaceMaterialResource) => {
    if (!sessionId || !workspaceSession) return null;

    const nextWeeks = appendMaterialToSessionWeeks(workspaceSession, material);
    const nextSession = await saveSessionResources(sessionId, nextWeeks);
    setWorkspaceSession(nextSession);
    return nextSession;
  };

  const scheduleAnnotationSave = () => {
    if (annotationSaveTimerRef.current) {
      clearTimeout(annotationSaveTimerRef.current);
    }

    annotationSaveTimerRef.current = setTimeout(async () => {
      const pendingSession = pendingAnnotationSessionRef.current;
      if (!sessionId || !pendingSession) return;

      try {
        const nextSession = await saveSessionResources(sessionId, getSessionWeeks(pendingSession));
        setWorkspaceSession(nextSession);
        pendingAnnotationSessionRef.current = null;
      } catch (error) {
        console.warn('PDF annotation autosave failed.', error);
      }
    }, 900);
  };

  const handlePdfAnnotationStroke = (stroke: PdfAnnotationStroke) => {
    if (!currentPdf?.id) return;

    const normalizedStroke = normalizeAnnotationStroke(stroke);
    if (!normalizedStroke) return;

    setWorkspaceSession((currentSession) => {
      if (!currentSession) return currentSession;

      const nextSession = appendMaterialAnnotationStroke(currentSession, currentPdf.id, normalizedStroke);
      if (nextSession === currentSession) {
        return currentSession;
      }

      pendingAnnotationSessionRef.current = nextSession;
      scheduleAnnotationSave();
      return nextSession;
    });
  };

  const getDownloadErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '알 수 없는 다운로드 오류';
  };

  const downloadMaterialFile = async (url: string, fileName: string) => {
    const destination = new File(Paths.cache, sanitizeFileName(fileName));

    try {
      return await File.downloadFileAsync(url, destination, { idempotent: true });
    } catch (nativeDownloadError) {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/pdf,*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      destination.create({ intermediates: true, overwrite: true });
      destination.write(bytes);

      console.warn('PDF native download failed; fetch fallback succeeded.', nativeDownloadError);
      return destination;
    }
  };

  const loadRemoteMaterialPdf = async (source: SessionSourceItem) => {
    if (!source.materialId) return;
    const existingMaterial = pdfMaterials.find((material) => material.id === source.materialId);
    if (existingMaterial) {
      setCurrentPdfId(existingMaterial.id);
      setActiveTab('materials');
      return;
    }

    const materialIndex = remoteMaterials.findIndex(
      (material, index) => getMaterialResourceId(material, index) === source.materialId,
    );
    const material = materialIndex >= 0 ? remoteMaterials[materialIndex] : null;
    if (!material) return;

    const materialUrlPath = getStringValue(material, ['url', 'fileUrl', 'materialUrl']);
    const storedName = getStringValue(material, ['storedName']);
    const url = getWorkspaceAssetUrl(
      materialUrlPath ?? (storedName ? `/workspace/uploads/materials/${encodeURIComponent(storedName)}` : undefined),
    );
    if (!url) {
      Alert.alert('강의자료를 열 수 없어요', '파일 주소를 찾지 못했습니다.');
      return;
    }

    setMaterialLoadingId(source.materialId);
    try {
      const fileName = getMaterialResourceName(material, materialIndex);
      const downloadedFile = await downloadMaterialFile(url, `${source.materialId}-${fileName}`);
      const base64 = await downloadedFile.base64();
      const nextPdf: PdfMaterial = {
        base64,
        id: source.materialId,
        mimeType: getStringValue(material, ['mimeType', 'type']) ?? 'application/pdf',
        name: fileName,
        size: getNumberValue(material, ['size']),
        uri: downloadedFile.uri,
      };

      setPdfMaterials((items) => [nextPdf, ...items.filter((item) => item.id !== nextPdf.id)]);
      setCurrentPdfId(nextPdf.id);
      setActiveTab('materials');
    } catch (error) {
      const message = getDownloadErrorMessage(error);
      console.warn('Material PDF download failed.', { error, url });
      Alert.alert('강의자료를 열 수 없어요', `${message}\n\nURL: ${url}`);
    } finally {
      setMaterialLoadingId(null);
    }
  };

  const pickPdf = async () => {
    try {
      if (!sessionId || !workspaceSession) {
        Alert.alert('세션 파일이 필요해요', 'DB에 저장된 세션 파일을 연 뒤 강의자료를 추가해 주세요.');
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: 'application/pdf',
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        return;
      }

      setActiveTab('materials');
      setIsAiCollapsed(true);
      setIsPdfListOpen(false);
      setIsSourceMenuOpen(false);
      setIsMaterialUploading(true);

      const pickedName = normalizeUploadFileName(
        asset.name || asset.uri.split('?')[0]?.split('/').pop(),
        '강의자료.pdf',
      );
      const base64 = await new File(asset.uri).base64();
      const uploadedMaterial = await uploadWorkspaceMaterial(sessionId, {
        mimeType: asset.mimeType,
        name: pickedName,
        type: asset.mimeType,
        uri: asset.uri,
      });
      const normalizedUploadedMaterial = {
        ...uploadedMaterial,
        fileName: pickedName,
        name: pickedName,
        originalName: pickedName,
        title: pickedName,
      };
      await addMaterialToRemoteSession(normalizedUploadedMaterial);

      const uploadedMaterialId = getMaterialResourceId(normalizedUploadedMaterial, 0);
      const material: PdfMaterial = {
        base64,
        id: uploadedMaterialId,
        mimeType: asset.mimeType,
        name: pickedName,
        size: asset.size,
        uri: asset.uri,
      };

      setPdfMaterials((items) => [material, ...items.filter((item) => item.id !== material.id)]);
      setCurrentPdfId(material.id);
      setActiveTab('materials');
      setIsAiCollapsed(true);
      setIsPdfListOpen(false);
      setIsSourceMenuOpen(false);
    } catch {
      Alert.alert('PDF를 열 수 없어요', '파일을 다시 선택해 주세요.');
    } finally {
      setIsMaterialUploading(false);
    }
  };

  const pickAudioSource = async () => {
    try {
      if (!sessionId || !workspaceSession) {
        Alert.alert('세션 파일이 필요해요', 'DB에 저장된 세션 파일을 연 뒤 음성소스를 추가해 주세요.');
        return;
      }

      setIsAudioUploading(true);
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['audio/*', 'audio/m4a', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/aac'],
      });

      if (result.canceled) {
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) {
        return;
      }

      const originalName = asset.name || '음성소스.m4a';
      const title = originalName.replace(/\.[^.]+$/, '') || '음성소스';
      await uploadRecordingSource(
        {
          mimeType: asset.mimeType ?? 'audio/m4a',
          name: originalName,
          type: asset.mimeType ?? 'audio/m4a',
          uri: asset.uri,
        },
        { title },
      );

      setActiveTab('materials');
      setIsSourceMenuOpen(false);
    } catch (error) {
      Alert.alert('음성소스를 추가하지 못했어요', getErrorMessage(error));
    } finally {
      setIsAudioUploading(false);
    }
  };

  const selectSourceItem = async (source: SessionSourceItem) => {
    if (source.kind === 'material') {
      await loadRemoteMaterialPdf(source);
      setActiveTab('materials');
    }

    if (source.kind === 'recording') {
      setSelectedRecordingId(source.recordingId ?? null);
      setPlaybackRecordingId(source.recordingId ?? null);
      setTranscriptionError(null);
      setPlaybackError(null);
    }

    setIsSourceMenuOpen(false);
  };

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const toggleAllSourceSelection = () => {
    setSelectedSourceIds((current) => {
      if (sessionSourceItems.length === 0) {
        return current;
      }

      if (sessionSourceItems.every((source) => current.has(source.uid))) {
        return new Set();
      }

      return new Set(sessionSourceItems.map((source) => source.uid));
    });
  };

  const handleNewChat = () => {
    if (isSending) return;
    startNewChat();
    setIsChatSessionMenuOpen(false);
    setEditingChatSessionId('');
    setAiInput('');
  };

  const handleChatSessionSelect = (nextSessionId: string) => {
    if (isSending) return;
    switchChatSession(nextSessionId);
    setIsChatSessionMenuOpen(false);
    setEditingChatSessionId('');
  };

  const startEditingChatTitle = (summary: { id: string; title: string }) => {
    setEditingChatSessionId(summary.id);
    setEditingChatTitle(summary.title);
  };

  const commitChatTitleEdit = () => {
    if (!editingChatSessionId) return;
    renameChatSession(editingChatSessionId, editingChatTitle);
    setEditingChatSessionId('');
    setEditingChatTitle('');
  };

  const cancelChatTitleEdit = () => {
    setEditingChatSessionId('');
    setEditingChatTitle('');
  };

  const handleCitationClick = useCallback(() => {}, []);

  const findMaterialSourceForCitation = useCallback((raw: Record<string, unknown>) => {
    const materialId = String(raw.material_id || raw.materialId || '');
    const storedName = String(raw.stored_name || raw.storedName || '');
    const materialName = String(raw.material_name || raw.file_title || raw.title || '');

    return sessionSourceItems.find((source) => {
      if (source.kind !== 'material') return false;
      return Boolean(
        (materialId && source.materialId === materialId) ||
        (storedName && source.name.includes(storedName)) ||
        (materialName && source.name === materialName),
      );
    });
  }, [sessionSourceItems]);

  const openMaterialCitationSource = useCallback(async (raw: Record<string, unknown>) => {
    const source = findMaterialSourceForCitation(raw);
    if (!source) {
      Alert.alert('근거 자료를 열 수 없어요', '현재 세션에서 해당 PDF 자료를 찾지 못했습니다.');
      return;
    }

    await loadRemoteMaterialPdf(source);
    setActiveTab('materials');
    setIsSourceMenuOpen(false);
    const page = Number(raw.page || 1);
    setPdfPageCommand({ id: Date.now(), page: Number.isFinite(page) && page > 0 ? page : 1 });
  }, [findMaterialSourceForCitation, loadRemoteMaterialPdf]);

  const openTranscriptCitationSource = useCallback(async (raw: Record<string, unknown>) => {
    const recordingId = String(raw.recording_id || raw.recordingId || '');
    const targetRecordingIndex = remoteRecordings.findIndex(
      (recording, index) => getRecordingResourceId(recording, index) === recordingId,
    );
    const targetRecording = targetRecordingIndex >= 0 ? remoteRecordings[targetRecordingIndex] : selectedTranscriptRecording;
    const targetRecordingId = targetRecording
      ? getRecordingResourceId(targetRecording, targetRecordingIndex >= 0 ? targetRecordingIndex : 0)
      : recordingId || selectedRecordingId;

    if (targetRecordingId) {
      setSelectedRecordingId(targetRecordingId);
      setPlaybackRecordingId(targetRecordingId);
    }

    const candidateLines = targetRecording ? buildTranscriptLines([targetRecording]) : transcriptLines;
    const startTime = Number(raw.start_time ?? raw.startTime ?? 0);
    const targetLine =
      candidateLines.find((line) => {
        const lineStart = typeof line.startSeconds === 'number' ? line.startSeconds : parsePlaybackTimeLabel(line.time);
        return lineStart >= startTime;
      }) ?? candidateLines[0];

    if (targetLine) {
      setSelectedTranscriptLineId(targetLine.id);
    }

    if (targetRecording && Number.isFinite(startTime)) {
      await seekRecordingPlaybackTo(Math.max(0, startTime), {
        play: true,
        recording: targetRecording,
        recordingId: targetRecordingId,
      });
    }
  }, [
    remoteRecordings,
    selectedRecordingId,
    selectedTranscriptRecording,
    seekRecordingPlaybackTo,
    transcriptLines,
  ]);

  const handleSourceView = useCallback(async (citation: NormalizedCitation | Record<string, unknown>) => {
    const raw = ((citation as NormalizedCitation).raw || citation) as Record<string, unknown>;
    const targetSessionId = String(raw.session_id || raw.sessionId || '');

    if (targetSessionId && targetSessionId !== sessionId) {
      router.push({
        pathname: '/workspace',
        params: {
          citation: JSON.stringify(raw),
          sessionId: targetSessionId,
        },
      });
      return;
    }

    if (raw.source_type === 'material' || raw.material_id || raw.stored_name) {
      await openMaterialCitationSource(raw);
      return;
    }

    await openTranscriptCitationSource(raw);
  }, [openMaterialCitationSource, openTranscriptCitationSource, router, sessionId]);

  useEffect(() => {
    if (!citationParam || !workspaceSession || handledCitationParamRef.current === citationParam) return;
    const parsed = safeParseCitationParam(citationParam);
    if (!parsed) return;
    handledCitationParamRef.current = citationParam;
    handleSourceView(parsed);
  }, [citationParam, handleSourceView, workspaceSession]);

  const handleTranscriptWordPress = useCallback(async (word: string, context: string) => {
    const cleanWord = cleanSelectedWord(word);
    if (!cleanWord) return;

    const requestId = wordInsightRequestRef.current + 1;
    wordInsightRequestRef.current = requestId;
    setWordInsight({
      desc: '',
      error: '',
      isLoading: true,
      source: 'AI 분석 결과',
      visible: true,
      word: cleanWord,
    });

    try {
      const result = await requestChatAnswer({
        mode: 'word_explanation',
        question: buildWordExplanationQuestion(cleanWord, context),
        session_id: sessionId ?? null,
      });

      if (wordInsightRequestRef.current !== requestId) return;
      setWordInsight({
        desc: result.answer.trim() || 'AI 설명 결과가 비어 있습니다.',
        error: '',
        isLoading: false,
        source: 'AI 분석 결과',
        visible: true,
        word: cleanWord,
      });
    } catch (error) {
      if (wordInsightRequestRef.current !== requestId) return;
      setWordInsight({
        desc: 'AI 분석 결과를 불러오지 못했습니다.',
        error: error instanceof Error ? error.message : 'AI 분석 결과를 불러오지 못했습니다.',
        isLoading: false,
        source: 'AI 분석 실패',
        visible: true,
        word: cleanWord,
      });
    }
  }, [sessionId]);

  const handleWordAskAi = () => {
    if (!wordInsight?.word) return;
    setAiInput(`"${wordInsight.word}"라는 단어를 강의 맥락에 맞춰 설명해줘.`);
    setIsAiCollapsed(false);
  };

  const sendMessage = useCallback(() => {
    const question = aiInput.trim();
    if (!question || isSending) return;

    setIsSending(true);
    setAiInput('');
    
    appendMessages([
      { role: 'user', text: question },
      { role: 'ai', text: '', phase: 'analyzing', statusText: '질문 분석 중', citations: [] }
    ]);

    const sourceFilterObj = buildChatSourceFilter(selectedSourceIds, sessionSourceItems);
    
    stopChatStreamRef.current = startChatStream(
      {
        question,
        is_thinking: false,
        session_id: sessionId ?? null,
        source_filter: sourceFilterObj,
      },
      {
        onStatus: (phase, message) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'ai') {
              next[next.length - 1] = {
                ...last,
                phase,
                statusText: message,
              };
            }
            return next;
          });
        },
        onCitations: (citations) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'ai') {
              next[next.length - 1] = {
                ...last,
                citations,
              };
            }
            return next;
          });
        },
        onToken: (token) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'ai') {
              next[next.length - 1] = {
                ...last,
                phase: 'answering',
                text: `${last.text || ''}${token}`,
              };
            }
            return next;
          });
        },
        onError: (error) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'ai') {
              next[next.length - 1] = {
                ...last,
                phase: 'done',
                text: `${last.text || ''}\n\n오류: ${error}`,
              };
            }
            return next;
          });
          setIsSending(false);
        },
        onDone: () => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'ai') {
              next[next.length - 1] = {
                ...last,
                phase: 'done',
              };
            }
            return next;
          });
          setIsSending(false);
        }
      }
    )?.abort;
  }, [aiInput, appendMessages, isSending, selectedSourceIds, sessionId, sessionSourceItems, setMessages]);

  useEffect(() => {
    return () => {
      if (stopChatStreamRef.current) stopChatStreamRef.current();
    };
  }, []);

  const materialsPanel = (
    <MaterialsPanel
      currentPdf={currentPdf}
      annotations={currentPdfAnnotations}
      isPdfListOpen={isPdfListOpen}
      isMaterialUploading={isMaterialUploading}
      isSessionLoading={sessionLoading}
      onClosePdfList={() => setIsPdfListOpen(false)}
      onAnnotationStroke={handlePdfAnnotationStroke}
      onPickPdf={pickPdf}
      onSelectPdf={(id) => {
        setCurrentPdfId(id);
        setIsPdfListOpen(false);
      }}
      onTogglePdfList={() => setIsPdfListOpen((value) => !value)}
      pageCommand={pdfPageCommand}
      pdfMaterials={pdfMaterials}
      remoteMaterialCount={remoteMaterials.length}
      remoteRecordingCount={remoteRecordings.length}
      sessionError={sessionError}
      sessionTitle={sessionTitle}
    />
  );

  return (
    <SafeAreaView style={styles.root}>
      <View
        style={[
          styles.workspacePage,
          {
            gap: layout.gap,
            paddingBottom: 5,
            paddingHorizontal: layout.outerMargin,
            paddingTop: 5,
          },
        ]}>
        <View
          style={[
            styles.unifiedCard,
            { borderRadius: layout.radius },
          ]}>
          <View style={[styles.scriptPane, { width: currentScriptPaneWidth }]}>
            <View style={styles.scriptHeader}>
              <Pressable
                onPress={() => router.push('/workfolder')}
                style={({ hovered, pressed }) => [
                  styles.backButton,
                  (hovered || pressed) && styles.headerIconButtonHover,
                ]}>
                <MaterialIcons name="keyboard-arrow-left" size={28} color="#1D1D1F" />
              </Pressable>

              <Text numberOfLines={1} style={styles.fileTitle}>
                {sessionTitle}
              </Text>

              <View style={styles.recordingControl}>
                {!isRecording ? (
                  <Pressable
                    disabled={isRecordingSubmitting}
                    onPress={startWorkspaceRecording}
                    style={[styles.recordButton, isRecordingSubmitting && styles.recordButtonDisabled]}>
                    <Text style={styles.recordButtonText}>
                      {isRecordingSubmitting ? '저장중' : '녹음시작'}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <View
                      style={[
                        styles.recordingVoiceDots,
                        isRecordingPaused && styles.recordingVoiceDotsPaused,
                      ]}>
                      {voiceDotStyles.map((dotStyle, dotIndex) => (
                        <View
                          key={`recording-dot-${dotIndex}`}
                          style={[styles.recordingVoiceDot, dotStyle]}
                        />
                      ))}
                    </View>

                    <Text style={styles.recordingTime}>{recordingTimeText}</Text>

                    <Pressable
                      disabled={isRecordingSubmitting}
                      onPress={toggleWorkspaceRecordingPause}
                      style={[styles.recordingIconButton, isRecordingPaused && styles.recordingIconButtonPaused]}>
                      {!isRecordingPaused ? (
                        <View style={styles.recordingPauseBars}>
                          <View style={styles.recordingPauseBar} />
                          <View style={styles.recordingPauseBar} />
                        </View>
                      ) : (
                        <View style={styles.recordingPlayTriangle} />
                      )}
                    </Pressable>

                    <Pressable
                      disabled={isRecordingSubmitting}
                      onPress={stopWorkspaceRecording}
                      style={[
                        styles.recordButton,
                        styles.recordStopButton,
                        isRecordingSubmitting && styles.recordButtonDisabled,
                      ]}>
                      <Text style={styles.recordButtonText}>
                        {isRecordingSubmitting ? '저장중' : '종료'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>

            <View style={styles.scriptToolbar}>
              <View style={styles.scriptTabWrap}>
                <Text style={styles.scriptTabText}>스크립트</Text>
                <View style={styles.scriptTabLine} />
              </View>

              <Pressable style={styles.searchButton}>
                <MaterialIcons name="search" size={28} color="#68707D" />
              </Pressable>
            </View>

            {wordInsight?.visible ? (
              <WordInsightCard
                insight={wordInsight}
                onAskAi={handleWordAskAi}
                onClose={() => setWordInsight((current) => current ? { ...current, visible: false } : current)}
              />
            ) : null}

            {sessionLoading ? (
              <View style={styles.emptyScriptState}>
                <ActivityIndicator color="#1D1D1F" />
                <Text style={styles.emptyScriptText}>세션 데이터를 불러오는 중...</Text>
              </View>
            ) : isSelectedRecordingTranscribing ? (
              <View style={styles.transcriptionPreparingState}>
                <LottieView
                  ref={transcriptionPreparingAnimationRef}
                  autoPlay
                  loop
                  resizeMode="contain"
                  source={require('@/assets/groupchat/animations/transcription-preparing.json')}
                  style={styles.transcriptionPreparingAnimation}
                />
                <Text style={styles.transcriptionPreparingTitle}>스크립트를 준비 중입니다</Text>
                <Text style={styles.transcriptionPreparingDescription}>
                  업로드한 음성파일을 전사하고 있습니다. 완료되면 여기에 바로 표시됩니다.
                </Text>
              </View>
            ) : transcriptLines.length > 0 ? (
              <FlatList
                ref={transcriptListRef}
                data={transcriptLines}
                keyExtractor={(line) => line.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.transcriptList}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    try {
                      transcriptListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
                    } catch (e) {}
                  }, 100);
                }}
                renderItem={({ item: line }) => {
                  const isActiveLine = line.id === activeTranscriptLineId;

                  return (
                    <View style={styles.transcriptItem}>
                      <Pressable
                        onPress={() => handleTranscriptLinePress(line)}
                        style={styles.transcriptTimeButton}>
                        <Text style={[styles.transcriptTime, isActiveLine && styles.transcriptTimeActive]}>
                          {line.time}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleTranscriptLinePress(line)}
                        style={styles.transcriptBubble}>
                        <View style={styles.transcriptTextBlock}>
                          <Text style={[styles.transcriptText, isActiveLine && styles.transcriptTextActive]}>
                            {splitTranscriptTextTokens(line.text).map((token) => (
                              token.isWord ? (
                                <Text
                                  key={token.id}
                                  onPress={() => handleTranscriptWordPress(token.value, line.text)}
                                  style={[styles.transcriptWordText, isActiveLine && styles.transcriptWordTextActive]}
                                  suppressHighlighting>
                                  {token.value}
                                </Text>
                              ) : token.value
                            ))}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  );
                }}
              />
            ) : (
              <View style={styles.emptyScriptState}>
                <LottieView
                  ref={emptyTranscriptAnimationRef}
                  loop={false}
                  resizeMode="contain"
                  source={require('@/assets/groupchat/animations/boy-girl-chat.json')}
                  style={[
                    styles.emptyTranscriptAnimation,
                    { height: emptyAnimationHeight, width: emptyAnimationWidth },
                  ]}
                />
                <Text style={styles.emptyScriptText}>
                  {sessionError
                    ? '세션 데이터를 불러오지 못했습니다.'
                    : isRecording
                      ? '실시간 전사를 기다리는 중입니다.'
                    : selectedRecordingId
                      ? '선택한 음성소스의 전사 데이터가 없습니다.'
                      : '전사된 데이터가 없습니다.'}
                </Text>
                {isSelectedRecordingTranscriptionFailed ? (
                  <Text style={styles.transcriptionFailedText}>
                    {selectedRecordingTranscriptionError ?? '전사에 실패했습니다.'}
                  </Text>
                ) : null}
                {canStartSelectedRecordingTranscription || isSelectedRecordingTranscriptionFailed ? (
                  <Pressable
                    disabled={!selectedRecordingId || Boolean(transcribingRecordingId)}
                    onPress={() => startRecordingTranscription(selectedRecordingId)}
                    style={[
                      styles.transcriptionStartButton,
                      (!selectedRecordingId || Boolean(transcribingRecordingId)) &&
                        styles.transcriptionStartButtonDisabled,
                    ]}>
                    <Text style={styles.transcriptionStartButtonText}>
                      {isSelectedRecordingTranscriptionFailed ? '전사 다시 시작' : '전사 시작'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </View>

          <View {...scriptResizePanResponder.panHandlers} style={styles.scriptResizeHandle}>
            <View style={styles.scriptResizeLine} />
          </View>

          <View style={styles.contentPane}>
            {isSourceMenuOpen && (
              <Pressable
                onPress={() => setIsSourceMenuOpen(false)}
                style={styles.sourceMenuDismissLayer}
              />
            )}

            <View style={styles.tabHeader}>
              <View style={styles.topTabsGroup}>
                {tabs.map((tab) => (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={styles.topTab}>
                    <Text style={[styles.topTabText, activeTab === tab.key && styles.topTabTextActive]}>
                      {tab.label}
                    </Text>
                    {activeTab === tab.key && <View style={styles.topTabLine} />}
                  </Pressable>
                ))}
              </View>

              <View style={styles.headerActions}>
                <View style={styles.sourceMenuAnchor}>
                  <Pressable
                    onPress={() => setIsSourceMenuOpen((value) => !value)}
                    style={({ hovered, pressed }) => [
                      styles.sourceHeaderButton,
                      (hovered || pressed || isSourceMenuOpen) && styles.headerIconButtonHover,
                    ]}>
                    <MaterialIcons name="folder-open" size={23} color="#1D1D1F" />
                  </Pressable>

                  {isSourceMenuOpen && (
                    <SourceFilesPopover
                      allSourcesSelected={allSourcesSelected}
                      currentPdfId={currentPdf?.id ?? null}
                      currentRecordingId={selectedRecordingId}
                      folderTitle={getSessionFolderTitle(workspaceSession)}
                      groups={sessionSourceGroups}
                      isAudioUploading={isAudioUploading}
                      loadingSourceId={materialLoadingId}
                      onAddAudio={pickAudioSource}
                      onAddMaterial={() => {
                        setIsSourceMenuOpen(false);
                        pickPdf();
                      }}
                      onSelectSource={selectSourceItem}
                      onStartTranscription={(recordingId) => startRecordingTranscription(recordingId)}
                      onToggleAllSources={toggleAllSourceSelection}
                      onToggleSource={toggleSourceSelection}
                      recordingStates={recordingTranscriptStates}
                      selectedSourceIds={selectedSourceIds}
                      transcribingRecordingId={transcribingRecordingId}
                    />
                  )}
                </View>

                <Pressable
                  onPress={() => setIsAiCollapsed((value) => !value)}
                  style={({ hovered, pressed }) => [
                    styles.aiHeaderToggle,
                    (hovered || pressed) && styles.headerIconButtonHover,
                  ]}>
                  <AiPanelIcon />
                </Pressable>
              </View>
            </View>

            {activeTab === 'materials' && currentPdf ? (
              <View style={styles.pdfContentContainer}>{materialsPanel}</View>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.contentScroll}>
                {activeTab === 'materials' && materialsPanel}
                {activeTab === 'summary' && (
                  <SummaryPanel sessionId={sessionId ?? ''} sessionTitle={sessionTitle} />
                )}
                {activeTab === 'quiz' && (
                  <QuizPanel sessionId={sessionId ?? ''} sessionTitle={sessionTitle} />
                )}
              </ScrollView>
            )}

            {activeTab === 'materials' && currentPdf ? (
              <View style={styles.pageFloatingControls}>
                <Pressable
                  onPress={() => setPdfPageCommand({ direction: 'previous', id: Date.now() })}
                  style={styles.pageFloatingButton}>
                  <MaterialIcons name="keyboard-arrow-left" size={24} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  onPress={() => setPdfPageCommand({ direction: 'next', id: Date.now() })}
                  style={styles.pageFloatingButton}>
                  <MaterialIcons name="keyboard-arrow-right" size={24} color="#FFFFFF" />
                </Pressable>
              </View>
            ) : null}
          </View>

          {playbackRecording ? (
            <AudioPlaybackBar
              currentTime={playbackCurrentTime}
              duration={playbackDuration}
              error={playbackError}
              isPlaying={audioPlayerStatus.playing}
              onClose={closeRecordingPlayback}
              onSeekBackward={() => seekRecordingPlaybackBy(-5)}
              onSeekForward={() => seekRecordingPlaybackBy(5)}
              onTogglePlay={toggleRecordingPlayback}
              progress={playbackProgress}
              title={getRecordingResourceName(
                playbackRecording,
                playbackRecordingIndex >= 0 ? playbackRecordingIndex : 0,
              )}
            />
          ) : null}
        </View>

        {!isAiCollapsed && (
          <View
            {...aiResizePanResponder.panHandlers}
            style={[
              styles.aiResizeHandle,
              {
                bottom: layout.outerMargin,
                right: layout.outerMargin + currentAiPanelWidth + layout.gap / 2 - 12,
                top: layout.outerMargin,
              },
            ]}>
            <View style={styles.aiResizeGrip} />
          </View>
        )}

        {!isAiCollapsed && (
          <View
            style={[
              styles.aiPanel,
              { borderRadius: layout.radius, width: currentAiPanelWidth },
            ]}>
              <View style={styles.chatSessionToolbar}>
                <Pressable
                  disabled={isSending}
                  onPress={() => setIsChatSessionMenuOpen((value) => !value)}
                  style={styles.chatSessionToggle}>
                  <MaterialIcons name="forum" size={17} color="#64748B" />
                  <Text numberOfLines={1} style={styles.chatSessionToggleText}>
                    {chatSessionSummaries.find((session) => session.id === activeChatSessionId)?.title || '새 채팅'}
                  </Text>
                  <MaterialIcons
                    name={isChatSessionMenuOpen ? 'expand-less' : 'expand-more'}
                    size={18}
                    color="#64748B"
                  />
                </Pressable>
                <Pressable disabled={isSending} onPress={handleNewChat} style={styles.chatSessionNewButton}>
                  <MaterialIcons name="add" size={17} color="#FFFFFF" />
                  <Text style={styles.chatSessionNewText}>새 채팅</Text>
                </Pressable>
              </View>

              {isChatSessionMenuOpen ? (
                <View style={styles.chatSessionMenu}>
                  <Pressable disabled={isSending} onPress={handleNewChat} style={styles.chatSessionMenuNew}>
                    <MaterialIcons name="add-comment" size={17} color="#1D1D1F" />
                    <Text style={styles.chatSessionMenuNewText}>새로운 채팅 시작</Text>
                  </Pressable>
                  <ScrollView
                    bounces={false}
                    showsVerticalScrollIndicator={false}
                    style={styles.chatSessionMenuScroll}>
                    {chatSessionSummaries.map((session) => (
                      <View
                        key={session.id}
                        style={[
                          styles.chatSessionMenuItem,
                          session.id === activeChatSessionId && styles.chatSessionMenuItemActive,
                        ]}>
                        {editingChatSessionId === session.id ? (
                          <TextInput
                            autoFocus
                            maxLength={40}
                            onBlur={commitChatTitleEdit}
                            onChangeText={setEditingChatTitle}
                            onSubmitEditing={commitChatTitleEdit}
                            onKeyPress={({ nativeEvent }) => {
                              if (nativeEvent.key === 'Escape') cancelChatTitleEdit();
                            }}
                            style={styles.chatSessionTitleInput}
                            value={editingChatTitle}
                          />
                        ) : (
                          <Pressable
                            disabled={isSending}
                            onPress={() => handleChatSessionSelect(session.id)}
                            style={styles.chatSessionTitleButton}>
                            <MaterialIcons name="chat-bubble" size={15} color="#94A3B8" />
                            <Text numberOfLines={1} style={styles.chatSessionTitleText}>{session.title}</Text>
                          </Pressable>
                        )}
                        <Pressable
                          disabled={isSending}
                          onPress={() =>
                            editingChatSessionId === session.id
                              ? commitChatTitleEdit()
                              : startEditingChatTitle(session)
                          }
                          style={styles.chatSessionEditButton}>
                          <MaterialIcons
                            name={editingChatSessionId === session.id ? 'check' : 'edit'}
                            size={15}
                            color="#64748B"
                          />
                        </Pressable>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              ) : null}

              <View style={{ flex: 1, position: 'relative' }}>
                {messages.length === 0 ? (
                  <View style={styles.aiCenter}>
                    <LottieView
                      ref={chatbotAnimationRef}
                      loop={false}
                      resizeMode="contain"
                      source={require('@/assets/groupchat/animations/Chatbot.json')}
                      style={styles.chatbotAnimation}
                    />
                    <Text style={styles.aiPrompt}>무엇을 도와드릴까요?</Text>
                  </View>
                ) : (
                  <ScrollView
                    ref={chatScrollRef}
                    onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16, gap: 20, paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {messages.map((msg, index) => (
                      <View key={index}>
                        {msg.role === 'user' ? (
                          <View style={styles.chatRowUser}>
                            <View style={styles.chatBubbleUser}>
                              <Text style={styles.chatTextUser}>{msg.text}</Text>
                            </View>
                          </View>
                        ) : (
                          <View style={styles.chatRowAi}>
                            {!!msg.text && (
                              <CitationInlineText 
                                text={msg.text} 
                                citations={msg.citations} 
                                enableCitations={msg.phase === 'done'}
                                onCitationClick={handleCitationClick}
                                onSourceView={handleSourceView}
                                style={styles.chatTextAi}
                              />
                            )}
                            
                            {msg.phase && msg.phase !== 'done' && !msg.text && (
                              <View style={styles.aiStreamWait}>
                                <ActivityIndicator size="small" color="#3B82F6" style={{ marginRight: 6 }} />
                                <Text style={styles.aiStreamStatusText}>{msg.statusText || '답변 준비 중...'}</Text>
                              </View>
                            )}
                            
                            {msg.phase && msg.phase !== 'done' && !!msg.text && (
                              <View style={[styles.aiStreamWait, { marginTop: 8 }]}>
                                <ActivityIndicator size="small" color="#3B82F6" style={{ marginRight: 6 }} />
                                <Text style={styles.aiStreamStatusText}>{msg.statusText || '답변 생성 중...'}</Text>
                              </View>
                            )}
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}
              </View>

              <View style={styles.aiInputBox}>
                <TextInput
                  value={aiInput}
                  onChangeText={setAiInput}
                  placeholder="무엇이든 물어보세요..."
                  placeholderTextColor="#A4A8B2"
                  style={styles.aiInput}
                  onSubmitEditing={sendMessage}
                  returnKeyType="send"
                  multiline
                />
                <Pressable 
                  style={[styles.sendButton, aiInput.trim() && !isSending ? styles.sendButtonActive : null]}
                  onPress={sendMessage}
                  disabled={!aiInput.trim() || isSending}
                >
                  <MaterialIcons name="arrow-upward" size={22} color="#FFFFFF" />
                </Pressable>
              </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function AiPanelIcon() {
  return (
    <View style={styles.aiPanelIconFrame}>
      <View style={styles.aiPanelIconBar} />
      <View style={styles.aiPanelIconChevron} />
    </View>
  );
}

function WordInsightCard({
  insight,
  onAskAi,
  onClose,
}: {
  insight: WordInsight;
  onAskAi: () => void;
  onClose: () => void;
}) {
  return (
    <View style={styles.wordInsightCard}>
      <View style={styles.wordInsightHeader}>
        <View style={styles.wordInsightIcon}>
          <MaterialIcons name="auto-awesome" size={15} color="#2563EB" />
        </View>
        <View style={styles.wordInsightTitleWrap}>
          <Text numberOfLines={1} style={styles.wordInsightWord}>{insight.word}</Text>
          <Text style={styles.wordInsightSource}>{insight.source}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.wordInsightCloseButton}>
          <MaterialIcons name="close" size={16} color="#64748B" />
        </Pressable>
      </View>

      <View style={styles.wordInsightBody}>
        {insight.isLoading ? (
          <View style={styles.wordInsightLoading}>
            <ActivityIndicator color="#2563EB" size="small" />
            <Text style={styles.wordInsightText}>단어 의미를 찾는 중...</Text>
          </View>
        ) : (
          <Text style={[styles.wordInsightText, insight.error && styles.wordInsightErrorText]}>
            {insight.desc}
          </Text>
        )}
      </View>

      <Pressable disabled={insight.isLoading} onPress={onAskAi} style={styles.wordInsightAskButton}>
        <MaterialIcons name="chat" size={14} color="#FFFFFF" />
        <Text style={styles.wordInsightAskText}>AI 채팅에 묻기</Text>
      </Pressable>
    </View>
  );
}

type SourceFilesPopoverProps = {
  allSourcesSelected: boolean;
  currentPdfId: string | null;
  currentRecordingId: string | null;
  folderTitle: string;
  groups: SessionSourceGroup[];
  isAudioUploading: boolean;
  loadingSourceId: string | null;
  onAddAudio: () => void;
  onAddMaterial: () => void;
  onSelectSource: (source: SessionSourceItem) => void;
  onStartTranscription: (recordingId?: string | null) => void;
  onToggleAllSources: () => void;
  onToggleSource: (sourceId: string) => void;
  recordingStates: Record<string, RecordingTranscriptState>;
  selectedSourceIds: Set<string>;
  transcribingRecordingId: string | null;
};

function SourceFilesPopover({
  allSourcesSelected,
  currentPdfId,
  currentRecordingId,
  folderTitle,
  groups,
  isAudioUploading,
  loadingSourceId,
  onAddAudio,
  onAddMaterial,
  onSelectSource,
  onStartTranscription,
  onToggleAllSources,
  onToggleSource,
  recordingStates,
  selectedSourceIds,
  transcribingRecordingId,
}: SourceFilesPopoverProps) {
  const totalSourceCount = groups.reduce((sum, group) => sum + group.sourceCount, 0);
  const [isAddSourceMenuOpen, setIsAddSourceMenuOpen] = useState(false);

  const addMaterial = () => {
    setIsAddSourceMenuOpen(false);
    onAddMaterial();
  };

  const addAudio = () => {
    if (isAudioUploading) return;
    setIsAddSourceMenuOpen(false);
    onAddAudio();
  };

  return (
    <View style={styles.sourceFilesPopover}>
      <View style={styles.sourceFilesHeader}>
        <Text style={styles.sourceFilesTitle}>소스파일</Text>
        <Text style={styles.sourceFilesCount}>{totalSourceCount}개</Text>
      </View>

      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={styles.sourceFilesScroll}
        contentContainerStyle={styles.sourceTree}>
        {totalSourceCount > 0 ? (
          <>
            <Pressable onPress={onToggleAllSources} style={styles.sourceSelectAllRow}>
              <Text style={styles.sourceSelectAllText}>모두 선택</Text>
              <SourceCheckbox checked={allSourcesSelected} />
            </Pressable>

            <View style={styles.sourceFolderShell}>
              <View style={styles.sourceFolderHeading}>
                <MaterialIcons name="folder" size={19} color="#AAB4C0" />
                <Text numberOfLines={1} style={styles.sourceFolderTitle}>
                  {folderTitle}
                </Text>
                <Text style={styles.sourceFolderCount}>{groups.length}개 파일</Text>
              </View>

              {groups.map((group) => (
                <View key={group.id} style={[styles.sourceFileGroup, group.isActive && styles.sourceFileGroupActive]}>
                  <View style={styles.sourceFileRow}>
                    <MaterialIcons
                      name="description"
                      size={18}
                      color={group.isActive ? '#60A5FA' : '#A7AFBA'}
                    />
                    <Text numberOfLines={1} style={styles.sourceFileGroupTitle}>
                      {group.title}
                    </Text>
                    <Text style={styles.sourceFileGroupCount}>{group.sourceCount}개</Text>
                  </View>

                  {group.sources.length > 0 ? (
                    <View style={styles.sourceFileNestedList}>
                      {group.sources.map((source) => {
                        const isActive =
                          Boolean(source.kind === 'material' && source.materialId && source.materialId === currentPdfId) ||
                          Boolean(
                            source.kind === 'recording' &&
                              source.recordingId &&
                              source.recordingId === currentRecordingId,
                          );
                        const isChecked = selectedSourceIds.has(source.uid);
                        const isLoading =
                          source.kind === 'material' && source.materialId && source.materialId === loadingSourceId;
                        const recordingState =
                          source.kind === 'recording' && source.recordingId
                            ? recordingStates[source.recordingId]
                            : undefined;
                        const isTranscribingSource = Boolean(
                          source.kind === 'recording' &&
                          source.recordingId &&
                          transcribingRecordingId === source.recordingId,
                        );
                        const canStartTranscription = Boolean(
                          source.kind === 'recording' &&
                          source.recordingId &&
                          (recordingState?.canStart || recordingState?.isFailed) &&
                          !isTranscribingSource,
                        );
                        return (
                          <View key={source.uid} style={styles.sourceCheckRow}>
                            <Pressable
                              onPress={() => onSelectSource(source)}
                              style={[
                                styles.sourceNestedIconButton,
                                source.kind === 'recording' && styles.sourceNestedAudioIconButton,
                              ]}>
                              {isLoading ? (
                                <ActivityIndicator size="small" color="#2563EB" />
                              ) : (
                                <MaterialIcons
                                  name={source.icon as keyof typeof MaterialIcons.glyphMap}
                                  size={16}
                                  color={source.kind === 'recording' ? '#F59E0B' : '#2563EB'}
                                />
                              )}
                            </Pressable>

                            <Pressable
                              onPress={() => onSelectSource(source)}
                              style={[styles.sourceNestedOpenButton, isActive && styles.sourceNestedOpenButtonActive]}>
                              <Text
                                numberOfLines={1}
                                style={[styles.sourceNestedName, isActive && styles.sourceNestedNameActive]}>
                                {source.name}
                              </Text>
                              <Text numberOfLines={1} style={styles.sourceNestedMeta}>
                                {source.meta}
                              </Text>
                            </Pressable>

                            {source.kind === 'recording' && source.recordingId ? (
                              canStartTranscription ? (
                                <Pressable
                                  onPress={() => onStartTranscription(source.recordingId)}
                                  style={[
                                    styles.sourceTranscriptionAction,
                                    recordingState?.isFailed && styles.sourceTranscriptionActionFailed,
                                  ]}>
                                  <Text style={styles.sourceTranscriptionActionText}>
                                    {recordingState?.isFailed ? '다시 전사' : '전사 시작'}
                                  </Text>
                                </Pressable>
                              ) : recordingState?.isProcessing || isTranscribingSource ? (
                                <View style={styles.sourceTranscriptionProcessing}>
                                  <ActivityIndicator size="small" color="#64748B" />
                                  <Text style={styles.sourceTranscriptionProcessingText}>전사 중</Text>
                                </View>
                              ) : null
                            ) : null}

                            <Pressable
                              hitSlop={8}
                              onPress={() => onToggleSource(source.uid)}
                              style={styles.sourceCheckboxButton}>
                              <SourceCheckbox checked={isChecked} />
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={styles.sourceFileEmptyLine}>
                      <Text style={styles.sourceFileEmptyText}>저장된 소스가 없습니다.</Text>
                    </View>
                  )}
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.sourceFileEmptyState}>
            <MaterialIcons name="folder-open" size={26} color="#A9B3BF" />
            <Text style={styles.sourceFileEmptyText}>아직 저장된 소스파일이 없습니다.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.sourceAddButtonGroup}>
        {isAddSourceMenuOpen ? (
          <View style={styles.sourceAddChoiceMenu}>
            <Pressable onPress={addMaterial} style={styles.sourceAddChoiceRow}>
              <MaterialIcons name="picture-as-pdf" size={18} color="#1D1D1F" />
              <Text style={styles.sourceAddChoiceText}>강의자료 추가</Text>
            </Pressable>
            <Pressable
              disabled={isAudioUploading}
              onPress={addAudio}
              style={[styles.sourceAddChoiceRow, isAudioUploading && styles.sourceAddChoiceRowDisabled]}>
              {isAudioUploading ? (
                <ActivityIndicator size="small" color="#1D1D1F" />
              ) : (
                <MaterialIcons name="graphic-eq" size={18} color="#1D1D1F" />
              )}
              <Text style={styles.sourceAddChoiceText}>음성 추가</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable
          onPress={() => setIsAddSourceMenuOpen((value) => !value)}
          style={[styles.sourceAddButton, isAddSourceMenuOpen && styles.sourceAddButtonActive]}>
          <MaterialIcons name={isAddSourceMenuOpen ? 'close' : 'add'} size={19} color="#FFFFFF" />
          <Text style={styles.sourceAddButtonText}>소스 추가</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SourceCheckbox({ checked }: { checked: boolean }) {
  return (
    <View style={[styles.sourceCheckbox, checked && styles.sourceCheckboxChecked]}>
      {checked ? <MaterialIcons name="check" size={14} color="#64748B" /> : null}
    </View>
  );
}

type AudioPlaybackBarProps = {
  currentTime: number;
  duration: number;
  error: string | null;
  isPlaying: boolean;
  onClose: () => void;
  onSeekBackward: () => void;
  onSeekForward: () => void;
  onTogglePlay: () => void;
  progress: number;
  title: string;
};

function AudioPlaybackBar({
  currentTime,
  duration,
  error,
  isPlaying,
  onClose,
  onSeekBackward,
  onSeekForward,
  onTogglePlay,
  progress,
  title,
}: AudioPlaybackBarProps) {
  return (
    <View style={styles.audioPlaybackBar}>
      <View style={styles.audioPlaybackSourceHeader}>
        <Text numberOfLines={1} style={styles.audioPlaybackTitle}>
          {title}
        </Text>

        <Pressable onPress={onClose} style={styles.audioPlaybackCloseButton}>
          <MaterialIcons name="close" size={18} color="#8D93A1" />
        </Pressable>
      </View>

      <View style={styles.audioPlaybackTrackRow}>
        <Text style={styles.audioPlaybackTime}>{formatPlaybackTime(currentTime)}</Text>
        <View style={styles.audioPlaybackProgressTrack}>
          <View style={[styles.audioPlaybackProgressFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.audioPlaybackProgressThumb, { left: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.audioPlaybackTime}>{formatPlaybackTime(duration)}</Text>
      </View>

      <View style={styles.audioPlaybackActions}>
        <Pressable onPress={onSeekBackward} style={styles.audioPlaybackActionButton}>
          <MaterialIcons name="replay-5" size={20} color="#6F7582" />
        </Pressable>
        <Pressable onPress={onTogglePlay} style={styles.audioPlaybackPlayButton}>
          <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={30} color="#15161A" />
        </Pressable>
        <Pressable onPress={onSeekForward} style={styles.audioPlaybackActionButton}>
          <MaterialIcons name="forward-5" size={20} color="#6F7582" />
        </Pressable>
        <Text style={styles.audioPlaybackSpeed}>1x</Text>
      </View>

      {error ? (
        <Text numberOfLines={1} style={styles.audioPlaybackError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

type MaterialsPanelProps = {
  annotations: PdfAnnotationPayload;
  currentPdf: PdfMaterial | null;
  isPdfListOpen: boolean;
  isMaterialUploading: boolean;
  isSessionLoading: boolean;
  onAnnotationStroke: (stroke: PdfAnnotationStroke) => void;
  onClosePdfList: () => void;
  onPickPdf: () => void;
  onSelectPdf: (id: string) => void;
  onTogglePdfList: () => void;
  pageCommand: PdfPageCommand | null;
  pdfMaterials: PdfMaterial[];
  remoteMaterialCount: number;
  remoteRecordingCount: number;
  sessionError: string | null;
  sessionTitle: string;
};

function MaterialsPanel({
  annotations,
  currentPdf,
  isPdfListOpen,
  isMaterialUploading,
  isSessionLoading,
  onAnnotationStroke,
  onClosePdfList,
  onPickPdf,
  onSelectPdf,
  onTogglePdfList,
  pageCommand,
  pdfMaterials,
  remoteMaterialCount,
  remoteRecordingCount,
  sessionError,
  sessionTitle,
}: MaterialsPanelProps) {
  const pdfWebViewRef = useRef<WebView>(null);
  const pdfViewerHtmlRef = useRef<{ html: string; key: string } | null>(null);
  const drawToolRef = useRef<DrawTool>(defaultDrawTool);
  const strokeWidthsRef = useRef<StrokeWidths>(defaultStrokeWidths);
  const [isPenMode, setIsPenMode] = useState(false);
  const [isPenPaletteOpen, setIsPenPaletteOpen] = useState(false);
  const [selectedColorIndex, setSelectedColorIndex] = useState(0);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [drawTool, setDrawTool] = useState<DrawTool>(defaultDrawTool);
  const [strokeWidths, setStrokeWidths] = useState<StrokeWidths>(defaultStrokeWidths);
  const [colorOptions, setColorOptions] = useState(defaultPenColors);
  const selectedStrokeKey = getStrokeWidthKey(drawTool);
  const selectedStrokeWidth = strokeWidths[selectedStrokeKey];
  const selectedToolColor = drawTool.mode === 'eraser' ? '#6B7280' : drawTool.color;

  useEffect(() => {
    setIsPenMode(false);
    setIsPenPaletteOpen(false);
    setSelectedColorIndex(0);
    setIsColorPickerOpen(false);
    setDrawTool(defaultDrawTool);
    setStrokeWidths(defaultStrokeWidths);
    setColorOptions(defaultPenColors);
    drawToolRef.current = defaultDrawTool;
    strokeWidthsRef.current = defaultStrokeWidths;
  }, [currentPdf?.id]);

  const injectDrawingState = (nextPenMode: boolean, nextTool: DrawTool) => {
    pdfWebViewRef.current?.injectJavaScript(
      `window.setPenMode && window.setPenMode(${nextPenMode}); window.setDrawTool && window.setDrawTool(${JSON.stringify(nextTool)}); true;`,
    );
  };

  const scrollPdfPage = (direction: 'next' | 'previous') => {
    pdfWebViewRef.current?.injectJavaScript(
      `window.scrollPdfPage && window.scrollPdfPage(${JSON.stringify(direction)}); true;`,
    );
  };

  const scrollPdfToPage = (page: number) => {
    pdfWebViewRef.current?.injectJavaScript(
      `window.scrollPdfToPage && window.scrollPdfToPage(${JSON.stringify(page)}); true;`,
    );
  };

  useEffect(() => {
    if (!pageCommand || !currentPdf) return;
    if ('page' in pageCommand) {
      scrollPdfToPage(pageCommand.page);
      return;
    }

    scrollPdfPage(pageCommand.direction);
  }, [currentPdf, pageCommand]);

  const closeFloatingPopovers = () => {
    if (isPdfListOpen) {
      onClosePdfList();
    }

    if (isColorPickerOpen) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsColorPickerOpen(false);
    }
  };

  const closePenPaletteOnly = () => {
    if (!isColorPickerOpen) {
      return;
    }

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsColorPickerOpen(false);
  };

  const applyDrawTool = (partialTool: Partial<DrawTool>, nextStrokeWidths = strokeWidths) => {
    const nextTool = normalizeDrawTool({ ...drawToolRef.current, ...partialTool }, nextStrokeWidths);

    drawToolRef.current = nextTool;
    strokeWidthsRef.current = nextStrokeWidths;
    setDrawTool(nextTool);
    setIsPenMode(true);
    injectDrawingState(true, nextTool);
  };

  const applyDrawingToolKind = (key: StrokeWidthKey) => {
    if (key === 'eraser') {
      applyDrawTool({ mode: 'eraser' });
      return;
    }

    applyDrawTool({
      color: key === 'highlighter' && selectedStrokeKey !== 'highlighter' ? '#F6C344' : drawToolRef.current.color,
      mode: 'pen',
      type: key,
    });
  };

  const selectColor = (colorIndex: number) => {
    setSelectedColorIndex(colorIndex);
    setIsColorPickerOpen(false);
    applyDrawTool({
      color: colorOptions[colorIndex],
      mode: 'pen',
      type: drawToolRef.current.type === 'highlighter' ? 'highlighter' : 'pen',
    });
  };

  const applyPickedColor = (color: string) => {
    setColorOptions((colors) => colors.map((item, index) => (index === selectedColorIndex ? color : item)));
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsColorPickerOpen(false);
    applyDrawTool({
      color,
      mode: 'pen',
      type: drawToolRef.current.type === 'highlighter' ? 'highlighter' : 'pen',
    });
  };

  const toggleColorPicker = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsColorPickerOpen((value) => !value);
  };

  const handleTogglePdfList = () => {
    if (isColorPickerOpen) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setIsColorPickerOpen(false);
    }

    onTogglePdfList();
  };

  const applyStrokeWidth = (nextWidth: number) => {
    const currentTool = drawToolRef.current;
    const currentStrokeKey = getStrokeWidthKey(currentTool);
    const nextRoundedWidth = Math.round(nextWidth * 10) / 10;
    const nextStrokeWidths = {
      ...strokeWidthsRef.current,
      [currentStrokeKey]: nextRoundedWidth,
    };
    const nextTool = normalizeDrawTool(currentTool, nextStrokeWidths);

    strokeWidthsRef.current = nextStrokeWidths;
    drawToolRef.current = nextTool;
    setStrokeWidths(nextStrokeWidths);
    setDrawTool(nextTool);
    setIsPenMode(true);
    injectDrawingState(true, nextTool);
  };

  const currentPdfHtmlKey = currentPdf ? `${currentPdf.id}:${currentPdf.base64.length}` : '';
  const currentPdfViewerHtml =
    currentPdf
      ? (() => {
          if (!pdfViewerHtmlRef.current || pdfViewerHtmlRef.current.key !== currentPdfHtmlKey) {
            pdfViewerHtmlRef.current = {
              html: createPdfViewerHtml(currentPdf.base64, annotations),
              key: currentPdfHtmlKey,
            };
          }

          return pdfViewerHtmlRef.current.html;
        })()
      : '';

  if (currentPdf) {
    return (
      <View style={styles.pdfViewerContent}>
        <WebView
          key={currentPdf.id}
          ref={pdfWebViewRef}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          bounces={false}
          originWhitelist={['*']}
          scrollEnabled
          source={{ html: currentPdfViewerHtml }}
          style={styles.pdfWebView}
          onLoadEnd={() => {
            injectDrawingState(isPenMode, drawTool);
          }}
          onMessage={(event) => {
            const message = parseWebViewMessage(event.nativeEvent.data);

            if (message === 'pdf-canvas-pointerdown') {
              closePenPaletteOnly();
              return;
            }

            if (message && typeof message !== 'string' && message.type === 'pdf-annotation-stroke') {
              const stroke = normalizeAnnotationStroke(message.stroke);
              if (stroke) {
                onAnnotationStroke(stroke);
              }
            }
          }}
        />

        {isMaterialUploading ? (
          <View pointerEvents="none" style={styles.materialUploadOverlay}>
            <View style={styles.materialUploadStatusCard}>
              <LottieView
                autoPlay
                loop
                resizeMode="contain"
                source={require('@/assets/groupchat/animations/upload-file.json')}
                style={styles.materialUploadAnimation}
              />
              <Text style={styles.materialUploadTitle}>강의자료 업로드 중</Text>
              <Text style={styles.materialUploadDescription}>업로드가 끝나면 자료 탭에 바로 표시됩니다.</Text>
            </View>
          </View>
        ) : null}

        {(isPdfListOpen || isColorPickerOpen) && (
          <Pressable
            onPress={closeFloatingPopovers}
            style={styles.pdfPopoverDismissLayer}
          />
        )}

        <View pointerEvents="box-none" style={styles.pdfInlineToolBarDock}>
          <View style={styles.pdfInlineToolBar}>
            <View style={styles.pdfPaletteRow}>
              {drawingToolOptions.map((option) => {
                const isActive = selectedStrokeKey === option.key && isPenMode;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => applyDrawingToolKind(option.key)}
                    style={[styles.pdfPaletteIconButton, isActive && styles.pdfPaletteOptionActive]}>
                    <FontAwesome5 name={option.icon} size={13} color={isActive ? '#FFFFFF' : '#4E5663'} />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.pdfPaletteDivider} />

            <View style={styles.pdfPaletteRow}>
              {colorOptions.map((color, colorIndex) => (
                <Pressable
                  key={`palette-color-${colorIndex}-${color}`}
                  onPress={() => selectColor(colorIndex)}
                  style={[
                    styles.pdfColorSwatch,
                    { backgroundColor: color },
                    selectedColorIndex === colorIndex && styles.pdfColorSwatchActive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.pdfPaletteDivider} />

            <View style={styles.pdfStrokeStepGroup}>
              {strokeWidthPresets[selectedStrokeKey].map((strokeWidth) => {
                const isSelected = Math.abs(selectedStrokeWidth - strokeWidth) < 0.1;
                return (
                  <Pressable
                    key={`${selectedStrokeKey}-${strokeWidth}`}
                    onPress={() => applyStrokeWidth(strokeWidth)}
                    style={[styles.pdfStrokeStepButton, isSelected && styles.pdfStrokeStepButtonActive]}>
                    <View
                      style={[
                        styles.pdfStrokeStepLine,
                        {
                          backgroundColor: isSelected ? '#FFFFFF' : selectedToolColor,
                          height: clamp(strokeWidth / 2.4, 2, 7),
                          opacity: selectedStrokeKey === 'highlighter' && !isSelected ? 0.66 : 1,
                        },
                      ]}
                    />
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={toggleColorPicker}
              style={[styles.pdfColorPickerButton, isColorPickerOpen && styles.pdfColorPickerButtonActive]}>
              <View style={[styles.pdfColorPickerButtonSwatch, { backgroundColor: colorOptions[selectedColorIndex] }]} />
              <MaterialIcons name="color-lens" size={13} color={isColorPickerOpen ? '#FFFFFF' : '#4E5663'} />
            </Pressable>

            {isColorPickerOpen && (
              <View style={styles.pdfColorPickerPopover}>
                {colorPickerOptions.map((color) => (
                  <Pressable
                    key={`picker-${color}`}
                    onPress={() => applyPickedColor(color)}
                    style={[
                      styles.pdfColorPickerSwatch,
                      { backgroundColor: color },
                      colorOptions[selectedColorIndex] === color && styles.pdfColorPickerSwatchActive,
                    ]}
                  />
                ))}
              </View>
            )}
          </View>
        </View>

        {isPdfListOpen && (
          <View style={styles.pdfMaterialPopover}>
            <Text style={styles.pdfMaterialPopoverTitle}>강의자료</Text>

            {pdfMaterials.map((material) => {
              const isSelected = material.id === currentPdf.id;
              return (
                <Pressable
                  key={material.id}
                  onPress={() => onSelectPdf(material.id)}
                  style={[styles.pdfMaterialItem, isSelected && styles.pdfMaterialItemActive]}>
                  <MaterialIcons name="picture-as-pdf" size={20} color={isSelected ? '#1F78FF' : '#7D8591'} />
                  <Text numberOfLines={1} style={[styles.pdfMaterialName, isSelected && styles.pdfMaterialNameActive]}>
                    {material.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.materialsContent}>
      <Text style={styles.contentTitle}>강의자료</Text>
      <Text style={styles.contentSubtitle}>{sessionTitle}</Text>

      {isSessionLoading ? (
        <View style={styles.sessionInfoRow}>
          <ActivityIndicator color="#8E929A" size="small" />
          <Text style={styles.sessionInfoText}>세션 소스파일을 불러오는 중...</Text>
        </View>
      ) : remoteMaterialCount + remoteRecordingCount > 0 ? (
        <View style={styles.sessionInfoRow}>
          <MaterialIcons name="cloud-done" size={18} color="#8E929A" />
          <Text style={styles.sessionInfoText}>
            DB 소스 {remoteMaterialCount + remoteRecordingCount}개 · 강의자료 {remoteMaterialCount}개 · 음성{' '}
            {remoteRecordingCount}개
          </Text>
        </View>
      ) : sessionError ? (
        <View style={styles.sessionInfoRow}>
          <MaterialIcons name="info-outline" size={18} color="#D9480F" />
          <Text style={[styles.sessionInfoText, styles.sessionErrorText]}>{sessionError}</Text>
        </View>
      ) : null}

      <Pressable
        disabled={isMaterialUploading}
        onPress={onPickPdf}
        style={[styles.addMaterialCard, isMaterialUploading && styles.addMaterialCardUploading]}>
        {isMaterialUploading ? (
          <>
            <LottieView
              autoPlay
              loop
              resizeMode="contain"
              source={require('@/assets/groupchat/animations/upload-file.json')}
              style={styles.addMaterialUploadAnimation}
            />
            <View style={styles.addMaterialUploadCopy}>
              <Text style={styles.addMaterialUploadTitle}>강의자료 업로드 중</Text>
              <Text style={styles.addMaterialUploadDescription}>잠시만 기다려주세요.</Text>
            </View>
            <ActivityIndicator color="#2563EB" size="small" style={styles.addMaterialIcon} />
          </>
        ) : (
          <>
            <MaterialIcons name="folder" size={34} color="#A9B3BF" />
            <Text style={styles.addMaterialText}>강의자료를 추가해주세요</Text>
            <MaterialIcons name="add" size={24} color="#9BA3AE" style={styles.addMaterialIcon} />
          </>
        )}
      </Pressable>
    </View>
  );
}

type SavedPanelStatus = 'done' | 'error' | 'idle' | 'loading';
type SummaryFilterKey = SavedSummaryKind | 'all';
type QuizDetailStatus = SavedPanelStatus | 'submitting';
type QuizResultState = {
  correctCount: number;
  score: number;
  totalQuestions: number;
};

const summaryFilterOptions: { key: SummaryFilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'recording', label: '전사' },
  { key: 'material', label: 'PDF' },
  { key: 'speaker', label: '화자' },
  { key: 'session', label: '세션' },
];

function formatSavedDate(value?: string | null) {
  if (!value) return '저장일 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '저장일 없음';

  return date.toLocaleString('ko-KR', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'long',
  });
}

function getTextPreview(text: string, limit = 96) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}...` : normalized;
}

function splitReadableParagraphs(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.length ? paragraphs : [text.trim()].filter(Boolean);
}

type SummaryPanelProps = {
  sessionId: string;
  sessionTitle: string;
};

function SummaryPanel({ sessionId, sessionTitle }: SummaryPanelProps) {
  const [summaryItems, setSummaryItems] = useState<SavedSummaryItem[]>([]);
  const [summaryStatus, setSummaryStatus] = useState<SavedPanelStatus>('idle');
  const [summaryError, setSummaryError] = useState('');
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilterKey>('all');
  const [selectedSummaryId, setSelectedSummaryId] = useState('');

  const loadSummaries = useCallback(async () => {
    if (!sessionId) {
      setSummaryItems([]);
      setSelectedSummaryId('');
      setSummaryStatus('done');
      return;
    }

    setSummaryStatus('loading');
    setSummaryError('');

    try {
      const records = await fetchSessionSummaries(sessionId);
      const items = normalizeSummaryItems(records);
      setSummaryItems(items);
      setSelectedSummaryId((currentId) => (
        items.some((item) => item.id === currentId) ? currentId : items[0]?.id ?? ''
      ));
      setSummaryStatus('done');
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : '요약 목록을 불러오지 못했습니다.');
      setSummaryStatus('error');
    }
  }, [sessionId]);

  useEffect(() => {
    loadSummaries();
  }, [loadSummaries]);

  const summaryCounts = useMemo(() => {
    const counts: Record<SummaryFilterKey, number> = {
      all: summaryItems.length,
      material: 0,
      recording: 0,
      session: 0,
      speaker: 0,
    };

    summaryItems.forEach((item) => {
      counts[item.kind] += 1;
    });

    return counts;
  }, [summaryItems]);

  const filteredSummaryItems = useMemo(
    () => summaryItems.filter((item) => summaryFilter === 'all' || item.kind === summaryFilter),
    [summaryFilter, summaryItems],
  );

  const selectedSummary = useMemo(() => {
    if (!filteredSummaryItems.length) return null;
    return (
      filteredSummaryItems.find((item) => item.id === selectedSummaryId) ??
      filteredSummaryItems[0]
    );
  }, [filteredSummaryItems, selectedSummaryId]);

  return (
    <View style={styles.savedPanel}>
      <View style={styles.savedPanelHeader}>
        <View style={styles.savedPanelTitleGroup}>
          <Text style={styles.contentTitle}>요약</Text>
          <Text style={styles.contentSubtitle}>{sessionTitle}</Text>
        </View>

        <Pressable
          disabled={summaryStatus === 'loading'}
          onPress={loadSummaries}
          style={[styles.savedRefreshButton, summaryStatus === 'loading' && styles.savedRefreshButtonDisabled]}>
          {summaryStatus === 'loading' ? (
            <ActivityIndicator color="#636A78" size="small" />
          ) : (
            <MaterialIcons name="refresh" size={20} color="#303746" />
          )}
          <Text style={styles.savedRefreshText}>새로고침</Text>
        </Pressable>
      </View>

      {summaryError ? (
        <View style={styles.savedErrorBanner}>
          <MaterialIcons name="error-outline" size={18} color="#B42318" />
          <Text style={styles.savedErrorText}>{summaryError}</Text>
        </View>
      ) : null}

      <View style={styles.savedFilterRow}>
        {summaryFilterOptions.map((option) => {
          const isActive = summaryFilter === option.key;
          const count = summaryCounts[option.key];

          return (
            <Pressable
              key={option.key}
              onPress={() => {
                setSummaryFilter(option.key);
                const nextItem = summaryItems.find((item) => option.key === 'all' || item.kind === option.key);
                setSelectedSummaryId(nextItem?.id ?? '');
              }}
              style={[styles.savedFilterButton, isActive && styles.savedFilterButtonActive]}>
              <Text style={[styles.savedFilterText, isActive && styles.savedFilterTextActive]}>
                {option.label} {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {summaryStatus === 'loading' && !summaryItems.length ? (
        <View style={styles.savedEmptyState}>
          <ActivityIndicator color="#8E929A" size="small" />
          <Text style={styles.savedEmptyTitle}>저장된 요약을 불러오는 중입니다.</Text>
        </View>
      ) : filteredSummaryItems.length ? (
        <View style={styles.savedSplitLayout}>
          <View style={styles.savedListColumn}>
            {filteredSummaryItems.map((item) => {
              const isActive = selectedSummary?.id === item.id;
              const kindIconStyle =
                item.kind === 'material'
                  ? styles.summaryKindIcon_material
                  : item.kind === 'speaker'
                    ? styles.summaryKindIcon_speaker
                    : item.kind === 'recording'
                      ? styles.summaryKindIcon_recording
                      : styles.summaryKindIcon_session;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => setSelectedSummaryId(item.id)}
                  style={[styles.savedListItem, isActive && styles.savedListItemActive]}>
                  <View style={styles.savedListItemHeader}>
                    <View style={[styles.savedKindIcon, kindIconStyle, isActive && styles.savedKindIconActive]}>
                      <MaterialIcons
                        name={item.kind === 'material' ? 'picture-as-pdf' : item.kind === 'speaker' ? 'record-voice-over' : 'article'}
                        size={17}
                        color={isActive ? '#FFFFFF' : '#5B6472'}
                      />
                    </View>
                    <View style={styles.savedListItemTitleBlock}>
                      <Text numberOfLines={1} style={styles.savedListItemTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={styles.savedListItemMeta}>
                        {item.subtitle} · {formatSavedDate(item.createdAt)}
                      </Text>
                    </View>
                  </View>
                  <Text numberOfLines={2} style={styles.savedListItemPreview}>
                    {getTextPreview(item.summary)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.savedDetailPane}>
            {selectedSummary ? (
              <>
                <View style={styles.savedDetailHeader}>
                  <View>
                    <Text style={styles.savedDetailTitle}>{selectedSummary.title}</Text>
                    <Text style={styles.savedDetailMeta}>
                      {selectedSummary.subtitle} · {formatSavedDate(selectedSummary.createdAt)}
                    </Text>
                  </View>
                  <View style={styles.savedDetailPill}>
                    <Text style={styles.savedDetailPillText}>
                      {selectedSummary.kind === 'material'
                        ? 'PDF'
                        : selectedSummary.kind === 'speaker'
                          ? '화자'
                          : selectedSummary.kind === 'recording'
                            ? '전사'
                            : '세션'}
                    </Text>
                  </View>
                </View>

                <View style={styles.savedSummaryBody}>
                  {splitReadableParagraphs(selectedSummary.summary).map((paragraph, index) => (
                    <Text key={`${selectedSummary.id}-paragraph-${index}`} style={styles.savedSummaryParagraph}>
                      {paragraph}
                    </Text>
                  ))}
                </View>
              </>
            ) : null}
          </View>
        </View>
      ) : (
        <View style={styles.savedEmptyState}>
          <MaterialIcons name="article" size={31} color="#A6ADB8" />
          <Text style={styles.savedEmptyTitle}>저장된 요약이 없습니다.</Text>
          <Text style={styles.savedEmptyText}>웹에서 생성되어 DB에 저장된 요약이 이곳에 표시됩니다.</Text>
        </View>
      )}
    </View>
  );
}

type QuizPanelProps = {
  sessionId: string;
  sessionTitle: string;
};

function getQuizTypeLabel(type?: string | null) {
  const normalized = String(type ?? '').toUpperCase();
  if (normalized === 'MULTIPLE_CHOICE') return '객관식';
  if (normalized === 'OX') return 'O/X';
  return normalized || '문항';
}

function getQuizListTypeLabel(quiz: SavedQuiz) {
  const multipleChoiceCount = quiz.type_counts?.MULTIPLE_CHOICE ?? 0;
  const oxCount = quiz.type_counts?.OX ?? 0;
  const parts = [
    multipleChoiceCount > 0 ? `객관식 ${multipleChoiceCount}` : '',
    oxCount > 0 ? `O/X ${oxCount}` : '',
  ].filter(Boolean);

  return parts.length ? parts.join(' · ') : '저장 퀴즈';
}

function getQuizTotalQuestions(quiz: SavedQuiz | null) {
  return quiz?.total_questions ?? getQuizQuestions(quiz).length;
}

function isQuizAnswerCorrect(question: QuizQuestion, answer: string) {
  if (typeof question.is_correct === 'boolean') return question.is_correct;
  return String(question.correct_answer ?? '').trim() === answer.trim();
}

function QuizPanel({ sessionId, sessionTitle }: QuizPanelProps) {
  const [quizList, setQuizList] = useState<SavedQuiz[]>([]);
  const [activeQuiz, setActiveQuiz] = useState<SavedQuiz | null>(null);
  const [quizListStatus, setQuizListStatus] = useState<SavedPanelStatus>('idle');
  const [quizDetailStatus, setQuizDetailStatus] = useState<QuizDetailStatus>('idle');
  const [quizError, setQuizError] = useState('');
  const [loadingQuizId, setLoadingQuizId] = useState('');
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizResult, setQuizResult] = useState<QuizResultState | null>(null);
  const [activeQuestionPage, setActiveQuestionPage] = useState(0);

  const applyQuizDetail = useCallback((quiz: SavedQuiz, page = 0) => {
    const questions = getQuizQuestions(quiz);
    const answers = questions.reduce<Record<string, string>>((result, question, index) => {
      const userAnswer = typeof question.user_answer === 'string' ? question.user_answer : '';
      if (userAnswer) {
        result[getQuizQuestionKey(question, index)] = userAnswer;
      }
      return result;
    }, {});
    const totalQuestions = getQuizTotalQuestions(quiz) || questions.length;
    const correctCount = typeof quiz.correct_count === 'number' ? quiz.correct_count : null;

    setActiveQuiz({ ...quiz, quiz_data: questions });
    setQuizAnswers(answers);
    setQuizResult(
      correctCount === null
        ? null
        : {
            correctCount,
            score: totalQuestions ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0,
            totalQuestions,
          },
    );
    setActiveQuestionPage(Math.min(page, Math.max(0, questions.length - 1)));
  }, []);

  const loadQuizDetail = useCallback(async (quizId: string, page = 0) => {
    if (!quizId) return;

    setLoadingQuizId(quizId);
    setQuizDetailStatus('loading');
    setQuizError('');

    try {
      const quiz = await fetchQuizDetail(quizId);
      applyQuizDetail(quiz, page);
      setQuizDetailStatus('done');
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : '퀴즈를 불러오지 못했습니다.');
      setQuizDetailStatus('error');
    } finally {
      setLoadingQuizId('');
    }
  }, [applyQuizDetail]);

  const loadQuizList = useCallback(async () => {
    if (!sessionId) {
      setQuizList([]);
      setActiveQuiz(null);
      setQuizAnswers({});
      setQuizResult(null);
      setQuizListStatus('done');
      return;
    }

    setQuizListStatus('loading');
    setQuizError('');

    try {
      const quizzes = await fetchSessionQuizzes(sessionId);
      setQuizList(quizzes);
      setQuizListStatus('done');

      if (quizzes[0]?.quiz_id) {
        await loadQuizDetail(quizzes[0].quiz_id);
      } else {
        setActiveQuiz(null);
        setQuizAnswers({});
        setQuizResult(null);
        setQuizDetailStatus('idle');
      }
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : '퀴즈 목록을 불러오지 못했습니다.');
      setQuizListStatus('error');
    }
  }, [loadQuizDetail, sessionId]);

  useEffect(() => {
    loadQuizList();
  }, [loadQuizList]);

  const questions = useMemo(() => getQuizQuestions(activeQuiz), [activeQuiz]);
  const currentQuestion = questions[activeQuestionPage] ?? null;
  const currentQuestionKey = currentQuestion
    ? getQuizQuestionKey(currentQuestion, activeQuestionPage)
    : '';
  const currentAnswer = currentQuestionKey ? quizAnswers[currentQuestionKey] ?? '' : '';
  const answeredQuestionCount = useMemo(
    () => questions.filter((question, index) => quizAnswers[getQuizQuestionKey(question, index)]).length,
    [questions, quizAnswers],
  );
  const canSubmitQuiz =
    Boolean(activeQuiz?.quiz_id) &&
    questions.length > 0 &&
    answeredQuestionCount === questions.length &&
    !quizResult &&
    quizDetailStatus !== 'submitting';

  const setQuizAnswer = (question: QuizQuestion, index: number, answer: string) => {
    if (quizResult) return;
    setQuizAnswers((currentAnswers) => ({
      ...currentAnswers,
      [getQuizQuestionKey(question, index)]: answer,
    }));
  };

  const submitAnswers = async () => {
    if (!activeQuiz?.quiz_id || !canSubmitQuiz) return;

    setQuizDetailStatus('submitting');
    setQuizError('');

    try {
      const result = await submitQuizAnswers(activeQuiz.quiz_id, quizAnswers);
      const nextQuiz: SavedQuiz = {
        ...activeQuiz,
        ...result,
        correct_count: result.correct_count,
        quiz_data: result.quiz_data,
        total_questions: result.total_questions,
      };

      applyQuizDetail(nextQuiz, activeQuestionPage);
      setQuizList((items) => items.map((item) => (
        item.quiz_id === result.quiz_id
          ? {
              ...item,
              correct_count: result.correct_count,
              total_questions: result.total_questions,
            }
          : item
      )));
      setQuizResult({
        correctCount: result.correct_count,
        score: result.score,
        totalQuestions: result.total_questions,
      });
      setQuizDetailStatus('done');
    } catch (error) {
      setQuizError(error instanceof Error ? error.message : '퀴즈 채점에 실패했습니다.');
      setQuizDetailStatus('error');
    }
  };

  const resetQuizAttempt = () => {
    if (!activeQuiz) return;

    const resetQuestions = questions.map((question) => ({
      ...question,
      is_correct: null,
      user_answer: null,
    }));

    setActiveQuiz({
      ...activeQuiz,
      correct_count: null,
      quiz_data: resetQuestions,
    });
    setQuizAnswers({});
    setQuizResult(null);
  };

  const handleBackToList = () => {
    setActiveQuiz(null);
    setQuizAnswers({});
    setQuizResult(null);
    setActiveQuestionPage(0);
  };

  return (
    <View style={styles.savedPanel}>
      <View style={styles.savedPanelHeader}>
        <View style={styles.savedPanelTitleGroup}>
          <Text style={styles.contentTitle}>퀴즈</Text>
          <Text style={styles.contentSubtitle}>{sessionTitle}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {activeQuiz ? (
            <Pressable onPress={handleBackToList} style={styles.savedRefreshButton}>
              <MaterialIcons name="arrow-back" size={20} color="#303746" />
              <Text style={styles.savedRefreshText}>목록으로</Text>
            </Pressable>
          ) : null}
          <Pressable
            disabled={quizListStatus === 'loading'}
            onPress={loadQuizList}
            style={[styles.savedRefreshButton, quizListStatus === 'loading' && styles.savedRefreshButtonDisabled]}>
            {quizListStatus === 'loading' ? (
              <ActivityIndicator color="#636A78" size="small" />
            ) : (
              <MaterialIcons name="refresh" size={20} color="#303746" />
            )}
            <Text style={styles.savedRefreshText}>새로고침</Text>
          </Pressable>
        </View>
      </View>

      {quizError ? (
        <View style={styles.savedErrorBanner}>
          <MaterialIcons name="error-outline" size={18} color="#B42318" />
          <Text style={styles.savedErrorText}>{quizError}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.quizScrollContainer}>
        {quizListStatus === 'loading' && !quizList.length ? (
          <View style={styles.savedEmptyState}>
            <ActivityIndicator color="#8E929A" size="small" />
            <Text style={styles.savedEmptyTitle}>저장된 퀴즈를 불러오는 중입니다.</Text>
          </View>
        ) : !activeQuiz ? (
          quizList.length > 0 ? (
            <View style={styles.quizListContainer}>
              {quizList.map((quiz) => {
                const totalQuestions = getQuizTotalQuestions(quiz);
                const correctCount = typeof quiz.correct_count === 'number' ? quiz.correct_count : null;

                return (
                  <View key={quiz.quiz_id} style={styles.quizListCard}>
                    <View style={styles.quizListCardIcon}>
                      {loadingQuizId === quiz.quiz_id ? (
                        <ActivityIndicator color="#636A78" size="small" />
                      ) : (
                        <MaterialIcons name="assignment" size={20} color="#475569" />
                      )}
                    </View>
                    <View style={styles.quizListCardContent}>
                      <Text numberOfLines={1} style={styles.quizListCardTitle}>
                        {quiz.source_title || '저장된 퀴즈'}
                      </Text>
                      <Text numberOfLines={1} style={styles.quizListCardMeta}>
                        {getQuizListTypeLabel(quiz)} · {formatSavedDate(quiz.created_at)} · {correctCount === null ? '미응시' : `${correctCount}/${totalQuestions} 정답`}
                      </Text>
                    </View>
                    <View style={styles.quizListCardActions}>
                      <Pressable 
                        disabled={loadingQuizId === quiz.quiz_id}
                        onPress={() => loadQuizDetail(quiz.quiz_id)} 
                        style={styles.quizListCardButton}>
                        <MaterialIcons name="play-arrow" size={18} color="#475569" />
                        <Text style={styles.quizListCardButtonText}>
                          {correctCount === null ? '풀기' : '다시 보기'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.savedEmptyState}>
              <MaterialIcons name="quiz" size={31} color="#A6ADB8" />
              <Text style={styles.savedEmptyTitle}>저장된 퀴즈가 없습니다.</Text>
              <Text style={styles.savedEmptyText}>웹에서 생성되어 DB에 저장된 퀴즈가 이곳에 표시됩니다.</Text>
            </View>
          )
        ) : quizDetailStatus === 'loading' ? (
          <View style={styles.savedEmptyState}>
            <ActivityIndicator color="#8E929A" size="small" />
            <Text style={styles.savedEmptyTitle}>퀴즈 문항을 불러오는 중입니다.</Text>
          </View>
        ) : currentQuestion ? (
          <View style={styles.quizDetailContainer}>
            <View style={styles.quizDetailHeaderBox}>
              <Text style={styles.quizDetailHeaderScore}>
                {quizResult 
                  ? `${Math.round(quizResult.score)}점 ` 
                  : '퀴즈 진행 중 '}
                <Text style={styles.quizDetailHeaderScoreSub}>
                  {quizResult 
                    ? `${quizResult.correctCount} / ${quizResult.totalQuestions} 정답` 
                    : `${answeredQuestionCount} / ${questions.length} 응답`}
                </Text>
              </Text>
              {quizResult ? (
                <Pressable onPress={resetQuizAttempt} style={styles.quizDetailHeaderButton}>
                  <Text style={styles.quizDetailHeaderButtonText}>다시 풀기</Text>
                </Pressable>
              ) : null}
            </View>

            <Text style={styles.quizDetailQuestionTitle}>
              {activeQuestionPage + 1}. {currentQuestion.question || '문항 내용이 없습니다.'}
            </Text>

            <View style={styles.quizDetailOptions}>
              {(currentQuestion.options ?? []).map((option, index) => {
                const isSelected = currentAnswer === option;
                const isCorrectOption = quizResult && option === currentQuestion.correct_answer;
                const isWrongSelected = quizResult && isSelected && option !== currentQuestion.correct_answer;

                return (
                  <Pressable
                    key={`${currentQuestionKey}-${option}`}
                    disabled={Boolean(quizResult)}
                    onPress={() => setQuizAnswer(currentQuestion, activeQuestionPage, option)}
                    style={[
                      styles.quizDetailOptionButton,
                      isSelected && !quizResult && styles.quizDetailOptionButtonSelected,
                      isCorrectOption && styles.quizDetailOptionButtonCorrect,
                      isWrongSelected && styles.quizDetailOptionButtonWrong,
                    ]}>
                    <Text
                      style={[
                        styles.quizDetailOptionText,
                        isSelected && !quizResult && styles.quizDetailOptionTextSelected,
                        isCorrectOption && styles.quizDetailOptionTextCorrect,
                        isWrongSelected && styles.quizDetailOptionTextWrong,
                      ]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {quizResult ? (
              <View style={styles.quizDetailExplanation}>
                {currentAnswer === currentQuestion.correct_answer ? (
                  <View style={styles.quizDetailExplanationHeader}>
                    <MaterialIcons name="check-circle" size={20} color="#16A34A" />
                    <Text style={styles.quizDetailExplanationCorrectText}>정답입니다</Text>
                  </View>
                ) : (
                  <View style={styles.quizDetailExplanationHeader}>
                    <MaterialIcons name="cancel" size={20} color="#DC2626" />
                    <Text style={styles.quizDetailExplanationWrongText}>오답입니다</Text>
                  </View>
                )}
                <Text style={styles.quizDetailExplanationBody}>
                  <Text style={{ fontFamily: FontFamily.extraBold }}>정답: {currentQuestion.correct_answer}</Text>
                  {'\n\n'}
                  {currentQuestion.explanation || '저장된 해설이 없습니다.'}
                </Text>
              </View>
            ) : null}

            <View style={styles.quizDetailFooter}>
              <View style={styles.quizDetailFooterBadge}>
                <Text style={styles.quizDetailFooterBadgeText}>{answeredQuestionCount} / {questions.length} 응답</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {activeQuestionPage > 0 ? (
                  <Pressable
                    onPress={() => setActiveQuestionPage((page) => Math.max(0, page - 1))}
                    style={styles.quizDetailFooterNavButton}>
                    <Text style={styles.quizDetailFooterNavButtonText}>이전으로</Text>
                  </Pressable>
                ) : null}
                
                {activeQuestionPage < questions.length - 1 ? (
                  <Pressable
                    onPress={() => setActiveQuestionPage((page) => Math.min(questions.length - 1, page + 1))}
                    style={styles.quizDetailFooterNavButton}>
                    <Text style={styles.quizDetailFooterNavButtonText}>다음으로</Text>
                    <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
                  </Pressable>
                ) : !quizResult ? (
                  <Pressable
                    disabled={!canSubmitQuiz}
                    onPress={submitAnswers}
                    style={[styles.quizDetailFooterNavButton, !canSubmitQuiz && { opacity: 0.5 }]}>
                    {quizDetailStatus === 'submitting' ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.quizDetailFooterNavButtonText}>제출</Text>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </View>

          </View>
        ) : (
          <View style={styles.savedEmptyState}>
            <MaterialIcons name="quiz" size={31} color="#A6ADB8" />
            <Text style={styles.savedEmptyTitle}>퀴즈 정보가 없습니다.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function getStrokeWidthKey(tool: DrawTool): StrokeWidthKey {
  if (tool.mode === 'eraser') {
    return 'eraser';
  }

  return tool.type;
}

function normalizeDrawTool(tool: DrawTool, strokeWidths: StrokeWidths): DrawTool {
  return {
    ...tool,
    width: strokeWidths[getStrokeWidthKey(tool)],
  };
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050506',
  },
  workspacePage: {
    backgroundColor: '#050506',
    flex: 1,
    flexDirection: 'row',
    position: 'relative',
  },
  unifiedCard: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
  },
  scriptPane: {
    backgroundColor: '#FFFFFF',
  },
  scriptHeader: {
    alignItems: 'center',
    borderBottomColor: '#ECEEF2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 62,
    paddingLeft: 5,
    paddingRight: 5,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 11,
    height: 40,
    justifyContent: 'center',
    width: 28,
  },
  headerIconButtonHover: {
    backgroundColor: '#F1F2F4',
  },
  fileTitle: {
    color: '#1D1D1F',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 15,
    fontWeight: 'normal',
    marginLeft: 11,
  },
  recordButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    minWidth: 82,
    paddingHorizontal: 13,
  },
  recordButtonDisabled: {
    opacity: 0.58,
  },
  recordButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.bold,
    fontSize: 11,
    fontWeight: 'normal',
  },
  recordingControl: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    minWidth: 82,
  },
  recordingVoiceDots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    height: 20,
    paddingHorizontal: 4,
  },
  recordingVoiceDotsPaused: {
    opacity: 0.42,
  },
  recordingVoiceDot: {
    backgroundColor: '#1D1D1F',
    borderRadius: 2,
    height: 16,
    width: 3,
  },
  recordingTime: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 12,
    fontWeight: 'normal',
  },
  recordingIconButton: {
    alignItems: 'center',
    backgroundColor: '#E5E5EA',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  recordingIconButtonPaused: {
    backgroundColor: '#FFF0F1',
  },
  recordingPauseBars: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  recordingPauseBar: {
    backgroundColor: '#5F6472',
    borderRadius: 2,
    height: 14,
    width: 4,
  },
  recordingPlayTriangle: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 7,
    borderLeftColor: '#EF4444',
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderTopWidth: 7,
    height: 0,
    marginLeft: 2,
    width: 0,
  },
  recordStopButton: {
    minWidth: 48,
    paddingHorizontal: 12,
  },
  scriptToolbar: {
    alignItems: 'center',
    borderBottomColor: '#ECEEF2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 40,
    justifyContent: 'space-between',
    paddingLeft: 22,
    paddingRight: 24,
  },
  scriptTabWrap: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    position: 'relative',
  },
  scriptTabText: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 15,
    fontWeight: 'normal',
  },
  scriptTabLine: {
    backgroundColor: '#111318',
    bottom: 0,
    height: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  searchButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emptyScriptState: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingBottom: 62,
  },
  emptyTranscriptAnimation: {
    opacity: 0.86,
  },
  emptyScriptText: {
    color: '#8E929A',
    fontFamily: FontFamily.medium,
    fontSize: 13,
    fontWeight: 'normal',
  },
  transcriptionPreparingState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 42,
    paddingHorizontal: 22,
  },
  transcriptionPreparingAnimation: {
    height: 168,
    marginBottom: -14,
    width: 168,
  },
  transcriptionPreparingTitle: {
    color: '#1F2937',
    fontFamily: FontFamily.black,
    fontSize: 14,
    fontWeight: 'normal',
    marginTop: 2,
    textAlign: 'center',
  },
  transcriptionPreparingDescription: {
    color: '#94A3B8',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    marginTop: 7,
    textAlign: 'center',
  },
  transcriptionFailedText: {
    color: '#EF4444',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    maxWidth: 260,
    textAlign: 'center',
  },
  transcriptionStartButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    marginTop: 2,
    minWidth: 116,
    paddingHorizontal: 18,
  },
  transcriptionStartButtonDisabled: {
    opacity: 0.55,
  },
  transcriptionStartButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  transcriptList: {
    gap: 34,
    paddingBottom: 96,
    paddingLeft: 5,
    paddingRight: 18,
    paddingTop: 18,
  },
  transcriptItem: {
    gap: 10,
    marginTop: 0,
    width: '100%',
  },
  transcriptTimeButton: {
    alignItems: 'flex-start',
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  transcriptTime: {
    color: '#9AA1AD',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    lineHeight: 16,
  },
  transcriptTimeActive: {
    color: '#2F80ED',
  },
  transcriptBubble: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    overflow: 'visible',
    width: '100%',
  },
  transcriptTextBlock: {
    minWidth: 0,
    width: '100%',
  },
  transcriptText: {
    color: '#444B55',
    fontFamily: FontFamily.medium,
    fontSize: 16,
    fontWeight: 'normal',
    letterSpacing: 0,
    lineHeight: 30,
  },
  transcriptTextActive: {
    backgroundColor: '#E5F0FF',
    borderRadius: 6,
    color: '#111827',
    overflow: 'hidden',
  },
  transcriptWordText: {
    color: '#444B55',
    textDecorationLine: 'none',
  },
  transcriptWordTextActive: {
    color: '#111827',
  },
  wordInsightCard: {
    backgroundColor: '#F8FBFF',
    borderBottomColor: '#E4ECF8',
    borderBottomWidth: 1,
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  wordInsightHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  wordInsightIcon: {
    alignItems: 'center',
    backgroundColor: '#DBEAFE',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  wordInsightTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  wordInsightWord: {
    color: '#0F172A',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  wordInsightSource: {
    color: '#64748B',
    fontFamily: FontFamily.bold,
    fontSize: 11,
    fontWeight: 'normal',
    marginTop: 1,
  },
  wordInsightCloseButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  wordInsightBody: {
    paddingLeft: 37,
  },
  wordInsightLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  wordInsightText: {
    color: '#334155',
    fontFamily: FontFamily.medium,
    fontSize: 13,
    fontWeight: 'normal',
    lineHeight: 19,
  },
  wordInsightErrorText: {
    color: '#DC2626',
  },
  wordInsightAskButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#2563EB',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 32,
    marginLeft: 37,
    paddingHorizontal: 11,
  },
  wordInsightAskText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  scriptResizeHandle: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    width: 12,
  },
  scriptResizeLine: {
    backgroundColor: '#E2E4EA',
    borderRadius: 1,
    height: '100%',
    width: 2,
  },
  contentPane: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    minWidth: 0,
    position: 'relative',
  },
  sourceMenuDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  tabHeader: {
    alignItems: 'center',
    borderBottomColor: '#ECEEF2',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 62,
    paddingLeft: 38,
    paddingRight: 18,
    zIndex: 40,
  },
  topTabsGroup: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 30,
  },
  pageStepControls: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 2,
    marginRight: 16,
  },
  pageStepButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pageFloatingControls: {
    alignItems: 'center',
    bottom: 24,
    flexDirection: 'row',
    gap: 9,
    left: 3,
    position: 'absolute',
    zIndex: 35,
  },
  pageFloatingButton: {
    alignItems: 'center',
    backgroundColor: '#303746',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    shadowColor: '#101828',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    width: 40,
  },
  topTab: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    position: 'relative',
  },
  topTabText: {
    color: '#7D8189',
    fontFamily: FontFamily.extraBold,
    fontSize: 16,
    fontWeight: 'normal',
  },
  topTabTextActive: {
    fontFamily: FontFamily.black,
    color: '#111318',
  },
  topTabLine: {
    backgroundColor: '#1D1D1F',
    bottom: 0,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginLeft: 'auto',
  },
  sourceMenuAnchor: {
    position: 'relative',
  },
  sourceHeaderButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  sourceFilesPopover: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8F1',
    borderRadius: 18,
    borderWidth: 1,
    gap: 11,
    padding: 14,
    position: 'absolute',
    right: 0,
    shadowColor: '#101828',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 26,
    top: 48,
    width: 346,
    zIndex: 80,
  },
  sourceFilesHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sourceFilesTitle: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  sourceFilesCount: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    color: '#64748B',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
    minWidth: 34,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    textAlign: 'center',
  },
  sourceFilesScroll: {
    maxHeight: 326,
  },
  sourceTree: {
    gap: 8,
  },
  sourceSelectAllRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 7,
    paddingHorizontal: 2,
    paddingTop: 1,
  },
  sourceSelectAllText: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sourceFolderShell: {
    gap: 8,
  },
  sourceFolderHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    minHeight: 32,
    paddingBottom: 4,
  },
  sourceFolderTitle: {
    color: '#1D1D1F',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sourceFolderCount: {
    color: '#8D96A3',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
  },
  sourceFileGroup: {
    borderRadius: 12,
  },
  sourceFileGroupActive: {
    backgroundColor: '#F8FAFC',
  },
  sourceFileRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 9,
    minHeight: 34,
    paddingHorizontal: 3,
    paddingVertical: 5,
  },
  sourceFileGroupTitle: {
    color: '#657181',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sourceFileGroupCount: {
    color: '#8D96A3',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
  },
  sourceFileNestedList: {
    borderLeftColor: '#E5EAF0',
    borderLeftWidth: 1,
    marginLeft: 12,
    paddingLeft: 11,
  },
  sourceCheckRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 42,
    paddingVertical: 5,
  },
  sourceNestedIconButton: {
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  sourceNestedAudioIconButton: {
    backgroundColor: '#FFF2CF',
  },
  sourceNestedOpenButton: {
    borderRadius: 10,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  sourceNestedOpenButtonActive: {
    backgroundColor: '#EFF6FF',
  },
  sourceNestedName: {
    color: '#2B3038',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sourceNestedNameActive: {
    color: '#1F78FF',
  },
  sourceNestedMeta: {
    color: '#9299A4',
    fontFamily: FontFamily.bold,
    fontSize: 10,
    fontWeight: 'normal',
    marginTop: 2,
  },
  sourceTranscriptionAction: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 999,
    height: 28,
    justifyContent: 'center',
    minWidth: 66,
    paddingHorizontal: 10,
  },
  sourceTranscriptionActionFailed: {
    backgroundColor: '#EF4444',
  },
  sourceTranscriptionActionText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 10,
    fontWeight: 'normal',
  },
  sourceTranscriptionProcessing: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minWidth: 58,
  },
  sourceTranscriptionProcessingText: {
    color: '#64748B',
    fontFamily: FontFamily.bold,
    fontSize: 10,
    fontWeight: 'normal',
  },
  sourceCheckboxButton: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  sourceCheckbox: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  sourceCheckboxChecked: {
    backgroundColor: '#DCE3EC',
  },
  audioPlaybackBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderTopColor: 'rgba(226, 224, 232, 0.92)',
    borderTopWidth: 1,
    bottom: 0,
    height: 96,
    left: 0,
    paddingBottom: 8,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 0,
    shadowColor: '#101828',
    shadowOffset: { height: -10, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    zIndex: 90,
  },
  audioPlaybackSourceHeader: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    left: 18,
    position: 'absolute',
    right: 18,
    top: 8,
  },
  audioPlaybackTitle: {
    color: '#15161A',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    maxWidth: 420,
    paddingHorizontal: 44,
    textAlign: 'center',
  },
  audioPlaybackProgressTrack: {
    backgroundColor: 'rgba(230, 234, 241, 0.96)',
    borderRadius: 999,
    flex: 1,
    height: 8,
    justifyContent: 'center',
  },
  audioPlaybackProgressFill: {
    backgroundColor: '#2F7DF6',
    borderRadius: 999,
    height: '100%',
  },
  audioPlaybackProgressThumb: {
    backgroundColor: '#2F7DF6',
    borderRadius: 999,
    height: 18,
    marginLeft: -4,
    position: 'absolute',
    width: 8,
  },
  audioPlaybackTrackRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    height: 30,
    left: 0,
    paddingHorizontal: 18,
    position: 'absolute',
    right: 0,
    top: 38,
  },
  audioPlaybackActions: {
    alignItems: 'center',
    bottom: 2,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  audioPlaybackTime: {
    color: '#8D93A1',
    fontFamily: FontFamily.extraBold,
    fontSize: 10,
    fontWeight: 'normal',
    paddingTop: 14,
    width: 54,
  },
  audioPlaybackActionButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  audioPlaybackPlayButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  audioPlaybackSpeed: {
    color: '#15161A',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
    minWidth: 30,
    textAlign: 'center',
  },
  audioPlaybackCloseButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(239, 242, 247, 0.96)',
    borderRadius: 13,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 1,
    width: 26,
  },
  audioPlaybackError: {
    color: '#EF4444',
    fontFamily: FontFamily.bold,
    fontSize: 10,
    fontWeight: 'normal',
    left: 18,
    position: 'absolute',
    right: 18,
    textAlign: 'center',
    top: 27,
  },
  sourceFileEmptyLine: {
    borderLeftColor: '#E5EAF0',
    borderLeftWidth: 1,
    marginLeft: 12,
    paddingLeft: 11,
    paddingVertical: 7,
  },
  sourceFileEmptyState: {
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    minHeight: 92,
    paddingHorizontal: 12,
  },
  sourceFileEmptyText: {
    color: '#8E929A',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    textAlign: 'center',
  },
  sourceAddButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    justifyContent: 'center',
    width: '100%',
  },
  sourceAddButtonActive: {
    backgroundColor: '#2F333A',
  },
  sourceAddButtonGroup: {
    position: 'relative',
  },
  sourceAddButtonDisabled: {
    opacity: 0.58,
  },
  sourceAddButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sourceAddChoiceMenu: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8F1',
    borderRadius: 14,
    borderWidth: 1,
    bottom: 52,
    gap: 4,
    left: 0,
    padding: 7,
    position: 'absolute',
    right: 0,
    shadowColor: '#101828',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    zIndex: 90,
  },
  sourceAddChoiceRow: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  sourceAddChoiceRowDisabled: {
    opacity: 0.48,
  },
  sourceAddChoiceText: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  aiHeaderToggle: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  aiPanelIconFrame: {
    alignItems: 'center',
    borderColor: '#1D1D1F',
    borderRadius: 6,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    position: 'relative',
    width: 24,
  },
  aiPanelIconBar: {
    backgroundColor: '#1D1D1F',
    borderRadius: 1,
    height: 12,
    left: 5,
    position: 'absolute',
    width: 2,
  },
  aiPanelIconChevron: {
    borderRightColor: '#1D1D1F',
    borderRightWidth: 2,
    borderTopColor: '#1D1D1F',
    borderTopWidth: 2,
    height: 8,
    marginLeft: 4,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  contentScroll: {
    paddingBottom: 60,
    paddingHorizontal: 38,
    paddingTop: 24,
  },
  materialsContent: {
    alignSelf: 'center',
    maxWidth: 980,
    width: '100%',
  },
  contentTitle: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 32,
    fontWeight: 'normal',
    lineHeight: 40,
  },
  contentSubtitle: {
    color: '#8E8E93',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
    marginTop: 7,
  },
  sessionInfoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  sessionInfoText: {
    color: '#8E929A',
    flexShrink: 1,
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  sessionErrorText: {
    color: '#D9480F',
  },
  addMaterialCard: {
    alignItems: 'center',
    backgroundColor: '#FBFCFF',
    borderColor: '#CBD6E4',
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    flexDirection: 'row',
    height: 106,
    marginTop: 30,
    paddingHorizontal: 30,
    position: 'relative',
    width: '100%',
  },
  addMaterialCardUploading: {
    backgroundColor: '#F8FBFF',
    borderColor: '#BFD4F8',
    borderStyle: 'solid',
  },
  addMaterialUploadAnimation: {
    height: 58,
    width: 58,
  },
  addMaterialUploadCopy: {
    flex: 1,
    marginLeft: 14,
  },
  addMaterialUploadTitle: {
    color: '#1D2330',
    fontFamily: FontFamily.extraBold,
    fontSize: 17,
    fontWeight: 'normal',
  },
  addMaterialUploadDescription: {
    color: '#8E929A',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    marginTop: 4,
  },
  addMaterialText: {
    color: '#1D2330',
    fontFamily: FontFamily.extraBold,
    fontSize: 17,
    fontWeight: 'normal',
    marginLeft: 22,
  },
  addMaterialIcon: {
    marginLeft: 'auto',
  },
  pdfContentContainer: {
    flex: 1,
    paddingBottom: 9,
    paddingHorizontal: 23,
    paddingTop: 5,
  },
  pdfViewerContent: {
    flex: 1,
    position: 'relative',
    width: '100%',
  },
  materialUploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    justifyContent: 'center',
    zIndex: 22,
  },
  materialUploadStatusCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 24,
    shadowColor: '#101828',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 32,
    width: 260,
  },
  materialUploadAnimation: {
    height: 150,
    width: 150,
  },
  materialUploadTitle: {
    color: '#1D2330',
    fontFamily: FontFamily.extraBold,
    fontSize: 18,
    fontWeight: 'normal',
    marginTop: -4,
  },
  materialUploadDescription: {
    color: '#8E929A',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    marginTop: 7,
    textAlign: 'center',
  },
  pdfWebView: {
    backgroundColor: '#FFFFFF',
    flex: 1,
  },
  pdfPopoverDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
  },
  pdfInlineToolBarDock: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 5,
    zIndex: 18,
  },
  pdfInlineToolBar: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    minWidth: 340,
    paddingHorizontal: 8,
    shadowColor: '#101828',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    zIndex: 18,
  },
  pdfPaletteDivider: {
    backgroundColor: '#E5E7EB',
    height: 20,
    width: 1,
  },
  pdfFloatingControls: {
    alignItems: 'flex-end',
    bottom: 24,
    gap: 10,
    position: 'absolute',
    right: 4,
    zIndex: 20,
  },
  pdfFloatingButton: {
    alignItems: 'center',
    backgroundColor: '#303746',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    shadowColor: '#101828',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    width: 40,
  },
  pdfFloatingButtonActive: {
    backgroundColor: '#1F78FF',
  },
  pdfPenPalette: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 21,
    borderWidth: 1,
    gap: 9,
    padding: 8,
    shadowColor: '#101828',
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    width: 168,
  },
  pdfPaletteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  pdfPaletteIconButton: {
    alignItems: 'center',
    backgroundColor: '#F4F6F9',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  pdfPaletteOptionActive: {
    backgroundColor: '#1F78FF',
  },
  pdfColorSwatch: {
    borderColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    shadowColor: '#101828',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    width: 16,
  },
  pdfColorSwatchActive: {
    borderColor: '#1D1D1F',
    transform: [{ scale: 1.08 }],
  },
  pdfColorPickerPopover: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    padding: 8,
    position: 'absolute',
    right: 0,
    top: 42,
    width: 148,
    zIndex: 24,
  },
  pdfColorPickerSwatch: {
    borderColor: '#FFFFFF',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    width: 18,
  },
  pdfColorPickerSwatchActive: {
    borderColor: '#1D1D1F',
  },
  pdfStrokeStepRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  pdfStrokeStepGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  pdfStrokeStepButton: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 10,
    height: 22,
    justifyContent: 'center',
    width: 20,
  },
  pdfStrokeStepButtonActive: {
    backgroundColor: '#52535B',
  },
  pdfStrokeStepLine: {
    backgroundColor: '#303746',
    borderRadius: 999,
    width: 13,
  },
  pdfColorPickerButton: {
    alignItems: 'center',
    backgroundColor: '#F4F6F9',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 2,
    height: 24,
    justifyContent: 'center',
    width: 34,
  },
  pdfColorPickerButtonActive: {
    backgroundColor: '#1F78FF',
  },
  pdfColorPickerButtonSwatch: {
    borderColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    height: 12,
    width: 12,
  },
  pdfMaterialPopover: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E8F1',
    borderRadius: 18,
    borderWidth: 1,
    bottom: 24,
    gap: 8,
    padding: 12,
    position: 'absolute',
    right: 52,
    shadowColor: '#101828',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    width: 260,
    zIndex: 30,
  },
  pdfMaterialPopoverTitle: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  pdfMaterialItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 9,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  pdfMaterialItemActive: {
    backgroundColor: '#EEF5FF',
  },
  pdfMaterialName: {
    color: '#6F7682',
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  pdfMaterialNameActive: {
    color: '#1F78FF',
    fontFamily: FontFamily.extraBold,
  },
  pdfPickerButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    height: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  pdfPickerButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  savedPanel: {
    alignSelf: 'center',
    maxWidth: 980,
    width: '100%',
  },
  savedPanelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
  },
  savedPanelTitleGroup: {
    flex: 1,
  },
  savedRefreshButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE3EC',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 42,
    paddingHorizontal: 14,
  },
  savedRefreshButtonDisabled: {
    opacity: 0.58,
  },
  savedRefreshText: {
    color: '#303746',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  savedErrorBanner: {
    alignItems: 'center',
    backgroundColor: '#FFF4F3',
    borderColor: '#FAD7D3',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  savedErrorText: {
    color: '#B42318',
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  savedFilterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 22,
  },
  savedFilterButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DDE3EC',
    borderRadius: 15,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: 13,
  },
  savedFilterButtonActive: {
    backgroundColor: '#111318',
    borderColor: '#111318',
  },
  savedFilterText: {
    color: '#6B7280',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 32,
  },
  savedFilterTextActive: {
    color: '#FFFFFF',
  },
  savedSplitLayout: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 18,
    marginTop: 18,
    width: '100%',
  },
  savedListColumn: {
    gap: 10,
    width: 310,
  },
  savedListItem: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7F0',
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 13,
  },
  savedListItemActive: {
    backgroundColor: '#F7FAFF',
    borderColor: '#B9CCE8',
  },
  savedListItemHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  savedKindIcon: {
    alignItems: 'center',
    backgroundColor: '#EEF1F5',
    borderRadius: 12,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  savedKindIconActive: {
    backgroundColor: '#303746',
  },
  summaryKindIcon_material: {
    backgroundColor: '#EEF4FF',
  },
  summaryKindIcon_recording: {
    backgroundColor: '#EEF8F1',
  },
  summaryKindIcon_session: {
    backgroundColor: '#F2F3F7',
  },
  summaryKindIcon_speaker: {
    backgroundColor: '#FFF6E7',
  },
  savedListItemTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  savedListItemTitle: {
    color: '#1D2330',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  savedListItemMeta: {
    color: '#8B93A1',
    fontFamily: FontFamily.bold,
    fontSize: 11,
    fontWeight: 'normal',
    marginTop: 3,
  },
  savedListItemPreview: {
    color: '#596272',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
  },
  savedDetailPane: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7F0',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 430,
    padding: 20,
  },
  savedDetailHeader: {
    alignItems: 'flex-start',
    borderBottomColor: '#EEF2F7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  savedDetailTitle: {
    color: '#1D2330',
    fontFamily: FontFamily.black,
    fontSize: 21,
    fontWeight: 'normal',
    lineHeight: 27,
  },
  savedDetailMeta: {
    color: '#8B93A1',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    marginTop: 5,
  },
  savedDetailPill: {
    alignItems: 'center',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    minHeight: 30,
    paddingHorizontal: 11,
  },
  savedDetailPillText: {
    color: '#596272',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 30,
  },
  savedSummaryBody: {
    gap: 13,
    paddingTop: 18,
  },
  savedSummaryParagraph: {
    color: '#222733',
    fontFamily: FontFamily.bold,
    fontSize: 15,
    fontWeight: 'normal',
    lineHeight: 25,
  },
  savedEmptyState: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E1E7F0',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 260,
    padding: 28,
  },
  savedEmptyTitle: {
    color: '#303746',
    fontFamily: FontFamily.extraBold,
    fontSize: 15,
    fontWeight: 'normal',
  },
  savedEmptyText: {
    color: '#8B93A1',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    textAlign: 'center',
  },
  quizDetailTopBar: {
    alignItems: 'center',
    borderBottomColor: '#EEF2F7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  quizScrollContainer: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 60,
  },
  quizListContainer: {
    gap: 16,
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
  },
  quizListCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    gap: 16,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  quizListCardIcon: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    height: 48,
    width: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quizListCardContent: {
    flex: 1,
    gap: 4,
  },
  quizListCardTitle: {
    color: '#0F172A',
    fontFamily: FontFamily.extraBold,
    fontSize: 16,
    fontWeight: 'normal',
  },
  quizListCardMeta: {
    color: '#64748B',
    fontFamily: FontFamily.bold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  quizListCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  quizListCardButton: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  quizListCardButtonText: {
    color: '#334155',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  quizDetailContainer: {
    maxWidth: 800,
    alignSelf: 'center',
    width: '100%',
    gap: 20,
  },
  quizDetailHeaderBox: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quizDetailHeaderScore: {
    color: '#166534',
    fontFamily: FontFamily.black,
    fontSize: 18,
    fontWeight: 'normal',
  },
  quizDetailHeaderScoreSub: {
    color: '#166534',
    fontFamily: FontFamily.bold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  quizDetailHeaderButton: {
    backgroundColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  quizDetailHeaderButtonText: {
    color: '#334155',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  quizDetailQuestionTitle: {
    color: '#0F172A',
    fontFamily: FontFamily.black,
    fontSize: 16,
    lineHeight: 26,
    marginTop: 4,
    fontWeight: 'normal',
  },
  quizDetailOptions: {
    gap: 12,
  },
  quizDetailOptionButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
  },
  quizDetailOptionButtonSelected: {
    backgroundColor: '#F8FAFC',
    borderColor: '#94A3B8',
    borderWidth: 2,
  },
  quizDetailOptionButtonCorrect: {
    backgroundColor: '#F0FDF4',
    borderColor: '#22C55E',
    borderWidth: 1,
  },
  quizDetailOptionButtonWrong: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
    borderWidth: 1,
  },
  quizDetailOptionText: {
    color: '#0F172A',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 'normal',
  },
  quizDetailOptionTextSelected: {
    color: '#0F172A',
  },
  quizDetailOptionTextCorrect: {
    color: '#166534',
  },
  quizDetailOptionTextWrong: {
    color: '#991B1B',
  },
  quizDetailExplanation: {
    marginTop: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 24,
  },
  quizDetailExplanationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quizDetailExplanationCorrectText: {
    color: '#16A34A',
    fontFamily: FontFamily.black,
    fontSize: 18,
    fontWeight: 'normal',
  },
  quizDetailExplanationWrongText: {
    color: '#DC2626',
    fontFamily: FontFamily.black,
    fontSize: 18,
    fontWeight: 'normal',
  },
  quizDetailExplanationBody: {
    color: '#334155',
    fontFamily: FontFamily.medium,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: 'normal',
  },
  quizDetailFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 40,
  },
  quizDetailFooterBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  quizDetailFooterBadgeText: {
    color: '#334155',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  quizDetailFooterNavButton: {
    backgroundColor: '#64748B',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  quizDetailFooterNavButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 15,
    fontWeight: 'normal',
  },
  aiPanel: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    position: 'relative',
  },
  chatSessionToolbar: {
    alignItems: 'center',
    borderBottomColor: '#EEF2F7',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 12,
  },
  chatSessionToggle: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    minWidth: 0,
    paddingHorizontal: 10,
  },
  chatSessionToggleText: {
    color: '#1E293B',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  chatSessionNewButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 4,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  chatSessionNewText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  chatSessionMenu: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E2E8F0',
    borderRadius: 14,
    borderWidth: 1,
    left: 12,
    maxHeight: 280,
    padding: 8,
    position: 'absolute',
    right: 12,
    shadowColor: '#101828',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    top: 56,
    zIndex: 40,
  },
  chatSessionMenuNew: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 40,
    paddingHorizontal: 10,
  },
  chatSessionMenuNewText: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  chatSessionMenuScroll: {
    maxHeight: 220,
  },
  chatSessionMenuItem: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 8,
  },
  chatSessionMenuItemActive: {
    backgroundColor: '#EEF5FF',
  },
  chatSessionTitleInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C7D2FE',
    borderRadius: 9,
    borderWidth: 1,
    color: '#111827',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    height: 32,
    paddingHorizontal: 9,
  },
  chatSessionTitleButton: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 36,
    minWidth: 0,
  },
  chatSessionTitleText: {
    color: '#334155',
    flex: 1,
    fontFamily: FontFamily.bold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  chatSessionEditButton: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  aiResizeHandle: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    width: 24,
    zIndex: 20,
  },
  aiResizeGrip: {
    backgroundColor: '#D1D1D6',
    borderRadius: 2,
    height: 42,
    width: 3,
  },
  chatRowUser: {
    alignItems: 'flex-end',
  },
  chatBubbleUser: {
    backgroundColor: '#2A2D3A',
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxWidth: '75%',
  },
  chatTextUser: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  chatRowAi: {
    alignItems: 'flex-start',
    paddingRight: 8,
  },
  chatTextAi: {
    color: '#1E293B',
    fontSize: 15,
    lineHeight: 26,
  },
  aiStreamWait: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.08)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  aiStreamStatusText: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: 'bold',
  },
  aiCenter: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '36%',
  },
  chatbotAnimation: {
    height: 112,
    width: 112,
  },
  aiPrompt: {
    color: '#1D1F24',
    fontFamily: FontFamily.bold,
    fontSize: 18,
    fontWeight: 'normal',
    marginTop: 24,
  },
  aiInputBox: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#D6DEE9',
    borderRadius: 25,
    borderWidth: 1.5,
    bottom: 28,
    flexDirection: 'row',
    gap: 10,
    height: 58,
    left: 24,
    paddingLeft: 18,
    paddingRight: 9,
    position: 'absolute',
    right: 24,
  },
  aiInput: {
    color: '#1D1D1F',
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    fontWeight: 'normal',
    height: 42,
    padding: 0,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#D4D6DB',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sendButtonActive: {
    backgroundColor: '#1F78FF',
  },
});
