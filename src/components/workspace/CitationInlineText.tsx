import React, { useMemo, useState } from 'react';
import {
  Text,
  Pressable,
  StyleSheet,
  View,
  TextStyle,
  StyleProp,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

// ── Citation Utilities ──────────────────────────────────────────────

function formatCitationSeconds(seconds?: number | null): string {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '';
  const totalSeconds = Math.max(0, Math.floor(value));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function compactCitationLabel(value = '', fallback = '근거 자료', maxLength = 34): string {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  if (!label) return fallback;
  return label.length > maxLength ? `${label.slice(0, maxLength).trim()}...` : label;
}

export type NormalizedCitation = {
  id: string;
  number: number;
  type: 'material' | 'transcript';
  icon: 'picture-as-pdf' | 'graphic-eq';
  title: string;
  sourceCaption: string;
  locationLabel: string;
  label: string;
  excerpt: string;
  fullText: string;
  raw: Record<string, unknown>;
};

function citationKey(cite: Record<string, unknown> = {}, index = 0): string {
  const parts = [
    cite?.source_type,
    cite?.material_id,
    cite?.transcript_id,
    cite?.recording_id,
    cite?.stored_name,
    cite?.page,
    cite?.start_time,
    cite?.end_time,
    cite?.citation,
    cite?.text,
  ].filter((value) => value !== undefined && value !== null && String(value).trim());

  return parts.length ? parts.map((value) => String(value)).join(':') : String(index);
}

export function normalizeCitation(cite: Record<string, unknown> = {}, index = 0): NormalizedCitation {
  const isMaterial = cite?.source_type === 'material';
  const start = formatCitationSeconds(cite?.start_time as number);
  const end = formatCitationSeconds(cite?.end_time as number);
  const page = Number(cite?.page || 0);
  const title = isMaterial
    ? String(cite?.material_name || cite?.file_title || cite?.stored_name || `PDF ${index + 1}`)
    : String(cite?.recording_title || cite?.session_title || cite?.file_title || `전사 ${index + 1}`);
  const locationLabel = isMaterial
    ? (page > 0 ? `p.${page}` : 'PDF 원문')
    : (start && end ? `${start}~${end}` : '전사 원문');
  const fullText = String(cite?.full_transcript || cite?.text || '');
  const excerpt = String(cite?.text || '').trim();

  return {
    id: citationKey(cite, index),
    number: index + 1,
    type: isMaterial ? 'material' : 'transcript',
    icon: isMaterial ? 'picture-as-pdf' : 'graphic-eq',
    title,
    sourceCaption: isMaterial ? 'PDF 자료' : '오디오 전사',
    locationLabel,
    label: compactCitationLabel(
      `${title} ${locationLabel}`,
      `근거 ${index + 1}`
    ),
    excerpt,
    fullText,
    raw: cite,
  };
}

export function normalizeCitations(citations: Record<string, unknown>[] = []): NormalizedCitation[] {
  const seen = new Set<string>();
  const normalized: NormalizedCitation[] = [];

  citations.forEach((cite, index) => {
    const key = citationKey(cite, index);
    if (!key || seen.has(key)) return;
    seen.add(key);
    normalized.push(normalizeCitation(cite, normalized.length));
  });

  return normalized;
}

// ── Highlight Utilities (ported from web citationUtils.js) ──────────

function normalizeHighlightWhitespace(value = ''): string {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizedIndexMap(value = ''): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let previousWasSpace = true;

  Array.from(String(value)).forEach((char, index) => {
    if (/\s/.test(char)) {
      if (previousWasSpace) return;
      text += ' ';
      map.push(index);
      previousWasSpace = true;
      return;
    }

    text += char;
    map.push(index);
    previousWasSpace = false;
  });

  return { text: text.trim(), map };
}

function compactCitationText(value = ''): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function compactIndexMap(value = ''): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];

  Array.from(String(value || '')).forEach((char, index) => {
    if (!/[\p{L}\p{N}]/u.test(char)) return;
    text += char.toLowerCase();
    map.push(index);
  });

  return { text, map };
}

