import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, useFocusEffect } from 'expo-router';
import LottieView from 'lottie-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

import { FontFamily } from '@/constants/fonts';
import CitationInlineText, {
  findHighlightRanges,
  normalizeCitations,
  type NormalizedCitation,
} from '@/components/workspace/CitationInlineText';
import { useChatSessions } from '@/hooks/use-chat-sessions';
import { startChatStream } from '@/lib/chat-api';
import { getWorkspaceTree, type WorkspaceFileNode, type WorkspaceFolderNode, type WorkspaceNode } from '@/lib/workspace-api';

type RecentFile = {
  color: string;
  date: string;
  id: string;
  sourceCount: number;
  tag: string;
  title: string;
};

const verticalGridLines = Array.from({ length: 28 }, (_, index) => index + 1);
const horizontalGridLines = Array.from({ length: 18 }, (_, index) => index + 1);

export default function HomeScreen() {
  const [input, setInput] = useState('');
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [isRecentLoading, setIsRecentLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isReferencePanelOpen, setIsReferencePanelOpen] = useState(false);
  const [referenceCitations, setReferenceCitations] = useState<NormalizedCitation[]>([]);
  const [selectedReferenceCitationId, setSelectedReferenceCitationId] = useState('');
  const [expandedReferenceMessages, setExpandedReferenceMessages] = useState<Set<number>>(() => new Set());
  const [hasSubmittedHomeQuestion, setHasSubmittedHomeQuestion] = useState(false);
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const chatScrollRef = useRef<ScrollView>(null);
  const homeChatStartIndexRef = useRef(0);
  const stopChatStreamRef = useRef<(() => void) | null>(null);
  const {
    appendMessages,
    messages,
    setMessages,
  } = useChatSessions();

  const layout = useMemo(() => {
    const railWidth = clamp(width * 0.052, 72, 88);
    const shellGap = clamp(width * 0.014, 16, 24);
    const canvasRadius = clamp(width * 0.024, 28, 42);
    const contentWidth = clamp(width * 0.58, 660, 760);
    const welcomeWidth = clamp(width * 0.42, 500, 760);
    const composerHeight = clamp(height * 0.078, 76, 92);
    const homeTopPadding = clamp(height * 0.06, 44, 76);
    const welcomeBottomGap = clamp(height * 0.04, 28, 42);
    const recentTopGap = clamp(height * 0.045, 28, 42);
    const recentCardHeight = clamp(height * 0.14, 104, 118);
    const referencePanelWidth = clamp(width * 0.26, 340, 430);

    return {
      railWidth,
      shellGap,
      canvasRadius,
      contentWidth,
      welcomeWidth,
      composerHeight,
      homeTopPadding,
      recentCardHeight,
      recentTopGap,
      referencePanelWidth,
      welcomeBottomGap,
    };
  }, [height, width]);

  const visibleMessages = hasSubmittedHomeQuestion
    ? messages.slice(homeChatStartIndexRef.current)
    : [];
  const latestCitations = useMemo(() => {
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      if (message.role === 'ai' && message.citations?.length) {
        return normalizeCitations(message.citations);
      }
    }

    return [];
  }, [visibleMessages]);
  const visibleReferenceCitations = referenceCitations.length ? referenceCitations : latestCitations;
  const selectedReferenceCitation =
    visibleReferenceCitations.find((citation) => citation.id === selectedReferenceCitationId) ??
    visibleReferenceCitations[0] ??
    null;
  const isChatMode = hasSubmittedHomeQuestion;
  const isReferenceSidebarVisible = isChatMode && isReferencePanelOpen && Boolean(selectedReferenceCitation);

  const openReferencesForCitations = useCallback((citations: unknown[] = []) => {
    const normalized = normalizeCitations(citations as Record<string, unknown>[]);
    if (!normalized.length) return;
    setReferenceCitations(normalized);
    setSelectedReferenceCitationId((current) => (
      current && normalized.some((citation) => citation.id === current)
        ? current
        : normalized[0].id
    ));
    setIsReferencePanelOpen(true);
  }, []);

  const handleCitationClick = useCallback((raw: Record<string, unknown>) => {
    openReferencesForCitations([raw]);
  }, [openReferencesForCitations]);

  const handleSourceView = useCallback((citation: NormalizedCitation) => {
    const raw = citation.raw || {};
    const targetSessionId = String(raw.session_id || raw.sessionId || '');

    router.push({
      pathname: '/workspace',
      params: {
        citation: JSON.stringify(raw),
        ...(targetSessionId ? { sessionId: targetSessionId } : {}),
      },
    });
  }, [router]);

  const sendMessage = useCallback(() => {
    const question = input.trim();
    if (!question || isSending) return;

    if (!hasSubmittedHomeQuestion) {
      homeChatStartIndexRef.current = messages.length;
      setExpandedReferenceMessages(new Set());
      setReferenceCitations([]);
      setSelectedReferenceCitationId('');
      setIsReferencePanelOpen(false);
      setHasSubmittedHomeQuestion(true);
    }

    setInput('');
    setIsSending(true);
    appendMessages([
      { role: 'user', text: question },
      { role: 'ai', text: '', phase: 'analyzing', statusText: '질문 분석 중', citations: [] },
    ]);

    stopChatStreamRef.current = startChatStream(
      {
        question,
        is_thinking: false,
        source_filter: null,
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
        },
      },
    )?.abort ?? null;
  }, [appendMessages, hasSubmittedHomeQuestion, input, isSending, messages.length, setMessages]);

  const loadRecentFiles = useCallback(async () => {
    try {
      setIsRecentLoading(true);
      const tree = await getWorkspaceTree();
      setRecentFiles(flattenRecentFiles(tree).slice(0, 3));
    } catch (error) {
      console.warn('Failed to load recent workspace files.', error);
      setRecentFiles([]);
    } finally {
      setIsRecentLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecentFiles();
    }, [loadRecentFiles])
  );

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('globalRefresh', () => {
      loadRecentFiles();
    });
    
    return () => subscription.remove();
  }, [loadRecentFiles]);

  useEffect(() => {
    return () => {
      stopChatStreamRef.current?.();
    };
  }, []);

  const toggleReferenceMessage = (messageIndex: number) => {
    setExpandedReferenceMessages((current) => {
      const next = new Set(current);
      if (next.has(messageIndex)) next.delete(messageIndex);
      else next.add(messageIndex);
      return next;
    });
  };

  const resetHomeView = () => {
    setHasSubmittedHomeQuestion(false);
    setInput('');
    setReferenceCitations([]);
    setSelectedReferenceCitationId('');
    setExpandedReferenceMessages(new Set());
    setIsReferencePanelOpen(false);
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={[styles.frame, { gap: layout.shellGap }]}>
        <View style={[styles.railWrap, { width: layout.railWidth }]}>
          <View style={styles.rail}>
            <View style={styles.railTop}>
              <Pressable onPress={() => {
                resetHomeView();
                DeviceEventEmitter.emit('globalRefresh');
                router.push('/');
              }}>
                <Image
                  source={require('@/assets/groupchat/logo.png')}
                  style={[
                    styles.logo,
                    {
                      width: layout.railWidth * 0.64,
                      height: layout.railWidth * 0.64,
                      borderRadius: layout.railWidth * 0.32,
                    },
                  ]}
                />
              </Pressable>

              <View style={styles.railNav}>
                <RailButton name="add" onPress={() => router.push('/workspace')} />
                <RailButton name="folder-open" onPress={() => router.push('/workfolder')} />
                <RailButton name="calendar-today" onPress={() => router.push('/calendar')} />
              </View>
            </View>
          </View>
        </View>

        <View style={[styles.canvas, { borderRadius: layout.canvasRadius }]}>
          <GridOverlay />



          {isChatMode ? (
            <View style={styles.webChatStage}>
              <ScrollView
                ref={chatScrollRef}
                bounces={false}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                contentContainerStyle={styles.webChatContent}>
                {visibleMessages.map((message, index) => {
                  const normalizedMessageCitations = normalizeCitations(message.citations ?? []);
                  const isExpanded = expandedReferenceMessages.has(index);

                  return (
                    <View
                      key={`${message.role}-${index}`}
                      style={message.role === 'user' ? styles.webChatRowUser : styles.webChatRowAi}>
                      {message.role === 'user' ? (
                        <View style={styles.webQuestionBubble}>
                          <Text style={styles.webQuestionText}>{message.text}</Text>
                        </View>
                      ) : (
                        <View style={styles.webAnswerBlock}>
                          {message.text ? (
                            <CitationInlineText
                              text={message.text}
                              citations={message.citations}
                              enableCitations={false}
                              onCitationClick={handleCitationClick}
                              onSourceView={handleSourceView}
                              style={styles.webAnswerText}
                            />
                          ) : (
                            <View style={styles.webThinkingPill}>
                              <ActivityIndicator color="#42465A" size="small" />
                              <Text style={styles.webThinkingText}>
                                {message.statusText || '답변 준비 중...'}
                              </Text>
                            </View>
                          )}

                          {message.phase && message.phase !== 'done' && message.text ? (
                            <View style={styles.webThinkingPill}>
                              <ActivityIndicator color="#42465A" size="small" />
                              <Text style={styles.webThinkingText}>
                                {message.statusText || '답변 생성 중...'}
                              </Text>
                            </View>
                          ) : null}

                          {message.phase === 'done' && normalizedMessageCitations.length ? (
                            <View style={styles.webEvidenceWrap}>
                              <Pressable
                                onPress={() => {
                                  setReferenceCitations(normalizedMessageCitations);
                                  setSelectedReferenceCitationId(normalizedMessageCitations[0].id);
                                  toggleReferenceMessage(index);
                                }}
                                style={styles.webEvidenceToggle}>
                                <MaterialIcons name="link" size={15} color="#5A714C" />
                                <Text style={styles.webEvidenceToggleText}>
                                  참고한 전사 {normalizedMessageCitations.length}개 보기
                                </Text>
                                <MaterialIcons
                                  name={isExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                                  size={17}
                                  color="#5A714C"
                                />
                              </Pressable>

                              {isExpanded ? (
                                <View style={styles.webEvidenceChipRow}>
                                  {normalizedMessageCitations.map((citation) => (
                                    <Pressable
                                      key={citation.id}
                                      onPress={() => {
                                        setReferenceCitations(normalizedMessageCitations);
                                        setSelectedReferenceCitationId(citation.id);
                                        setIsReferencePanelOpen(true);
                                      }}
                                      style={styles.webEvidenceChip}>
                                      <MaterialIcons name="link" size={13} color="#5A714C" />
                                      <Text numberOfLines={1} style={styles.webEvidenceChipText}>
                                        {formatEvidenceChipLabel(citation)}
                                      </Text>
                                    </Pressable>
                                  ))}
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.webComposerDock}>
                <View style={styles.webComposer}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder="무엇이든 물어보세요..."
                    placeholderTextColor="#A7A7B2"
                    onSubmitEditing={sendMessage}
                    returnKeyType="send"
                    multiline
                    style={styles.webComposerInput}
                  />
                  <View style={styles.webComposerBottomRow}>
                    <MaterialIcons name="attach-file" size={21} color="#8D8F98" />
                    <Pressable
                      disabled={!input.trim() || isSending}
                      onPress={sendMessage}
                      style={[styles.webSendButton, input.trim() && !isSending && styles.webSendButtonActive]}>
                      <MaterialIcons name="arrow-upward" size={21} color="#FFFFFF" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.scrollContent,
                {
                  minHeight: Math.max(height - 8, 640),
                  paddingTop: layout.homeTopPadding + 60,
                },
              ]}>
              <View style={[styles.centerContent, { maxWidth: layout.contentWidth }]}>
                <LottieView
                  autoPlay
                  loop
                  resizeMode="contain"
                  source={require('@/assets/groupchat/animations/welcome.json')}
                  style={[
                    styles.welcomeAnimation,
                    {
                      width: layout.welcomeWidth + 10,
                      height: (layout.welcomeWidth + 10) * 0.36,
                      marginBottom: layout.welcomeBottomGap,
                    },
                  ]}
                />

                <View style={[styles.composer, { height: layout.composerHeight }]}>
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    placeholder="무엇이든 물어보세요..."
                    placeholderTextColor="#A7A7B2"
                    onSubmitEditing={sendMessage}
                    returnKeyType="send"
                    style={styles.composerInput}
                  />

                  <Pressable
                    disabled={!input.trim() || isSending}
                    onPress={sendMessage}
                    style={[styles.sendButton, input.trim() && !isSending && styles.sendButtonActive]}>
                    <MaterialIcons name="arrow-upward" size={23} color="#FFFFFF" />
                  </Pressable>
                </View>

                <View style={[styles.recentSection, { marginTop: layout.recentTopGap }]}>
                  <Text style={styles.sectionTitle}>최근 연 파일</Text>

                  <View style={styles.recentGrid}>
                    {isRecentLoading ? (
                      <View style={[styles.recentStatusCard, { height: layout.recentCardHeight }]}>
                        <ActivityIndicator color="#1D1D1F" />
                      </View>
                    ) : recentFiles.length > 0 ? (
                      recentFiles.map((file) => (
                        <Pressable
                          key={file.id}
                          onPress={() => router.push(`/workspace?sessionId=${encodeURIComponent(file.id)}`)}
                          style={[styles.fileCard, { height: layout.recentCardHeight }]}>
                          <View style={styles.fileCardTop}>
                            <View style={styles.fileIcon}>
                              <MaterialIcons name={file.tag === '회의' ? 'groups' : 'description'} size={18} color="#202329" />
                            </View>
                            <View style={styles.tag}>
                              <Text style={[styles.tagText, { color: file.color }]}>{file.tag}</Text>
                            </View>
                          </View>

                          <Text numberOfLines={1} style={styles.fileTitle}>
                            {file.title}
                          </Text>
                          <Text style={styles.fileDate}>
                            {file.date || '날짜 없음'} · 소스 {file.sourceCount}개
                          </Text>
                        </Pressable>
                      ))
                    ) : (
                      <View style={[styles.recentStatusCard, { height: layout.recentCardHeight }]}>
                        <Text style={styles.recentStatusText}>최근 파일이 없습니다.</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </ScrollView>
          )}
        </View>

        {isReferenceSidebarVisible ? (
          <ReferenceTranscriptSidebar
            citation={selectedReferenceCitation}
            onClose={() => setIsReferencePanelOpen(false)}
            onOpenSource={() => selectedReferenceCitation && handleSourceView(selectedReferenceCitation)}
            width={layout.referencePanelWidth}
          />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ReferenceTranscriptSidebar({
  citation,
  onClose,
  onOpenSource,
  width,
}: {
  citation: NormalizedCitation | null;
  onClose: () => void;
  onOpenSource: () => void;
  width: number;
}) {
  if (!citation) return null;

  return (
    <View style={[styles.webReferenceSidebar, { width }]}>
      <View style={styles.webReferenceHeader}>
        <View style={styles.webReferenceHeaderIcon}>
          <MaterialIcons name={citation.icon} size={17} color="#4F46E5" />
        </View>
        <View style={styles.webReferenceHeaderText}>
          <Text numberOfLines={1} style={styles.webReferenceTitle}>
            {citation.title}
          </Text>
          <Text style={styles.webReferenceTime}>{citation.locationLabel}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.webReferenceCloseButton}>
          <MaterialIcons name="close" size={22} color="#9AA1AD" />
        </Pressable>
      </View>

      <View style={styles.webReferenceSearchRow}>
        <Text style={styles.webReferenceSearchText}>
          {citation.type === 'material' ? '자료 원문' : '전사 내용 스크립트'}
        </Text>
        <MaterialIcons name="search" size={22} color="#9AA1AD" />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.webReferenceScriptContent}>
        <HighlightedTranscript citation={citation} />
      </ScrollView>

      <View style={styles.webReferenceFooter}>
        <Pressable onPress={onOpenSource} style={styles.webReferenceOpenButton}>
          <Text style={styles.webReferenceOpenText}>파일로 이동</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function HighlightedTranscript({ citation }: { citation: NormalizedCitation }) {
  const sourceText = getReferenceBodyText(citation);
  const parts = buildHighlightParts(sourceText, citation.excerpt);

  return (
    <Text style={styles.webReferenceScriptText}>
      {parts.map((part, index) => (
        <Text
          key={`${index}-${part.text.slice(0, 8)}`}
          style={part.isHighlighted ? styles.webReferenceHighlightText : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function RailButton({
  name,
  onPress,
}: {
  name: keyof typeof MaterialIcons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.railButton}>
      <MaterialIcons name={name} size={28} color="#FFFFFF" />
    </Pressable>
  );
}

function GridOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {verticalGridLines.map((line) => (
        <View key={`v-${line}`} style={[styles.gridLineVertical, { left: `${line * 3.6}%` }]} />
      ))}
      {horizontalGridLines.map((line) => (
        <View key={`h-${line}`} style={[styles.gridLineHorizontal, { top: `${line * 5.6}%` }]} />
      ))}
    </View>
  );
}

function flattenRecentFiles(tree: WorkspaceNode[]) {
  const files: RecentFile[] = [];

  const visit = (nodes: WorkspaceNode[] = [], parentFolder?: WorkspaceFolderNode) => {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        visit(node.children ?? [], node);
        return;
      }

      files.push(toRecentFile(node, parentFolder));
    });
  };

  visit(tree);
  return files.sort((a, b) => b.date.localeCompare(a.date, 'ko-KR'));
}

function toRecentFile(node: WorkspaceFileNode, parentFolder?: WorkspaceFolderNode): RecentFile {
  const tag = node.tag || (node.fileKind === 'meeting' ? '회의' : '수업');
  const sourceCount = (node.attachments?.length ?? 0) + (node.recordings?.length ?? 0);

  return {
    color: node.color || (tag === '회의' ? '#2DD4BF' : '#3B82F6'),
    date: node.date || parentFolder?.date || '',
    id: node.id,
    sourceCount,
    tag,
    title: node.name || '새 파일',
  };
}

function formatEvidenceChipLabel(citation: NormalizedCitation) {
  return `${citation.title} > ${citation.locationLabel}`;
}

function getReferenceBodyText(citation: NormalizedCitation) {
  return (
    citation.fullText ||
    citation.excerpt ||
    `${citation.title}\n\n원문 내용을 불러왔습니다.`
  );
}

function buildHighlightParts(source: string, target: string) {
  const text = String(source || '');
  const highlight = String(target || '').trim();
  if (!text || !highlight) return [{ isHighlighted: false, text }];

  const ranges = findHighlightRanges(text, highlight);
  return ranges.map((range) => ({
    isHighlighted: range.isHighlighted,
    text: text.slice(range.start, range.end),
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  frame: {
    flex: 1,
    flexDirection: 'row',
    paddingBottom: 5,
    paddingLeft: 4,
    paddingRight: 20,
    paddingTop: 5,
  },
  railWrap: {
    justifyContent: 'flex-start',
  },
  rail: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 24,
    paddingTop: 28,
  },
  railTop: {
    alignItems: 'center',
  },
  logo: {
    backgroundColor: '#111111',
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  railNav: {
    alignItems: 'center',
    gap: 34,
    marginTop: 38,
  },
  railButton: {
    alignItems: 'center',
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  canvas: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    position: 'relative',
  },
  notificationButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    position: 'absolute',
    right: 38,
    shadowColor: '#AEB4C0',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    top: 34,
    width: 52,
    zIndex: 8,
  },
  gridLineVertical: {
    backgroundColor: '#E9EBF0',
    bottom: 0,
    opacity: 0.72,
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
  },
  gridLineHorizontal: {
    backgroundColor: '#E9EBF0',
    height: StyleSheet.hairlineWidth,
    left: 0,
    opacity: 0.72,
    position: 'absolute',
    right: 0,
  },
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingBottom: 36,
    paddingHorizontal: 28,
  },
  centerContent: {
    alignItems: 'center',
    position: 'relative',
    width: '100%',
    zIndex: 2,
  },
  welcomeAnimation: {
    marginBottom: 34,
  },
  composer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderColor: '#DDDDE5',
    borderRadius: 30,
    borderWidth: 1.2,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 30,
    paddingVertical: 0,
    shadowColor: '#6A6E7A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.13,
    shadowRadius: 42,
    width: '100%',
  },
  composerInput: {
    color: '#252832',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 18,
    fontWeight: 'normal',
    height: 48,
    lineHeight: 24,
    padding: 0,
    textAlignVertical: 'center',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#E1DFDC',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButtonActive: {
    backgroundColor: '#1F78FF',
  },
  webChatStage: {
    flex: 1,
    position: 'relative',
  },
  webChatContent: {
    alignItems: 'center',
    minHeight: '100%',
    paddingBottom: 280,
    paddingHorizontal: 34,
    paddingTop: 64,
  },
  webChatRowUser: {
    alignItems: 'flex-end',
    maxWidth: 760,
    width: '100%',
  },
  webChatRowAi: {
    alignItems: 'flex-start',
    maxWidth: 760,
    paddingTop: 70,
    width: '100%',
  },
  webQuestionBubble: {
    backgroundColor: '#42465A',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 16,
  },
  webQuestionText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 15,
    fontWeight: 'normal',
    lineHeight: 20,
  },
  webAnswerBlock: {
    width: '100%',
  },
  webAnswerText: {
    color: '#1F232B',
    fontFamily: FontFamily.extraBold,
    fontSize: 18,
    fontWeight: 'normal',
    lineHeight: 36,
  },
  webThinkingPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#F4F4F6',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  webThinkingText: {
    color: '#42465A',
    fontFamily: FontFamily.bold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  webEvidenceWrap: {
    borderTopColor: '#E8E9EB',
    borderTopWidth: 1,
    gap: 12,
    marginTop: 42,
    paddingTop: 22,
  },
  webEvidenceToggle: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#EEF6E8',
    borderColor: '#D7E6CE',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 15,
  },
  webEvidenceToggleText: {
    color: '#506747',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  webEvidenceChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  webEvidenceChip: {
    alignItems: 'center',
    backgroundColor: '#EEF6E8',
    borderColor: '#D7E6CE',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    maxWidth: 360,
    minHeight: 34,
    paddingHorizontal: 13,
  },
  webEvidenceChipText: {
    color: '#506747',
    flexShrink: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  webComposerDock: {
    alignItems: 'center',
    bottom: 44,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  webComposer: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E0E2E8',
    borderRadius: 31,
    borderWidth: 1,
    height: 132,
    justifyContent: 'space-between',
    maxWidth: 760,
    paddingBottom: 18,
    paddingHorizontal: 30,
    paddingTop: 24,
    shadowColor: '#808692',
    shadowOffset: { height: 18, width: 0 },
    shadowOpacity: 0.13,
    shadowRadius: 38,
    width: '70%',
  },
  webComposerInput: {
    color: '#252832',
    fontFamily: FontFamily.extraBold,
    fontSize: 18,
    fontWeight: 'normal',
    minHeight: 34,
    padding: 0,
    textAlignVertical: 'top',
  },
  webComposerBottomRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  webSendButton: {
    alignItems: 'center',
    backgroundColor: '#DEDCD8',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  webSendButtonActive: {
    backgroundColor: '#42465A',
  },
  webReferenceSidebar: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
  },
  webReferenceHeader: {
    alignItems: 'center',
    borderBottomColor: '#ECEEF3',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 12,
    height: 78,
    paddingHorizontal: 25,
  },
  webReferenceHeaderIcon: {
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  webReferenceHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  webReferenceTitle: {
    color: '#1D1F24',
    fontFamily: FontFamily.black,
    fontSize: 18,
    fontWeight: 'normal',
    lineHeight: 22,
  },
  webReferenceTime: {
    color: '#8F95A3',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    marginTop: 2,
  },
  webReferenceCloseButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  webReferenceSearchRow: {
    alignItems: 'center',
    borderBottomColor: '#ECEEF3',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 58,
    justifyContent: 'space-between',
    paddingHorizontal: 34,
  },
  webReferenceSearchText: {
    color: '#8F95A3',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  webReferenceScriptContent: {
    paddingBottom: 120,
    paddingHorizontal: 34,
    paddingTop: 28,
  },
  webReferenceScriptText: {
    color: '#3A3D46',
    fontFamily: FontFamily.extraBold,
    fontSize: 15,
    fontWeight: 'normal',
    lineHeight: 30,
  },
  webReferenceHighlightText: {
    backgroundColor: '#F8EAA6',
    borderRadius: 6,
    overflow: 'hidden',
  },
  webReferenceFooter: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#ECEEF3',
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    paddingHorizontal: 26,
    paddingVertical: 22,
    position: 'absolute',
    right: 0,
  },
  webReferenceOpenButton: {
    alignItems: 'center',
    backgroundColor: '#17181D',
    borderRadius: 24,
    flexDirection: 'row',
    gap: 9,
    height: 56,
    justifyContent: 'center',
  },
  webReferenceOpenText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.black,
    fontSize: 15,
    fontWeight: 'normal',
  },
  recentSection: {
    marginTop: 36,
    width: '100%',
  },
  sectionTitle: {
    color: '#565966',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    letterSpacing: 0,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  recentGrid: {
    flexDirection: 'row',
    gap: 14,
  },
  recentStatusCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderColor: 'rgba(221,225,235,0.88)',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    gap: 9,
    justifyContent: 'center',
    padding: 14,
  },
  recentStatusText: {
    color: '#777D89',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  fileCard: {
    backgroundColor: 'rgba(220,227,255,0.84)',
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 14,
    shadowColor: '#181C23',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.05,
    shadowRadius: 42,
  },
  fileCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 0,
  },
  fileIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  tag: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.64)',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 18,
    paddingHorizontal: 8,
  },
  tagText: {
    color: '#2672FF',
    fontFamily: FontFamily.black,
    fontSize: 10,
    fontWeight: 'normal',
  },
  fileTitle: {
    color: '#202329',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
    lineHeight: 17,
    marginBottom: 4,
    marginTop: 'auto',
  },
  fileDate: {
    color: '#868A94',
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 15,
  },
});
