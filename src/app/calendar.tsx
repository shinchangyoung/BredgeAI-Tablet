import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  DeviceEventEmitter,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { FontFamily } from '@/constants/fonts';
import {
  confirmSchedule,
  fetchSchedules,
  formatDateKey,
  formatDateLabel,
  getScheduleStatusLabel,
  getScheduleTypeIcon,
  getScheduleTypeLabel,
  ignoreSchedule,
  parseDateKey,
  type ScheduleItem,
} from '@/lib/schedule-api';

type CalendarDay = {
  dateKey: string;
  hasConfirmedSchedule: boolean;
  hasPendingSchedule: boolean;
  isToday: boolean;
  label: number;
  muted: boolean;
  schedules: ScheduleItem[];
};

const weekLabels = ['일', '월', '화', '수', '목', '금', '토'];

export default function CalendarScreen() {
  const router = useRouter();
  const { height, width } = useWindowDimensions();
  const today = useMemo(() => new Date(), []);
  const todayKey = useMemo(() => formatDateKey(today), [today]);
  const [activeMonthDate, setActiveMonthDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const layout = useMemo(() => {
    const railWidth = clamp(width * 0.052, 72, 88);
    const shellGap = clamp(width * 0.014, 16, 24);
    const canvasRadius = clamp(width * 0.024, 28, 42);
    const mainPadding = clamp(width * 0.026, 30, 48);
    const sideWidth = clamp(width * 0.25, 320, 390);
    const calendarCellHeight = clamp((height - 258) / 6, 82, 112);

    return {
      calendarCellHeight,
      canvasRadius,
      mainPadding,
      railWidth,
      shellGap,
      sideWidth,
    };
  }, [height, width]);

  const visibleSchedules = useMemo(
    () => schedules.filter((item) => item.status !== 'ignored'),
    [schedules],
  );

  const pendingSchedules = useMemo(
    () => visibleSchedules.filter((item) => item.status === 'pending'),
    [visibleSchedules],
  );

  const selectedSchedules = useMemo(
    () => visibleSchedules.filter((item) => item.dateKey === selectedDateKey),
    [selectedDateKey, visibleSchedules],
  );

  const calendarDays = useMemo(
    () => buildCalendarDays(activeMonthDate, todayKey, visibleSchedules),
    [activeMonthDate, todayKey, visibleSchedules],
  );

  const currentMonthLabel = `${activeMonthDate.getFullYear()}년 ${activeMonthDate.getMonth() + 1}월`;
  const confirmedCount = visibleSchedules.filter((item) => item.status === 'confirmed').length;

  const loadSchedules = useCallback(async () => {
    try {
      setErrorMessage(null);
      setSchedules(await fetchSchedules());
    } catch (error) {
      const message = error instanceof Error ? error.message : '일정을 불러오지 못했습니다.';
      setErrorMessage(message);
      setSchedules([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSchedules();
    }, [loadSchedules])
  );

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('globalRefresh', () => {
      loadSchedules();
    });
    
    return () => subscription.remove();
  }, [loadSchedules]);

  const moveMonth = (offset: number) => {
    setActiveMonthDate((current) => {
      const nextDate = new Date(current);
      nextDate.setMonth(nextDate.getMonth() + offset);
      return nextDate;
    });
  };

  const moveToday = () => {
    const nextToday = new Date();
    setActiveMonthDate(new Date(nextToday.getFullYear(), nextToday.getMonth(), 1));
    setSelectedDateKey(formatDateKey(nextToday));
  };

  const selectDate = (day: CalendarDay) => {
    setSelectedDateKey(day.dateKey);
    if (day.muted) {
      const date = parseDateKey(day.dateKey);
      setActiveMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  const updateScheduleStatus = async (item: ScheduleItem, status: 'confirmed' | 'ignored') => {
    setSchedules((current) => current.map((schedule) => (
      schedule.id === item.id ? { ...schedule, status } : schedule
    )));

    try {
      if (status === 'confirmed') await confirmSchedule(item.apiId || item.id);
      else await ignoreSchedule(item.apiId || item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '일정 상태를 바꾸지 못했습니다.';
      setErrorMessage(message);
      loadSchedules();
    }
  };

  const openWorkspace = (item: ScheduleItem) => {
    if (item.status === 'pending') {
      updateScheduleStatus(item, 'confirmed');
    }

    if (item.workspaceFileId) {
      router.push({
        pathname: '/workspace',
        params: {
          sessionId: item.workspaceFileId,
          citation: JSON.stringify({
            session_id: item.workspaceFileId,
            recording_id: item.recordingId,
            transcript_id: item.transcriptId,
            start_time: item.sourceStartTime,
            end_time: item.sourceEndTime,
            source_text: item.sourceText,
            source_type: 'recording',
          }),
        },
      });
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={[styles.app, { gap: layout.shellGap }]}>
        <View style={[styles.rail, { width: layout.railWidth }]}>
          <Pressable onPress={() => {
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
            <RailIcon name="add" onPress={() => router.push('/workspace')} />
            <RailIcon name="folder-open" onPress={() => router.push('/workfolder')} />
            <RailIcon active name="calendar-today" />
          </View>
        </View>

        <View style={[styles.pageShell, { borderRadius: layout.canvasRadius }]}>
          <ScrollView
            bounces={false}
            style={{ borderRadius: layout.canvasRadius, overflow: 'hidden' }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.pageContent,
              {
                minHeight: Math.max(height - 36, 720),
                padding: layout.mainPadding,
              },
            ]}>
            <View style={styles.pageHeader}>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>캘린더</Text>
                <Text numberOfLines={1} style={styles.titleMeta}>
                  예정 {confirmedCount}개 · 확인 대기 {pendingSchedules.length}개
                </Text>
              </View>

              <View style={styles.headerActions}>
                <Pressable onPress={moveToday} style={styles.todayButton}>
                  <MaterialIcons name="today" size={18} color="#FFFFFF" />
                  <Text style={styles.todayText}>오늘</Text>
                </Pressable>
                <View style={styles.monthControls}>
                  <Pressable onPress={() => moveMonth(-1)} style={styles.monthButton}>
                    <MaterialIcons name="chevron-left" size={24} color="#1D1D1F" />
                  </Pressable>
                  <Pressable onPress={() => moveMonth(1)} style={styles.monthButton}>
                    <MaterialIcons name="chevron-right" size={24} color="#1D1D1F" />
                  </Pressable>
                </View>
              </View>
            </View>

            {errorMessage ? (
              <View style={styles.statusBanner}>
                <MaterialIcons name="cloud-off" size={20} color="#A33B00" />
                <Text numberOfLines={2} style={styles.statusText}>{errorMessage}</Text>
                <Pressable onPress={loadSchedules} style={styles.retryButton}>
                  <Text style={styles.retryText}>다시 시도</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.contentGrid}>
              <View style={styles.calendarPanel}>
                <View style={styles.calendarTitleRow}>
                  <View style={styles.monthBadge}>
                    <Text style={styles.monthLabel}>{currentMonthLabel}</Text>
                  </View>

                  <View style={styles.legend}>
                    <LegendDot color="#22C55E" label="확정" />
                    <LegendDot color="#F59E0B" label="AI 후보" />
                  </View>
                </View>

                <View style={styles.weekdays}>
                  {weekLabels.map((label) => (
                    <Text key={label} style={styles.weekdayText}>{label}</Text>
                  ))}
                </View>

                <View style={styles.calendarGrid}>
                  {calendarDays.map((day) => (
                    <Pressable
                      key={day.dateKey}
                      onPress={() => selectDate(day)}
                      style={[
                        styles.dayCell,
                        {
                          height: layout.calendarCellHeight,
                          width: `${100 / 7}%`,
                        },
                        day.muted && styles.dayCellMuted,
                        day.isToday && styles.dayCellToday,
                        day.dateKey === selectedDateKey && styles.dayCellSelected,
                      ]}>
                      <View style={styles.dayHeader}>
                        <Text
                          style={[
                            styles.dayNumber,
                            day.muted && styles.dayNumberMuted,
                            day.isToday && styles.dayNumberToday,
                            day.dateKey === selectedDateKey && styles.dayNumberSelected,
                          ]}>
                          {day.label}
                        </Text>
                        {(day.hasConfirmedSchedule || day.hasPendingSchedule) ? (
                          <View style={styles.dayDots}>
                            {day.hasConfirmedSchedule ? <View style={[styles.dayDot, styles.confirmedDot]} /> : null}
                            {day.hasPendingSchedule ? <View style={[styles.dayDot, styles.pendingDot]} /> : null}
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.dayItems}>
                        {day.schedules.slice(0, 3).map((item) => (
                          <SchedulePill key={`${day.dateKey}-${item.id}`} item={item} />
                        ))}
                      </View>

                      {day.schedules.length > 3 ? (
                        <Text style={styles.moreText}>+{day.schedules.length - 3}</Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>

              </View>

              <View style={[styles.sidePanel, { width: layout.sideWidth }]}>
                <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.sideScroll}>
                  <View style={styles.sideSection}>
                    <View style={styles.sideHeading}>
                      <View>
                        <Text style={styles.sideEyebrow}>선택한 날짜</Text>
                        <Text style={styles.sideTitle}>{formatDateLabel(selectedDateKey)}</Text>
                      </View>
                      <View style={styles.sideCount}>
                        <Text style={styles.sideCountText}>{selectedSchedules.length}</Text>
                      </View>
                    </View>

                    {selectedSchedules.length > 0 ? (
                      <View style={styles.scheduleList}>
                        {selectedSchedules.map((item) => (
                          <ScheduleRow
                            key={`selected-${item.id}`}
                            item={item}
                            onConfirm={() => updateScheduleStatus(item, 'confirmed')}
                            onIgnore={() => updateScheduleStatus(item, 'ignored')}
                            onOpenWorkspace={() => openWorkspace(item)}
                          />
                        ))}
                      </View>
                    ) : (
                      <EmptySchedule icon="event-busy" text="등록된 일정이 없습니다." />
                    )}
                  </View>

                  <View style={styles.sideDivider} />

                  <View style={styles.sideSection}>
                    <View style={styles.sideHeading}>
                      <View>
                        <Text style={styles.sideEyebrow}>AI가 찾은 일정</Text>
                        <Text style={styles.sideTitle}>확인 대기</Text>
                      </View>
                      <View style={styles.sideCountDark}>
                        <Text style={styles.sideCountDarkText}>{pendingSchedules.length}</Text>
                      </View>
                    </View>

                    {pendingSchedules.length > 0 ? (
                      <View style={styles.compactList}>
                        {pendingSchedules.slice(0, 5).map((item) => (
                          <Pressable
                            key={`pending-${item.id}`}
                            onPress={() => {
                              setSelectedDateKey(item.dateKey);
                              const date = parseDateKey(item.dateKey);
                              setActiveMonthDate(new Date(date.getFullYear(), date.getMonth(), 1));
                            }}
                            style={styles.pendingRow}>
                            <View style={styles.pendingMarker} />
                            <View style={styles.pendingBody}>
                              <Text numberOfLines={1} style={styles.pendingTitle}>{item.title}</Text>
                              <Text numberOfLines={1} style={styles.pendingMeta}>
                                {formatDateLabel(item.dateKey)} · {item.time || '시간 없음'}
                              </Text>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <EmptySchedule icon="done-all" text="모든 일정을 확인했습니다." />
                    )}
                  </View>
                </ScrollView>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

function buildCalendarDays(activeMonthDate: Date, todayKey: string, visibleSchedules: ScheduleItem[]): CalendarDay[] {
  const year = activeMonthDate.getFullYear();
  const month = activeMonthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const prevLastDay = new Date(year, month, 0);
  const leadingCount = firstDay.getDay();
  const trailingCount = 6 - lastDay.getDay();
  const days: CalendarDay[] = [];

  const schedulesByDate = visibleSchedules.reduce<Record<string, ScheduleItem[]>>((acc, item) => {
    acc[item.dateKey] = [...(acc[item.dateKey] || []), item];
    return acc;
  }, {});

  const addDay = (date: Date, label: number, muted: boolean) => {
    const dateKey = formatDateKey(date);
    const schedules = schedulesByDate[dateKey] || [];
    days.push({
      dateKey,
      hasConfirmedSchedule: schedules.some((item) => item.status === 'confirmed'),
      hasPendingSchedule: schedules.some((item) => item.status === 'pending'),
      isToday: dateKey === todayKey,
      label,
      muted,
      schedules,
    });
  };

  for (let index = leadingCount - 1; index >= 0; index -= 1) {
    const label = prevLastDay.getDate() - index;
    addDay(new Date(year, month - 1, label), label, true);
  }

  for (let label = 1; label <= lastDay.getDate(); label += 1) {
    addDay(new Date(year, month, label), label, false);
  }

  for (let label = 1; label <= trailingCount; label += 1) {
    addDay(new Date(year, month + 1, label), label, true);
  }

  return days;
}

function RailIcon({
  active,
  name,
  onPress,
}: {
  active?: boolean;
  name: keyof typeof MaterialIcons.glyphMap;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.railIconButton, active && styles.railIconButtonActive]}>
      <MaterialIcons name={name} size={28} color="#FFFFFF" />
    </Pressable>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function SchedulePill({ item }: { item: ScheduleItem }) {
  return (
    <View style={[styles.schedulePill, item.status === 'pending' ? styles.schedulePillPending : styles.schedulePillConfirmed]}>
      <Text numberOfLines={1} style={styles.schedulePillTitle}>{item.title}</Text>
      {item.time ? <Text numberOfLines={1} style={styles.schedulePillTime}>{item.time}</Text> : null}
    </View>
  );
}

function ScheduleRow({
  item,
  onConfirm,
  onIgnore,
  onOpenWorkspace,
}: {
  item: ScheduleItem;
  onConfirm: () => void;
  onIgnore: () => void;
  onOpenWorkspace?: () => void;
}) {
  const isPending = item.status === 'pending';
  const icon = getScheduleTypeIcon(item.type) as keyof typeof MaterialIcons.glyphMap;

  return (
    <View style={[styles.scheduleRow, isPending && styles.scheduleRowPending]}>
      <View style={styles.scheduleRowTop}>
        <View style={styles.typeChip}>
          <MaterialIcons name={icon} size={14} color="#2563EB" />
          <Text style={styles.typeChipText}>{getScheduleTypeLabel(item.type)}</Text>
        </View>
        <Text style={styles.statusLabel}>{getScheduleStatusLabel(item.status)}</Text>
      </View>

      <Text numberOfLines={2} style={styles.scheduleTitle}>{item.title}</Text>
      <View style={styles.scheduleMeta}>
        <MaterialIcons name="schedule" size={14} color="#71717A" />
        <Text style={styles.scheduleMetaText}>{item.time || '시간 없음'}</Text>
      </View>

      {item.note ? <Text numberOfLines={2} style={styles.scheduleNote}>{item.note}</Text> : null}
      {item.sourceText ? <Text numberOfLines={3} style={styles.sourceText}>{item.sourceText}</Text> : null}

      {isPending ? (
        <View style={styles.scheduleActions}>
          <Pressable onPress={onConfirm} style={styles.confirmButton}>
            <Text style={styles.confirmButtonText}>확정</Text>
          </Pressable>
          <Pressable onPress={onIgnore} style={styles.ghostButton}>
            <Text style={styles.ghostButtonText}>무시</Text>
          </Pressable>
        </View>
      ) : null}

      {item.workspaceFileId ? (
        <View style={[styles.scheduleActions, isPending ? { marginTop: 8 } : undefined]}>
          <Pressable onPress={onOpenWorkspace} style={styles.workspaceButton}>
            <Text style={styles.workspaceButtonText}>워크스페이스 열기</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function EmptySchedule({
  icon,
  text,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.emptySchedule}>
      <MaterialIcons name={icon} size={24} color="#A9B3BF" />
      <Text style={styles.emptyScheduleText}>{text}</Text>
    </View>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const shadow: StyleProp<ViewStyle> = {
  shadowColor: '#181C23',
  shadowOffset: { width: 0, height: 18 },
  shadowOpacity: 0.045,
  shadowRadius: 34,
};

const styles = StyleSheet.create({
  app: {
    flex: 1,
    flexDirection: 'row',
    paddingBottom: 5,
    paddingLeft: 4,
    paddingRight: 20,
    paddingTop: 5,
  },
  calendarGrid: {
    borderColor: '#EEF1F6',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  calendarPanel: {
    ...StyleSheet.flatten(shadow),
    backgroundColor: '#FFFFFF',
    borderColor: '#F1EDF4',
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 20,
    position: 'relative',
  },
  calendarTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  compactList: {
    gap: 10,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  workspaceButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 18,
    alignSelf: 'flex-start',
  },
  workspaceButtonText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  confirmedDot: {
    backgroundColor: '#22C55E',
  },
  contentGrid: {
    alignItems: 'stretch',
    flex: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 0,
  },
  dayCell: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderColor: '#EEF1F6',
    borderRightWidth: 1,
    padding: 10,
  },
  dayCellMuted: {
    backgroundColor: '#FAFBFD',
  },
  dayCellSelected: {
    backgroundColor: '#F5F7FF',
  },
  dayCellToday: {
    backgroundColor: '#FFFBEF',
  },
  dayDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dayDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dayHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayItems: {
    gap: 5,
    marginTop: 8,
  },
  dayNumber: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 13,
    fontWeight: 'normal',
  },
  dayNumberMuted: {
    color: '#B3B8C3',
  },
  dayNumberSelected: {
    color: '#355CFF',
  },
  dayNumberToday: {
    color: '#B45309',
  },
  emptySchedule: {
    alignItems: 'center',
    borderColor: '#EEF1F6',
    borderRadius: 16,
    borderWidth: 1,
    gap: 9,
    justifyContent: 'center',
    minHeight: 118,
    padding: 20,
  },
  emptyScheduleText: {
    color: '#8A8F98',
    fontFamily: FontFamily.semiBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  ghostButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E7EF',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  ghostButtonText: {
    color: '#60646C',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  legendText: {
    color: '#6B7280',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  logo: {
    resizeMode: 'cover',
  },
  monthBadge: {
    alignItems: 'center',
    backgroundColor: '#F7F8FB',
    borderColor: '#EEF1F6',
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  monthButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  monthControls: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    flexDirection: 'row',
    height: 48,
    paddingHorizontal: 3,
  },
  monthLabel: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 20,
    fontWeight: 'normal',
  },
  moreText: {
    color: '#8A8F98',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
    marginTop: 4,
  },
  pageContent: {
    flexGrow: 1,
  },
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  pageShell: {
    backgroundColor: '#F6F7FA',
    flex: 1,
    overflow: 'hidden',
  },
  pendingBody: {
    flex: 1,
    minWidth: 0,
  },
  pendingDot: {
    backgroundColor: '#F59E0B',
  },
  pendingMarker: {
    backgroundColor: '#F59E0B',
    borderRadius: 4,
    height: 38,
    width: 4,
  },
  pendingMeta: {
    color: '#8A8F98',
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
    marginTop: 5,
  },
  pendingRow: {
    alignItems: 'center',
    backgroundColor: '#F8F9FC',
    borderColor: '#EEF1F6',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 64,
    paddingHorizontal: 13,
  },
  pendingTitle: {
    color: '#27272A',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  rail: {
    alignItems: 'center',
    backgroundColor: '#050506',
    paddingBottom: 24,
    paddingTop: 28,
  },
  railIconButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  railIconButtonActive: {
    backgroundColor: '#27282E',
  },
  railNav: {
    alignItems: 'center',
    gap: 34,
    marginTop: 38,
  },
  retryButton: {
    alignItems: 'center',
    backgroundColor: '#1D1D1F',
    borderRadius: 17,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  retryText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  root: {
    backgroundColor: '#000000',
    flex: 1,
  },
  scheduleActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  scheduleList: {
    gap: 10,
  },
  scheduleMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
  },
  scheduleMetaText: {
    color: '#71717A',
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
  },
  scheduleNote: {
    color: '#71717A',
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    marginTop: 8,
  },
  schedulePill: {
    borderRadius: 8,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  schedulePillConfirmed: {
    backgroundColor: '#DCFCE7',
  },
  schedulePillPending: {
    backgroundColor: '#FEF3C7',
  },
  schedulePillTime: {
    color: '#71717A',
    fontFamily: FontFamily.semiBold,
    fontSize: 9,
    fontWeight: 'normal',
    marginTop: 1,
  },
  schedulePillTitle: {
    color: '#27272A',
    fontFamily: FontFamily.extraBold,
    fontSize: 10,
    fontWeight: 'normal',
  },
  scheduleRow: {
    backgroundColor: '#F8F9FC',
    borderColor: '#EEF1F6',
    borderRadius: 16,
    borderWidth: 1,
    padding: 15,
  },
  scheduleRowPending: {
    backgroundColor: '#FFF4C7',
    borderColor: '#F6D884',
  },
  scheduleRowTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  scheduleTitle: {
    color: '#27272A',
    fontFamily: FontFamily.black,
    fontSize: 16,
    fontWeight: 'normal',
    lineHeight: 22,
  },
  sideCount: {
    alignItems: 'center',
    backgroundColor: '#F0F3F9',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    minWidth: 28,
    paddingHorizontal: 8,
  },
  sideCountDark: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    minWidth: 28,
    paddingHorizontal: 8,
  },
  sideCountDarkText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sideCountText: {
    color: '#1D1D1F',
    fontFamily: FontFamily.extraBold,
    fontSize: 13,
    fontWeight: 'normal',
  },
  sideDivider: {
    backgroundColor: '#EEF1F6',
    height: 1,
    marginVertical: 20,
  },
  sideEyebrow: {
    color: '#A1A1AA',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
    marginBottom: 4,
  },
  sideHeading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sidePanel: {
    ...StyleSheet.flatten(shadow),
    backgroundColor: '#FFFFFF',
    borderColor: '#F1EDF4',
    borderRadius: 24,
    borderWidth: 1,
    minWidth: 0,
  },
  sideScroll: {
    padding: 20,
  },
  sideSection: {
    minWidth: 0,
  },
  sideTitle: {
    color: '#18181B',
    fontFamily: FontFamily.black,
    fontSize: 18,
    fontWeight: 'normal',
    lineHeight: 24,
  },
  sourceText: {
    backgroundColor: 'rgba(255,255,255,0.54)',
    borderLeftColor: '#D4D4D8',
    borderLeftWidth: 3,
    borderRadius: 10,
    color: '#52525B',
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 18,
    marginTop: 10,
    padding: 10,
  },
  statusBanner: {
    alignItems: 'center',
    backgroundColor: '#FFF6F0',
    borderColor: '#FFD8C2',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusLabel: {
    color: '#A1A1AA',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
  },
  statusText: {
    color: '#A33B00',
    flex: 1,
    fontFamily: FontFamily.semiBold,
    fontSize: 12,
    fontWeight: 'normal',
    lineHeight: 17,
  },
  titleMeta: {
    color: '#8A8F98',
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
    fontWeight: 'normal',
    marginTop: 4,
  },
  title: {
    color: '#1D1D1F',
    fontFamily: FontFamily.black,
    fontSize: 38,
    fontWeight: 'normal',
    lineHeight: 44,
  },
  titleBlock: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 14,
    minWidth: 0,
  },
  todayButton: {
    alignItems: 'center',
    backgroundColor: '#111318',
    borderRadius: 24,
    flexDirection: 'row',
    gap: 7,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 17,
  },
  todayText: {
    color: '#FFFFFF',
    fontFamily: FontFamily.extraBold,
    fontSize: 14,
    fontWeight: 'normal',
  },
  typeChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 8,
  },
  typeChipText: {
    color: '#2563EB',
    fontFamily: FontFamily.extraBold,
    fontSize: 11,
    fontWeight: 'normal',
  },
  weekdays: {
    flexDirection: 'row',
    gap: 0,
    marginBottom: 8,
  },
  weekdayText: {
    color: '#8A8F98',
    flex: 1,
    fontFamily: FontFamily.extraBold,
    fontSize: 12,
    fontWeight: 'normal',
    textAlign: 'center',
  },
});