function findSingleHighlightRange(source: string, target: string): [number, number] | null {
  if (!target) return null;

  // Step 1: Direct exact match
  const directIndex = source.indexOf(target);
  if (directIndex >= 0) return [directIndex, directIndex + target.length];

  // Step 2: Whitespace-normalized match
  const normalized = normalizedIndexMap(source);
  const normalizedTarget = normalizeHighlightWhitespace(target);
  if (normalizedTarget.length >= 8) {
    const normalizedIndex = normalized.text.indexOf(normalizedTarget);
    if (normalizedIndex >= 0) {
      const start = normalized.map[normalizedIndex];
      const endMapIndex = normalizedIndex + normalizedTarget.length - 1;
      const end = (normalized.map[endMapIndex] ?? start) + 1;
      return [start, end];
    }
  }

  // Step 3: Compact match (strip all non-letter/non-number chars)
  const compact = compactIndexMap(source);
  const compactTarget = compactCitationText(target);
  if (compactTarget.length >= 8) {
    const compactIndex = compact.text.indexOf(compactTarget);
    if (compactIndex >= 0) {
      const start = compact.map[compactIndex];
      const endMapIndex = compactIndex + compactTarget.length - 1;
      const end = (compact.map[endMapIndex] ?? start) + 1;
      return [start, end];
    }
  }

  return null;
}

function expandRangeToSentence(source: string, range: [number, number]): [number, number] {
  const text = String(source || '');
  let [start, end] = range;
  const sentenceBoundary = /[.!?。？！]|\n/;

  while (start > 0 && !sentenceBoundary.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && !sentenceBoundary.test(text[end])) {
    end += 1;
  }
  if (end < text.length && sentenceBoundary.test(text[end])) {
    end += 1;
  }
  return [start, end];
}

function splitCitationSentences(value = ''): string[] {
  const cleaned = String(value || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\([^)]*출처[^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];

  const matches = cleaned.match(/[^.!?。？！]+(?:다\.|요\.|입니다\.|습니다\.|[.!?。？！])?/g) || [cleaned];
  const seen = new Set<string>();
  return matches
    .map((item) => item.trim())
    .filter((item) => normalizeHighlightWhitespace(item).length >= 8)
    .filter((item) => {
      const key = normalizeHighlightWhitespace(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mergeHighlightRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = ranges
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) {
      merged.push([start, end]);
      return;
    }
    last[1] = Math.max(last[1], end);
  });
  return merged;
}

function findAllHighlightRanges(source: string, target: string): Array<[number, number]> {
  // Try full target match first
  const primary = findSingleHighlightRange(source, target);
  if (primary) return [expandRangeToSentence(source, primary)];

  // Fall back to sentence-by-sentence matching
  const sentences = splitCitationSentences(target);
  const ranges: Array<[number, number]> = [];
  sentences.forEach((sentence) => {
    const range = findSingleHighlightRange(source, sentence);
    if (range) ranges.push(expandRangeToSentence(source, range));
  });

  return mergeHighlightRanges(ranges);
}

export function findHighlightRanges(source: string, target: string): Array<{ start: number; end: number; isHighlighted: boolean }> {
  if (!target || !source) return [{ start: 0, end: source.length, isHighlighted: false }];

  const rawRanges = findAllHighlightRanges(source, target);
  if (!rawRanges.length) return [{ start: 0, end: source.length, isHighlighted: false }];

  const parts: Array<{ start: number; end: number; isHighlighted: boolean }> = [];
  let cursor = 0;
  rawRanges.forEach(([start, end]) => {
    if (start < cursor) return;
    if (start > cursor) {
      parts.push({ start: cursor, end: start, isHighlighted: false });
    }
    parts.push({ start, end, isHighlighted: true });
    cursor = end;
  });
  if (cursor < source.length) {
    parts.push({ start: cursor, end: source.length, isHighlighted: false });
  }
  return parts;
}

const citationMarkerPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const citationMarkerTestPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/;

function cleanupCitationText(text: string): string {
  return stripTrailingSourceSection(
    String(text || '')
      .replace(/\s*\[출처[:：]?[^\]]*\][^\n]*(?=\n|$)/g, '')
      .replace(/(^|\n)\s*(?:\[\d+(?:\s*,\s*\d+)*\]\s*)+\s*(?=\n|$)/g, '$1')
  ).trim();
}

function stripTrailingSourceSection(text: string): string {
  const sourceHeadingPattern = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:출처|참고자료|참고 문헌|Sources?|References?)\s*[:：]?\s*(?:\n|$)/i;
  const match = text.match(sourceHeadingPattern);
  if (!match) return text;

  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice((match.index || 0) + match[0].length).trim();
  if (!before || !looksLikeSourceList(after)) return text;
  return before;
}

function looksLikeSourceList(text: string): boolean {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;

  return lines.every((line) => (
    /^\d+[\).]?\s+/.test(line)
    || /^\[\d+\]\s+/.test(line)
    || /^[-*]\s+/.test(line)
    || /(?:\.pdf|\.m4a|\.wav|p\.\d+|페이지|녹음|길이|시간)/i.test(line)
  ));
}

