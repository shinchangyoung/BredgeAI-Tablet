import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';

import { FontFamily } from '@/constants/fonts';
import { type ScheduleType, type ScheduleStatus } from '@/lib/schedule-api';

export type ScheduleModalData = {
  sessionId: string;
  recordingId: string;
  transcriptId?: string;
  sourceStartTime: number | null;
  sourceEndTime: number | null;
  sourceText: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
  initialData: ScheduleModalData | null;
};

const EVENT_TYPES: { label: string; value: ScheduleType; icon: keyof typeof MaterialIcons.glyphMap }[] = [
  { label: '수업', value: 'lecture', icon: 'menu-book' },
  { label: '회의', value: 'meeting', icon: 'groups' },
  { label: '과제', value: 'assignment', icon: 'assignment' },
  { label: '시험', value: 'exam', icon: 'quiz' },
  { label: '발표', value: 'presentation', icon: 'campaign' },
  { label: '프로젝트', value: 'project', icon: 'workspaces' },
  { label: '기타', value: 'etc', icon: 'event' },
];

const STATUS_TYPES: { label: string; value: ScheduleStatus }[] = [
  { label: '예정', value: 'confirmed' },
  { label: '확인 대기', value: 'pending' },
];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export function ScheduleCreateModal({ visible, onClose, onSave, initialData }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);

  const [eventType, setEventType] = useState<ScheduleType>('etc');
  const [status, setStatus] = useState<ScheduleStatus>('confirmed');

  useEffect(() => {
    if (visible) {
      setTitle('');
      setDescription('');
      const now = new Date();
      setSelectedDate(now);
      setCalendarYear(now.getFullYear());
      setCalendarMonth(now.getMonth());
      setEventType('etc');
      setStatus('confirmed');
      setIsCalendarExpanded(false);
    }
  }, [visible]);

  if (!visible) return null;

  const formatDateToString = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const handleSave = () => {
    if (!title.trim()) {
      alert('일정 제목을 입력해주세요.');
      return;
    }

    onSave({
      title,
      description,
      event_type: eventType,
      due_date: formatDateToString(selectedDate),
      status,
      session_id: initialData?.sessionId,
      recording_id: initialData?.recordingId,
      source_start_time: initialData?.sourceStartTime,
      source_end_time: initialData?.sourceEndTime,
      source_text: initialData?.sourceText,
    });
  };

  // 달력 날짜 목록 계산
  const daysInMonth = getDaysInMonth(calendarYear, calendarMonth);
  const firstDayIndex = getFirstDayOfMonth(calendarYear, calendarMonth);
  const daysArray: (number | null)[] = [];

  for (let i = 0; i < firstDayIndex; i++) {
    daysArray.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }

  // 월 이동
  const handlePrevMonth = () => {
    if (calendarMonth === 0) {
      setCalendarMonth(11);
      setCalendarYear(calendarYear - 1);
    } else {
      setCalendarMonth(calendarMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (calendarMonth === 11) {
      setCalendarMonth(0);
      setCalendarYear(calendarYear + 1);
    } else {
      setCalendarMonth(calendarMonth + 1);
    }
  };

  // 시간 수정
  const changeHour = (amount: number) => {
    const newDate = new Date(selectedDate);
    newDate.setHours((newDate.getHours() + amount + 24) % 24);
    setSelectedDate(newDate);
  };

  const changeMinute = (amount: number) => {
    const newDate = new Date(selectedDate);
    newDate.setMinutes((newDate.getMinutes() + amount + 60) % 60);
    setSelectedDate(newDate);
  };

  const renderCalendarGrid = () => {
    const rows = [];
    let cells = [];
    const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

    for (let i = 0; i < daysArray.length; i++) {
      const day = daysArray[i];
      const isSelected = day !== null && 
        selectedDate.getFullYear() === calendarYear &&
        selectedDate.getMonth() === calendarMonth &&
        selectedDate.getDate() === day;
      
      const isToday = day !== null &&
        new Date().getFullYear() === calendarYear &&
        new Date().getMonth() === calendarMonth &&
        new Date().getDate() === day;

      cells.push(
        <Pressable
          key={i}
          style={[
            styles.calendarCell,
            isSelected && styles.calendarCellSelected,
            isToday && !isSelected && styles.calendarCellToday
          ]}
          disabled={day === null}
          onPress={() => {
            if (day !== null) {
              const newDate = new Date(selectedDate);
              newDate.setFullYear(calendarYear);
              newDate.setMonth(calendarMonth);
              newDate.setDate(day);
              setSelectedDate(newDate);
            }
          }}
        >
          {day !== null && (
            <Text style={[
              styles.calendarCellText,
              isSelected && styles.calendarCellTextSelected,
              isToday && !isSelected && styles.calendarCellTextToday,
              (i % 7 === 0) && !isSelected && { color: '#EF4444' }, // 일요일
              (i % 7 === 6) && !isSelected && { color: '#3B82F6' }  // 토요일
            ]}>
              {day}
            </Text>
          )}
        </Pressable>
      );

      if (cells.length === 7 || i === daysArray.length - 1) {
        rows.push(
          <View key={`row-${rows.length}`} style={styles.calendarRow}>
            {cells}
          </View>
        );
        cells = [];
      }
    }

    return (
      <View style={styles.calendarGrid}>
        <View style={styles.calendarRow}>
          {weekDays.map((wd, index) => (
            <View key={`wd-${index}`} style={styles.calendarCell}>
              <Text style={[
                styles.weekDayText,
                index === 0 && { color: '#EF4444' },
                index === 6 && { color: '#3B82F6' }
              ]}>
                {wd}
              </Text>
            </View>
          ))}
        </View>
        {rows}
      </View>
    );
  };

  const getDayName = (date: Date) => {
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return dayNames[date.getDay()];
  };

  const displayDateStr = `${selectedDate.getFullYear()}년 ${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 (${getDayName(selectedDate)})`;
  const displayTimeStr = `${String(selectedDate.getHours()).padStart(2, '0')}:${String(selectedDate.getMinutes()).padStart(2, '0')}`;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}>
      <Pressable style={styles.overlay} onPress={onClose} />
      <View style={styles.container}>
        <View style={styles.header}>
        <Text style={styles.headerTitle}>일정 추가</Text>
        <Pressable onPress={onClose} style={styles.closeButton}>
          <MaterialIcons name="close" size={20} color="#64748B" />
        </Pressable>
      </View>

      <ScrollView 
        style={styles.body} 
        contentContainerStyle={styles.bodyContent} 
        showsVerticalScrollIndicator={false}
      >
        {/* 제목 */}
        <View style={styles.field}>
          <Text style={styles.label}>제목 *</Text>
          <TextInput
            style={styles.input}
            placeholder="일정 제목 입력"
            placeholderTextColor="#A1A1AA"
            value={title}
            onChangeText={setTitle}
          />
        </View>

        {/* 날짜 및 시간 선택 */}
        <View style={styles.field}>
          <Text style={styles.label}>날짜 및 시간</Text>
          <Pressable 
            style={[styles.dateSelectorButton, isCalendarExpanded && styles.dateSelectorButtonActive]}
            onPress={() => setIsCalendarExpanded(!isCalendarExpanded)}
          >
            <MaterialIcons name="event" size={18} color="#355CFF" />
            <Text style={styles.dateSelectorText}>
              {displayDateStr} {displayTimeStr}
            </Text>
            <MaterialIcons 
              name={isCalendarExpanded ? "expand-less" : "expand-more"} 
              size={20} 
              color="#71717A" 
            />
          </Pressable>

          {isCalendarExpanded && (
            <View style={styles.calendarCard}>
              {/* 달력 헤더 */}
              <View style={styles.calendarHeader}>
                <Pressable onPress={handlePrevMonth} style={styles.calNavBtn}>
                  <MaterialIcons name="chevron-left" size={20} color="#4B5563" />
                </Pressable>
                <Text style={styles.calendarHeaderTitle}>
                  {calendarYear}년 {calendarMonth + 1}월
                </Text>
                <Pressable onPress={handleNextMonth} style={styles.calNavBtn}>
                  <MaterialIcons name="chevron-right" size={20} color="#4B5563" />
                </Pressable>
              </View>

              {/* 달력 그리드 */}
              {renderCalendarGrid()}

              {/* 시간 조절 스텝퍼 */}
              <View style={styles.timeStepperContainer}>
                <Text style={styles.timeStepperLabel}>시간 설정</Text>
                <View style={styles.stepperRow}>
                  <View style={styles.stepperGroup}>
                    <Pressable style={styles.stepperBtn} onPress={() => changeHour(-1)}>
                      <MaterialIcons name="remove" size={16} color="#4B5563" />
                    </Pressable>
                    <Text style={styles.stepperValue}>
                      {String(selectedDate.getHours()).padStart(2, '0')}시
                    </Text>
                    <Pressable style={styles.stepperBtn} onPress={() => changeHour(1)}>
                      <MaterialIcons name="add" size={16} color="#4B5563" />
                    </Pressable>
                  </View>

                  <View style={styles.stepperGroup}>
                    <Pressable style={styles.stepperBtn} onPress={() => changeMinute(-5)}>
                      <MaterialIcons name="remove" size={16} color="#4B5563" />
                    </Pressable>
                    <Text style={styles.stepperValue}>
                      {String(selectedDate.getMinutes()).padStart(2, '0')}분
                    </Text>
                    <Pressable style={styles.stepperBtn} onPress={() => changeMinute(5)}>
                      <MaterialIcons name="add" size={16} color="#4B5563" />
                    </Pressable>
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* 일정 유형 */}
        <View style={styles.field}>
          <Text style={styles.label}>유형</Text>
          <View style={styles.rowList}>
            {EVENT_TYPES.map((type) => (
              <Pressable
                key={type.value}
                style={[styles.chip, eventType === type.value && styles.chipActive]}
                onPress={() => setEventType(type.value)}>
                <MaterialIcons 
                  name={type.icon} 
                  size={12} 
                  color={eventType === type.value ? '#355CFF' : '#71717A'} 
                />
                <Text style={[styles.chipText, eventType === type.value && styles.chipTextActive]}>
                  {type.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 상태 */}
        <View style={styles.field}>
          <Text style={styles.label}>상태</Text>
          <View style={styles.rowList}>
            {STATUS_TYPES.map((st) => (
              <Pressable
                key={st.value}
                style={[styles.chip, status === st.value && styles.chipActive]}
                onPress={() => setStatus(st.value)}>
                <Text style={[styles.chipText, status === st.value && styles.chipTextActive]}>
                  {st.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* 본문 메모 */}
        <View style={styles.field}>
          <Text style={styles.label}>메모</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="세부 일정 메모"
            placeholderTextColor="#A1A1AA"
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* 근거 텍스트 */}
        <View style={styles.field}>
          <Text style={styles.label}>근거 텍스트</Text>
          <View style={styles.sourceBox}>
            <Text style={styles.sourceText} numberOfLines={3}>
              {initialData?.sourceText || '선택된 스크립트가 없습니다.'}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={onClose} style={styles.cancelButton}>
          <Text style={styles.cancelButtonText}>취소</Text>
        </Pressable>
        <Pressable onPress={handleSave} style={styles.saveButton}>
          <Text style={styles.saveButtonText}>저장</Text>
        </Pressable>
      </View>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  container: {
    position: 'absolute',
    top: 56, // Just below the tab header (assuming tab header is ~50px)
    left: 16,
    width: 330,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitle: {
    fontFamily: FontFamily.black,
    fontSize: 16,
    color: '#0F172A',
  },
  closeButton: {
    padding: 4,
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    padding: 16,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    color: '#475569',
  },
  input: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    color: '#0F172A',
  },
  textArea: {
    height: 70,
  },
  dateSelectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  dateSelectorButtonActive: {
    borderColor: '#355CFF',
    backgroundColor: '#EEF2FF',
  },
  dateSelectorText: {
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    color: '#0F172A',
  },
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    gap: 12,
  },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calendarHeaderTitle: {
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    color: '#1E293B',
  },
  calNavBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  calendarGrid: {
    gap: 4,
  },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  calendarCell: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  calendarCellSelected: {
    backgroundColor: '#355CFF',
  },
  calendarCellToday: {
    borderWidth: 1,
    borderColor: '#355CFF',
  },
  calendarCellText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 11,
    color: '#334155',
  },
  calendarCellTextSelected: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
  },
  calendarCellTextToday: {
    color: '#355CFF',
  },
  weekDayText: {
    fontFamily: FontFamily.extraBold,
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'center',
  },
  timeStepperContainer: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
    gap: 8,
  },
  timeStepperLabel: {
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    color: '#475569',
  },
  stepperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  stepperGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  stepperBtn: {
    padding: 4,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
  },
  stepperValue: {
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    color: '#1E293B',
  },
  rowList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  chipActive: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  chipText: {
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    color: '#64748B',
  },
  chipTextActive: {
    color: '#355CFF',
  },
  sourceBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#94A3B8',
  },
  sourceText: {
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  footer: {
    flexDirection: 'row',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
  },
  cancelButtonText: {
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    color: '#475569',
  },
  saveButton: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
  },
  saveButtonText: {
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