function stripCitationMarkers(value: string) {
  return String(value || '')
    .replace(citationMarkerPattern, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?。！？])/g, '$1');
}

function extractCitationNumbers(value: string, maxNumber: number) {
  const numbers: number[] = [];
  String(value || '').replace(citationMarkerPattern, (match, rawNumbers) => {
    numbers.push(...uniqueCitationNumbers(rawNumbers, maxNumber));
    return match;
  });
  return numbers;
}

function uniqueCitationNumbers(rawNumbers: string, maxNumber: number) {
  return String(rawNumbers || '')
    .split(',')
    .map((number) => Number(number.trim()))
    .filter((number) => Number.isInteger(number) && number >= 1 && number <= maxNumber)
    .filter((number, index, numbers) => numbers.indexOf(number) === index);
}

function keywordSet(value: string) {
  const stopwords = new Set(['그리고', '하지만', '또한', '그래서', '예를', '들어', '이것', '저것', '수', '있습니다', '입니다', '합니다', '됩니다']);
  const terms = String(value || '').toLowerCase().match(/[가-힣a-z0-9_+#.-]{2,}/g) || [];
  return new Set(terms.filter((term) => !stopwords.has(term)));
}

function citationOverlapScore(sentence: string, sourceText: string) {
  const sentenceTerms = keywordSet(sentence);
  if (!sentenceTerms.size) return 0;

  const source = String(sourceText || '').toLowerCase();
  let score = 0;
  sentenceTerms.forEach((term) => {
    if (source.includes(term)) score += 1;
  });
  return score;
}

function citationSearchText(citation: NormalizedCitation) {
  return [
    citation.title,
    citation.locationLabel,
    citation.sourceCaption,
    citation.excerpt,
    citation.fullText,
  ].join(' ');
}

function bestCitationNumbers(sentence: string, citations: NormalizedCitation[]) {
  const ranked = citations
    .map((citation) => ({
      citation,
      score: citationOverlapScore(sentence, citationSearchText(citation)),
    }))
    .sort((a, b) => b.score - a.score || a.citation.number - b.citation.number);
  const material = ranked.find((item) => item.citation.type === 'material' && item.score > 0);
  const transcript = ranked.find((item) => item.citation.type === 'transcript' && item.score > 0);
  const mixedNumbers = [material?.citation.number, transcript?.citation.number].filter(Boolean) as number[];
  if (mixedNumbers.length) return [...new Set(mixedNumbers)].sort((a, b) => a - b);

  const best = ranked[0];
  if (best?.score > 0) return [best.citation.number];
  return citations.slice(0, 3).map((citation) => citation.number);
}

function ensureTrailingCitationMarker(text: string, citations: NormalizedCitation[]) {
  const value = String(text || '').trimEnd();
  if (!value || !citations.length) return value;
  if (citationMarkerTestPattern.test(value) && extractCitationNumbers(value, citations.length).length) return value;

  const cleaned = stripCitationMarkers(value).trimEnd();
  const numbers = bestCitationNumbers(cleaned, citations).slice(0, 3);
  if (!numbers.length) return cleaned;
  return `${cleaned} [${numbers.join(',')}]`;
}

type MarkdownBlock =
  | { type: 'blank'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'bullet'; marker: string; text: string }
  | { type: 'paragraph'; text: string };

function buildMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = String(text || '').split(/\n/);
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  lines.forEach((line) => {
    const raw = line.trimEnd();
    const trimmed = raw.trim();
    if (!trimmed) {
      flushParagraph();
      blocks.push({ type: 'blank', text: '' });
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      return;
    }

    const bulletMatch = trimmed.match(/^([-*])\s+(.+)$/);
    const orderedMatch = trimmed.match(/^(\d+[\).])\s+(.+)$/);
    if (bulletMatch || orderedMatch) {
      flushParagraph();
      blocks.push({
        type: 'bullet',
        marker: bulletMatch ? '•' : orderedMatch?.[1] ?? '•',
        text: bulletMatch?.[2] ?? orderedMatch?.[2] ?? trimmed,
      });
      return;
    }

    paragraph.push(trimmed);
  });

  flushParagraph();
  return blocks.length ? blocks : [{ type: 'paragraph', text }];
}

// ── Types ───────────────────────────────────────────────────────────

export type CitationInlineTextProps = {
  text: string;
  citations?: any[];
  enableCitations?: boolean;
  onCitationClick?: (citation: any, event?: any) => void;
  onSourceView?: (citation: NormalizedCitation) => void;
  style?: StyleProp<TextStyle>;
};

// ── Popover Component ───────────────────────────────────────────────

function CitationPopover({
  citation,
  visible,
  position,
  onClose,
  onSourceView,
}: {
  citation: NormalizedCitation | null;
  visible: boolean;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onSourceView?: (citation: NormalizedCitation) => void;
}) {
  if (!citation) return null;

  const highlightParts = useMemo(() => {
    return findHighlightRanges(citation.fullText || citation.excerpt, citation.excerpt);
  }, [citation]);

  const isTranscript = citation.type === 'transcript';
  const iconBgColor = isTranscript ? '#FEF3C7' : '#DBEAFE';
  const iconColor = isTranscript ? '#D97706' : '#2563EB';

  const popoverWidth = Math.min(SCREEN_WIDTH * 0.85, 370);
  const screenHeight = Dimensions.get('window').height;
  const estimatedPopoverHeight = 300;
  const left = position ? Math.max(20, Math.min(position.x - popoverWidth / 2, SCREEN_WIDTH - popoverWidth - 20)) : 20;
  const fitsBelow = position ? (position.y + 24 + estimatedPopoverHeight < screenHeight - 40) : true;
  const top = position
    ? (fitsBelow ? position.y + 24 : Math.max(40, position.y - estimatedPopoverHeight - 12))
    : 100;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={popStyles.overlay} onPress={onClose}>
        <Pressable 
          style={[
            popStyles.popover,
            { position: 'absolute', top, left: Math.max(20, left) }
          ]} 
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={popStyles.header}>
            <View style={[popStyles.headerIcon, { backgroundColor: iconBgColor }]}>
              <MaterialIcons
                name={citation.icon}
                size={18}
                color={iconColor}
              />
            </View>
            <View style={popStyles.headerTextWrap}>
              <Text style={popStyles.headerTitle} numberOfLines={1}>{citation.title}</Text>
              <Text style={popStyles.headerSubtitle}>
                {citation.sourceCaption} · {citation.locationLabel}
              </Text>
            </View>
            <Pressable onPress={onClose} style={popStyles.closeButton}>
              <MaterialIcons name="close" size={20} color="#64748B" />
            </Pressable>
          </View>

          {/* Content */}
          <ScrollView style={popStyles.body} showsVerticalScrollIndicator={false}>
            <Text style={popStyles.bodyText}>
              {highlightParts.map((part, i) => (
                <Text
                  key={i}
                  style={part.isHighlighted ? popStyles.highlightedText : undefined}
                >
                  {(citation.fullText || citation.excerpt).slice(part.start, part.end)}
                </Text>
              ))}
            </Text>
          </ScrollView>

          {/* Source Card */}
          <View style={popStyles.sourceWrap}>
            <Pressable
              style={popStyles.sourceCard}
              onPress={() => {
                onSourceView?.(citation);
                onClose();
              }}
            >
              <View style={[popStyles.sourceIcon, { backgroundColor: iconBgColor }]}>
                <MaterialIcons
                  name={citation.icon}
                  size={16}
                  color={iconColor}
                />
              </View>
              <View style={popStyles.sourceTextWrap}>
                <Text style={popStyles.sourceCaption}>
                  {citation.sourceCaption} · {citation.locationLabel}
                </Text>
                <Text style={popStyles.sourceViewText}>소스 보기</Text>
              </View>
              <MaterialIcons name="open-in-new" size={16} color="#2563EB" />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function CitationInlineText({
  text,
  citations = [],
  enableCitations = false,
  onCitationClick,
  onSourceView,
  style,
}: CitationInlineTextProps) {
  const [popoverCitation, setPopoverCitation] = useState<NormalizedCitation | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [popoverVisible, setPopoverVisible] = useState(false);

  const normalizedCitations = useMemo(() => {
    return normalizeCitations(citations);
  }, [citations]);

  const displayText = useMemo(() => {
    const cleanedText = cleanupCitationText(text);
    if (!enableCitations || normalizedCitations.length === 0) return cleanedText;
    return ensureTrailingCitationMarker(cleanedText, normalizedCitations);
  }, [text, normalizedCitations, enableCitations]);

  const blocks = useMemo(() => buildMarkdownBlocks(displayText), [displayText]);

  const handleMarkerPress = (citeData: NormalizedCitation, event: any) => {
    if (event?.nativeEvent?.pageY) {
      setPopoverPosition({
        x: event.nativeEvent.pageX,
        y: event.nativeEvent.pageY,
      });
    } else {
      setPopoverPosition(null);
    }
    setPopoverCitation(citeData);
    setPopoverVisible(true);
    onCitationClick?.(citeData.raw);
  };

  const renderInlineText = (value: string, keyPrefix: string, extraStyle?: StyleProp<TextStyle>) => {
    const result: React.ReactNode[] = [];
    const regex = /(\[(?:\d+(?:\s*,\s*\d+)*)\]|\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(value)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        result.push(<Text key={`${keyPrefix}-text-${lastIndex}`}>{value.substring(lastIndex, matchIndex)}</Text>);
      }

      const token = match[0];
      const numberMatch = token.match(/^\[(\d+(?:\s*,\s*\d+)*)\]$/);
      if (numberMatch && enableCitations) {
        uniqueCitationNumbers(numberMatch[1], normalizedCitations.length).forEach((id) => {
          const citeData = normalizedCitations.find((citation) => citation.number === id);
          if (!citeData) return;
          result.push(
            <Text
              key={`${keyPrefix}-cite-${id}-${matchIndex}`}
              style={styles.markerBadgeText}
              onPress={(e) => handleMarkerPress(citeData, e)}
              suppressHighlighting={true}
            >
              {citeData.number}
            </Text>
          );
        });
      } else if (token.startsWith('**')) {
        result.push(
          <Text key={`${keyPrefix}-bold-${matchIndex}`} style={styles.boldText}>
            {token.slice(2, -2)}
          </Text>
        );
      } else if (token.startsWith('`')) {
        result.push(
          <Text key={`${keyPrefix}-code-${matchIndex}`} style={styles.codeText}>
            {token.slice(1, -1)}
          </Text>
        );
      } else {
        result.push(<Text key={`${keyPrefix}-raw-${matchIndex}`}>{token}</Text>);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < value.length) {
      result.push(<Text key={`${keyPrefix}-tail`}>{value.substring(lastIndex)}</Text>);
    }

    return (
      <Text style={[styles.text, extraStyle, style]}>
        {result}
      </Text>
    );
  };

  return (
    <>
      <View>
        {blocks.map((block, index) => {
          if (block.type === 'blank') {
            return <View key={`blank-${index}`} style={styles.blankLine} />;
          }

          if (block.type === 'heading') {
            return (
              <View key={`heading-${index}`} style={styles.block}>
                {renderInlineText(block.text, `heading-${index}`, styles.headingText)}
              </View>
            );
          }

          if (block.type === 'bullet') {
            return (
              <View key={`bullet-${index}`} style={styles.bulletRow}>
                <Text style={styles.bulletMarker}>{block.marker}</Text>
                <View style={styles.bulletContent}>
                  {renderInlineText(block.text, `bullet-${index}`)}
                </View>
              </View>
            );
          }

          return (
            <View key={`paragraph-${index}`} style={styles.block}>
              {renderInlineText(block.text, `paragraph-${index}`)}
            </View>
          );
        })}
      </View>

      <CitationPopover
        citation={popoverCitation}
        visible={popoverVisible}
        position={popoverPosition}
        onClose={() => setPopoverVisible(false)}
        onSourceView={onSourceView}
      />
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  blankLine: {
    height: 8,
  },
  block: {
    marginBottom: 8,
  },
  text: {
    lineHeight: 26,
    fontSize: 15,
  },
  headingText: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 25,
  },
  boldText: {
    color: '#0F172A',
    fontWeight: '800',
  },
  codeText: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    color: '#1F2937',
    fontFamily: 'Menlo',
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  bulletRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  bulletMarker: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 25,
    minWidth: 20,
    textAlign: 'right',
  },
  bulletContent: {
    flex: 1,
    minWidth: 0,
  },
  markerWrap: {
  },
  markerBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
    marginLeft: 2,
    lineHeight: 26,
  },
});

const popStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  popover: {
    width: Math.min(SCREEN_WIDTH * 0.85, 370),
    maxHeight: '70%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.16,
    shadowRadius: 64,
    elevation: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    maxHeight: 320,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 24,
    color: '#334155',
  },
  highlightedText: {
    backgroundColor: 'rgba(253, 224, 71, 0.44)',
    fontWeight: '800',
    borderRadius: 4,
  },
  sourceWrap: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sourceIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceTextWrap: {
    flex: 1,
  },
  sourceCaption: {
    fontSize: 11,
    color: '#64748B',
  },
  sourceViewText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#2563EB',
    marginTop: 1,
  },
});
