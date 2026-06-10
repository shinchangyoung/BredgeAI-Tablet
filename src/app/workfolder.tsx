import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
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
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspaceFile,
  deleteWorkspaceFolder,
  getWorkspaceApiBaseUrl,
  getWorkspaceTree,
  updateWorkspaceFile,
  updateWorkspaceFolder,
  type WorkspaceFileNode,
  type WorkspaceFolderNode,
  type WorkspaceNode,
} from '@/lib/workspace-api';

type ViewMode = 'list' | 'grid';
type SortType = 'latest' | 'title';
type Folder = {
  color?: string;
  id: string;
  isDefaultFolder?: boolean;
  name: string;
  count: number;
};
type WorkItem = {
  id: string;
  name: string;
  type: 'file' | 'folder';
  tag: string;
  folder: string;
  folderId?: string;
  date: string;
  fileKind?: string;
  sourceCount: number;
  color: string;
  starred?: boolean;
};

type EditableWorkspaceItem = {
  color: string;
  fileKind?: string;
  id: string;
  name: string;
  tag?: string;
  type: 'file' | 'folder';
};

type LoadMode = 'initial' | 'refresh';
type CreateModalMode = 'file' | 'folder' | null;

const fileTags = ['수업', '회의', '프로젝트', '개인', '중요'];
const themeColors = ['#3B82F6', '#8B5CF6', '#2DD4BF', '#F59E0B', '#EF4444'];
const DEFAULT_FILE_ICON = 'article';
const GRID_COLUMN_COUNT = 3;
const GRID_GAP = 14;
const GRID_CARD_WIDTH_RATIO = 0.31;
const GRID_CARD_ASPECT_RATIO = 1.22;

function isDefaultFolderName(name?: string) {
  return name === '기본폴더' || name === '기본파일';
}

function buildWorkspaceData(tree: WorkspaceNode[]) {
  const folders: Folder[] = [];
  const items: WorkItem[] = [];

  const countFiles = (nodes: WorkspaceNode[] = []): number =>
    nodes.reduce((count, node) => {
      if (node.type === 'file') return count + 1;
      return count + countFiles(node.children ?? []);
    }, 0);

  const visit = (nodes: WorkspaceNode[] = [], parentFolder?: WorkspaceFolderNode) => {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        folders.push({
          color: node.color,
          id: node.id,
          isDefaultFolder: node.isDefaultFolder || isDefaultFolderName(node.name),
          name: node.name || '새 폴더',
          count: countFiles(node.children ?? []),
        });
        visit(node.children ?? [], node);
        return;
      }

      items.push(toWorkItem(node, parentFolder));
    });
  };

  visit(tree);
  return { folders, items };
}

function toWorkItem(node: WorkspaceFileNode, parentFolder?: WorkspaceFolderNode): WorkItem {
  const sourceCount = (node.attachments?.length ?? 0) + (node.recordings?.length ?? 0);
  const tag = node.tag || (node.fileKind === 'meeting' ? '회의' : '수업');

  return {
    id: node.id,
    name: node.name || '새 파일',
    type: 'file',
    fileKind: node.fileKind || (tag === '회의' ? 'meeting' : 'lecture'),
    tag,
    folder: parentFolder?.name ?? '-',
    folderId: parentFolder?.id,
    date: node.date || '',
    sourceCount,
    color: node.color || (tag === '회의' ? '#2DD4BF' : '#3B82F6'),
  };
}

export default function WorkfolderScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortType, setSortType] = useState<SortType>('latest');
  const [activeFolderId, setActiveFolderId] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [workspaceTree, setWorkspaceTree] = useState<WorkspaceNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createModalMode, setCreateModalMode] = useState<CreateModalMode>(null);
  const [createName, setCreateName] = useState('');
  const [selectedTag, setSelectedTag] = useState('수업');
  const [customTag, setCustomTag] = useState('');
  const [selectedColor, setSelectedColor] = useState(themeColors[0]);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isCreatingFolderInline, setIsCreatingFolderInline] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState('');
  const [isSubmittingFolderCreate, setIsSubmittingFolderCreate] = useState(false);
  const folderCreateCommittedRef = useRef(false);
  const [editingItem, setEditingItem] = useState<EditableWorkspaceItem | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingTag, setEditingTag] = useState(fileTags[0]);
  const [editingCustomTag, setEditingCustomTag] = useState('');
  const [editingColor, setEditingColor] = useState(themeColors[0]);
  const [isEditingCustomTagOpen, setIsEditingCustomTagOpen] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const layout = useMemo(() => {
    const railWidth = clamp(width * 0.052, 72, 88);
    const shellGap = clamp(width * 0.014, 16, 24);
    const sidebarWidth = clamp(width * 0.16, 230, 300);
    const mainPadding = clamp(width * 0.034, 40, 64);
    const contentWidth = width - 24 - railWidth - shellGap - sidebarWidth - 18 - mainPadding * 2;
    const maxGridCardWidth = (contentWidth - GRID_GAP * (GRID_COLUMN_COUNT - 1)) / GRID_COLUMN_COUNT;
    const gridCardWidth = clamp(contentWidth * GRID_CARD_WIDTH_RATIO, 220, maxGridCardWidth);
    const gridCardHeight = gridCardWidth / GRID_CARD_ASPECT_RATIO;
    return { railWidth, shellGap, sidebarWidth, mainPadding, gridCardWidth, gridCardHeight };
  }, [width]);

  const gridCardSizeStyle = useMemo(
    () => ({
      height: layout.gridCardHeight,
      width: layout.gridCardWidth,
    }),
    [layout.gridCardHeight, layout.gridCardWidth],
  );

  const workspaceData = useMemo(() => buildWorkspaceData(workspaceTree), [workspaceTree]);
  const folders = workspaceData.folders;
  const workItems = workspaceData.items;
  const apiBaseUrl = getWorkspaceApiBaseUrl();
  const defaultFolderId = useMemo(() => findDefaultFolderId(workspaceTree), [workspaceTree]);
  const activeFolder = folders.find((folder) => folder.id === activeFolderId);
  const title =
    activeFolderId === 'all'
      ? '전체 파일'
      : activeFolderId === 'favorite'
        ? '즐겨찾기'
        : activeFolder?.name ?? '전체 파일';

  const filteredItems = useMemo(() => {
    const base = (() => {
      if (activeFolderId === 'all') return workItems;
      if (activeFolderId === 'favorite') return workItems.filter((item) => item.starred);
      return workItems.filter((item) => item.folderId === activeFolderId);
    })();

    return [...base].sort((a, b) => {
      if (sortType === 'title') return a.name.localeCompare(b.name, 'ko-KR');
      return b.date.localeCompare(a.date, 'ko-KR');
    });
  }, [activeFolderId, sortType, workItems]);

  const loadWorkspace = useCallback(async (mode: LoadMode = 'initial') => {
    try {
      if (mode === 'refresh') setIsRefreshing(true);
      else setIsLoading(true);

      setErrorMessage(null);
      const tree = await getWorkspaceTree();
      setWorkspaceTree(tree);
      setSelectedIds(new Set());
    } catch (error) {
      const message = error instanceof Error ? error.message : '워크스페이스 목록을 불러오지 못했습니다.';
      setErrorMessage(`${message} API 주소: ${apiBaseUrl}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiBaseUrl]);

  useFocusEffect(
    useCallback(() => {
      loadWorkspace();
    }, [loadWorkspace])
  );

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('globalRefresh', () => {
      loadWorkspace();
    });
    
    return () => subscription.remove();
  }, [loadWorkspace]);

  useEffect(() => {
    if (activeFolderId === 'all' || activeFolderId === 'favorite') return;
    if (!folders.some((folder) => folder.id === activeFolderId)) {
      setActiveFolderId('all');
    }
  }, [activeFolderId, folders]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openWorkspaceItem = (item: WorkItem) => {
    router.push(`/workspace?sessionId=${encodeURIComponent(item.id)}`);
  };

  const openFileEditModal = (item: WorkItem) => {
    const nextTag = item.tag || (item.fileKind === 'meeting' ? '회의' : '수업');
    const isCustomTag = !fileTags.includes(nextTag);

    setEditingItem({
      color: item.color,
      fileKind: item.fileKind,
      id: item.id,
      name: item.name,
      tag: nextTag,
      type: 'file',
    });
    setEditingName(item.name);
    setEditingTag(isCustomTag ? fileTags[0] : nextTag);
    setEditingCustomTag(isCustomTag ? nextTag : '');
    setEditingColor(item.color);
    setIsEditingCustomTagOpen(isCustomTag);
  };

  const openFolderEditModal = (folder: Folder) => {
    if (folder.isDefaultFolder || isDefaultFolderName(folder.name)) return;

    setEditingItem({
      color: folder.color || themeColors[0],
      id: folder.id,
      name: folder.name,
      type: 'folder',
    });
    setEditingName(folder.name);
    setEditingTag(fileTags[0]);
    setEditingCustomTag('');
    setEditingColor(folder.color || themeColors[0]);
    setIsEditingCustomTagOpen(false);
  };

  const openCreateModal = (mode: Exclude<CreateModalMode, null>) => {
    setCreateModalMode(mode);
    setCreateName('');
    setCustomTag('');
    setSelectedTag('수업');
    setSelectedColor(mode === 'folder' ? '#3B82F6' : themeColors[0]);
  };

  const closeCreateModal = () => {
    if (isSubmittingCreate) return;
    setCreateModalMode(null);
    setCreateName('');
    setCustomTag('');
  };

  const startInlineFolderCreate = () => {
    if (isSubmittingFolderCreate) return;

    folderCreateCommittedRef.current = false;
    setDraftFolderName('');
    setIsCreatingFolderInline(true);
  };

  const cancelInlineFolderCreate = () => {
    if (isSubmittingFolderCreate) return;

    folderCreateCommittedRef.current = true;
    setDraftFolderName('');
    setIsCreatingFolderInline(false);
  };

  const commitInlineFolderCreate = async () => {
    if (!isCreatingFolderInline || isSubmittingFolderCreate || folderCreateCommittedRef.current) return;

    const titleValue = draftFolderName.trim();
    folderCreateCommittedRef.current = true;
    setIsCreatingFolderInline(false);
    setDraftFolderName('');

    if (!titleValue) {
      folderCreateCommittedRef.current = false;
      return;
    }

    setIsSubmittingFolderCreate(true);
    try {
      await createWorkspaceFolder({
        color: themeColors[0],
        icon: 'folder',
        parent_course_id: null,
        title: titleValue,
      });
      await loadWorkspace('refresh');
    } catch (error) {
      const message = error instanceof Error ? error.message : '폴더를 만들지 못했습니다.';
      Alert.alert('폴더 생성 실패', message);
    } finally {
      setIsSubmittingFolderCreate(false);
      folderCreateCommittedRef.current = false;
    }
  };

  const closeEditModal = (force = false) => {
    if (isSubmittingEdit && !force) return;

    setEditingItem(null);
    setEditingName('');
    setEditingTag(fileTags[0]);
    setEditingCustomTag('');
    setEditingColor(themeColors[0]);
    setIsEditingCustomTagOpen(false);
  };

  const selectEditingTag = (tag: string) => {
    setEditingTag(tag);
    setEditingCustomTag('');
    setIsEditingCustomTagOpen(false);
  };

  const updateEditingCustomTag = (tag: string) => {
    setEditingCustomTag(tag);
    if (tag.trim()) {
      setEditingTag(tag.trim());
    }
  };

  const submitEdit = async () => {
    if (!editingItem) return;

    const titleValue = editingName.trim();
    if (!titleValue) {
      Alert.alert('이름이 필요해요', editingItem.type === 'folder' ? '폴더 이름을 입력해 주세요.' : '파일 이름을 입력해 주세요.');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      if (editingItem.type === 'folder') {
        await updateWorkspaceFolder(editingItem.id, {
          color: editingColor,
          icon: 'folder',
          title: titleValue,
        });
      } else {
        const tag = editingCustomTag.trim() || editingTag.trim() || fileTags[0];
        await updateWorkspaceFile(editingItem.id, {
          color: editingColor,
          file_kind: tag === '회의' ? 'meeting' : editingItem.fileKind || 'lecture',
          icon: DEFAULT_FILE_ICON,
          tag,
          title: titleValue,
        });
      }

      closeEditModal(true);
      await loadWorkspace('refresh');
    } catch (error) {
      const message = error instanceof Error ? error.message : '정보를 수정하지 못했습니다.';
      Alert.alert('수정 실패', message);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const deleteEditingItem = async () => {
    if (!editingItem) return;

    setIsSubmittingEdit(true);
    try {
      if (editingItem.type === 'folder') {
        await deleteWorkspaceFolder(editingItem.id);
        if (activeFolderId === editingItem.id) {
          setActiveFolderId('all');
        }
      } else {
        await deleteWorkspaceFile(editingItem.id);
      }

      closeEditModal(true);
      await loadWorkspace('refresh');
    } catch (error) {
      const message = error instanceof Error ? error.message : '삭제하지 못했습니다.';
      Alert.alert('삭제 실패', message);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const submitCreate = async () => {
    const titleValue = createName.trim();
    if (!titleValue) {
      Alert.alert(
        '이름이 필요해요',
        createModalMode === 'folder' ? '폴더 이름을 입력해 주세요.' : '파일 이름을 입력해 주세요.',
      );
      return;
    }

    setIsSubmittingCreate(true);
    try {
      if (createModalMode === 'folder') {
        const parentFolderId = isRealWorkspaceId(activeFolderId) ? activeFolderId : null;
        const folder = await createWorkspaceFolder({
          color: selectedColor,
          icon: 'folder',
          parent_course_id: parentFolderId,
          title: titleValue,
        });

        setCreateModalMode(null);
        setActiveFolderId(folder.id);
        await loadWorkspace('refresh');
        return;
      }

      if (createModalMode === 'file') {
        const tag = customTag.trim() || selectedTag;
        const targetFolderId = isRealWorkspaceId(activeFolderId) ? activeFolderId : defaultFolderId;
        const file = await createWorkspaceFile({
          color: selectedColor,
          course_id: targetFolderId,
          file_kind: tag === '회의' ? 'meeting' : 'lecture',
          icon: DEFAULT_FILE_ICON,
          tag,
          title: titleValue,
        });

        setCreateModalMode(null);
        await loadWorkspace('refresh');
        router.push(`/workspace?sessionId=${encodeURIComponent(file.id)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '저장에 실패했습니다.';
      Alert.alert('저장 실패', message);
    } finally {
      setIsSubmittingCreate(false);
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
            <RailIcon name="add" onPress={() => openCreateModal('file')} />
            <RailIcon name="folder-open" active />
            <RailIcon name="calendar-today" onPress={() => router.push('/calendar')} />
          </View>
        </View>

        <View style={[styles.sidebar, { width: layout.sidebarWidth }]}>
          <View style={styles.sidebarInner}>
            <SidebarItem
              icon="article"
              label="전체 파일"
              active={activeFolderId === 'all'}
              onPress={() => setActiveFolderId('all')}
            />
            <SidebarItem
              icon="star"
              label="즐겨찾기"
              active={activeFolderId === 'favorite'}
              onPress={() => setActiveFolderId('favorite')}
            />

            <View style={styles.folderHeader}>
              <Text style={styles.folderHeaderText}>폴더</Text>
              <Pressable onPress={startInlineFolderCreate} style={styles.folderAddButton}>
                <MaterialIcons name="add" size={20} color="#F7F7F8" />
              </Pressable>
            </View>

            <View style={styles.folderList}>
              {isCreatingFolderInline && (
                <View style={styles.folderCreateRow}>
                  <MaterialIcons name="folder" size={20} color="rgba(255,255,255,0.86)" />
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    editable={!isSubmittingFolderCreate}
                    onBlur={() => {
                      void commitInlineFolderCreate();
                    }}
                    onChangeText={setDraftFolderName}
                    onSubmitEditing={() => {
                      void commitInlineFolderCreate();
                    }}
                    placeholder="폴더 이름"
                    placeholderTextColor="rgba(247,247,248,0.62)"
                    returnKeyType="done"
                    style={styles.folderCreateInput}
                    value={draftFolderName}
                  />
                  <Pressable
                    onPress={cancelInlineFolderCreate}
                    onPressIn={cancelInlineFolderCreate}
                    style={styles.folderCreateCancelButton}>
                    <MaterialIcons name="close" size={18} color="rgba(255,255,255,0.72)" />
                  </Pressable>
                </View>
              )}

              {folders.map((folder) => (
                <Pressable
                  key={folder.id}
                  onPress={() => setActiveFolderId(folder.id)}
                  style={[
                    styles.folderItem,
                    activeFolderId === folder.id && styles.folderItemActive,
                  ]}>
                  <MaterialIcons name="folder" size={20} color="rgba(255,255,255,0.86)" />
                  <Text numberOfLines={1} style={styles.folderName}>
                    {folder.name}
                  </Text>
                  <Text style={styles.folderCount}>{folder.count}</Text>
                  {!folder.isDefaultFolder && !isDefaultFolderName(folder.name) && activeFolderId === folder.id ? (
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation();
                        openFolderEditModal(folder);
                      }}
                      style={styles.folderMoreButton}>
                      <MaterialIcons name="more-horiz" size={19} color="rgba(255,255,255,0.56)" />
                    </Pressable>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.mainShell}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                tintColor="#1D1D1F"
                onRefresh={() => loadWorkspace('refresh')}
              />
            }
            contentContainerStyle={[styles.mainContent, { padding: layout.mainPadding }]}>
            <View style={styles.pageHeader}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>
                  {filteredItems.length}개 항목 · DB 세션 데이터
                </Text>
              </View>

              <View style={styles.topbar}>
                <View style={styles.viewSegment}>
                  <ToolIcon
                    icon="grid-view"
                    active={viewMode === 'grid'}
                    onPress={() => setViewMode('grid')}
                  />
                  <ToolIcon
                    icon="view-list"
                    active={viewMode === 'list'}
                    onPress={() => setViewMode('list')}
                  />
                </View>

                <Pressable
                  onPress={() => setSortType((value) => (value === 'latest' ? 'title' : 'latest'))}
                  style={styles.sortButton}>
                  <Text style={styles.sortText}>{sortType === 'latest' ? '최신 항목' : '제목'}</Text>
                  <MaterialIcons name="expand-more" size={18} color="#1D1D1F" />
                </Pressable>

                <Pressable onPress={() => openCreateModal('file')} style={styles.newFileButton}>
                  <MaterialIcons name="add" size={19} color="#FFFFFF" />
                  <Text style={styles.newFileText}>새 파일</Text>
                </Pressable>

              </View>
            </View>

            {errorMessage ? (
              <View style={styles.statusBanner}>
                <MaterialIcons name="info-outline" size={18} color="#D9480F" />
                <Text style={styles.statusText}>{errorMessage}</Text>
                <Pressable onPress={() => loadWorkspace('refresh')} style={styles.retryButton}>
                  <Text style={styles.retryText}>다시 시도</Text>
                </Pressable>
              </View>
            ) : null}

            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color="#1D1D1F" />
              </View>
            ) : viewMode === 'list' ? (
              <View style={styles.listShell}>
                <View style={styles.listHead}>
                  <Text style={[styles.headText, styles.headMain]}>파일 이름</Text>
                  <Text style={[styles.headText, styles.headSource]}>소스</Text>
                  <Text style={[styles.headText, styles.headFolder]}>폴더 위치</Text>
                  <Text style={[styles.headText, styles.headDate]}>생성일 ↓</Text>
                </View>

                <View style={styles.rowList}>
                  {filteredItems.length > 0 ? (
                    filteredItems.map((item) => (
                      <WorkRow
                        key={item.id}
                        item={item}
                        selected={selectedIds.has(item.id)}
                        onToggle={() => toggleSelected(item.id)}
                        onOpenEdit={() => openFileEditModal(item)}
                        onOpen={() => openWorkspaceItem(item)}
                      />
                    ))
                  ) : (
                    <EmptyState />
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.gridWrap}>
                <Pressable
                  onPress={() => openCreateModal('file')}
                  style={[styles.createCard, gridCardSizeStyle]}>
                  <View style={styles.createIcon}>
                    <MaterialIcons name="add" size={26} color="#355CFF" />
                  </View>
                  <Text style={styles.createLabel}>새 파일 만들기</Text>
                </Pressable>

                {filteredItems.map((item) => (
                  <WorkGridCard
                    cardStyle={gridCardSizeStyle}
                    key={item.id}
                    item={item}
                    onOpenEdit={() => openFileEditModal(item)}
                    onOpen={() => openWorkspaceItem(item)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      <CreateWorkspaceModal
        customTag={customTag}
        isSubmitting={isSubmittingCreate}
        mode={createModalMode}
        name={createName}
        onChangeCustomTag={setCustomTag}
        onChangeName={setCreateName}
        onClose={closeCreateModal}
        onSelectColor={setSelectedColor}
        onSelectTag={setSelectedTag}
        onSubmit={submitCreate}
        selectedColor={selectedColor}
        selectedTag={selectedTag}
      />

      <EditWorkspaceModal
        customTag={editingCustomTag}
        isCustomTagInputOpen={isEditingCustomTagOpen}
        isSubmitting={isSubmittingEdit}
        item={editingItem}
        name={editingName}
        onChangeCustomTag={updateEditingCustomTag}
        onChangeName={setEditingName}
        onClose={() => closeEditModal()}
        onDelete={deleteEditingItem}
        onSelectColor={setEditingColor}
        onSelectTag={selectEditingTag}
        onSubmit={submitEdit}
        onToggleCustomTag={() => setIsEditingCustomTagOpen((isOpen) => !isOpen)}
        selectedColor={editingColor}
        selectedTag={editingTag}
      />
    </SafeAreaView>
  );
}

function CreateWorkspaceModal({
  customTag,
  isSubmitting,
  mode,
  name,
  onChangeCustomTag,
  onChangeName,
  onClose,
  onSelectColor,
  onSelectTag,
  onSubmit,
  selectedColor,
  selectedTag,
}: {
  customTag: string;
  isSubmitting: boolean;
  mode: CreateModalMode;
  name: string;
  onChangeCustomTag: (value: string) => void;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onSelectColor: (value: string) => void;
  onSelectTag: (value: string) => void;
  onSubmit: () => void;
  selectedColor: string;
  selectedTag: string;
}) {
  const isFileMode = mode === 'file';

  return (
    <Modal animationType="fade" transparent visible={mode !== null} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable style={styles.createModalCard}>
          <Text style={styles.modalTitle}>{isFileMode ? '새 파일 만들기' : '새 폴더 만들기'}</Text>
          <Text style={styles.modalDescription}>
            {isFileMode ? '웹과 같은 DB에 저장되는 세션 파일을 만듭니다.' : '웹과 같은 DB에 저장되는 폴더를 만듭니다.'}
          </Text>

          <Text style={styles.inputLabel}>{isFileMode ? '파일 이름' : '폴더 이름'}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeName}
            placeholder={isFileMode ? '예: 물리학 4주차 - 자기장' : '예: 물리학'}
            placeholderTextColor="#A3A8B2"
            style={styles.textInput}
            value={name}
          />

          {isFileMode ? (
            <>
              <Text style={styles.inputLabel}>태그 선택</Text>
              <View style={styles.chipRow}>
                {fileTags.map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => onSelectTag(tag)}
                    style={[styles.tagChip, selectedTag === tag && styles.tagChipActive]}>
                    <Text style={[styles.tagChipText, selectedTag === tag && styles.tagChipTextActive]}>
                      {tag}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={onChangeCustomTag}
                placeholder="직접 태그 추가"
                placeholderTextColor="#A3A8B2"
                style={styles.textInput}
                value={customTag}
              />
            </>
          ) : null}

          <Text style={styles.inputLabel}>테마 색상</Text>
          <View style={styles.colorRow}>
            {themeColors.map((color) => (
              <Pressable
                key={color}
                onPress={() => onSelectColor(color)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: color },
                  selectedColor === color && styles.colorSwatchActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.modalActions}>
            <Pressable disabled={isSubmitting} onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>취소</Text>
            </Pressable>
            <Pressable disabled={isSubmitting} onPress={onSubmit} style={styles.submitButton}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>생성</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EditWorkspaceModal({
  customTag,
  isCustomTagInputOpen,
  isSubmitting,
  item,
  name,
  onChangeCustomTag,
  onChangeName,
  onClose,
  onDelete,
  onSelectColor,
  onSelectTag,
  onSubmit,
  onToggleCustomTag,
  selectedColor,
  selectedTag,
}: {
  customTag: string;
  isCustomTagInputOpen: boolean;
  isSubmitting: boolean;
  item: EditableWorkspaceItem | null;
  name: string;
  onChangeCustomTag: (value: string) => void;
  onChangeName: (value: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onSelectColor: (value: string) => void;
  onSelectTag: (value: string) => void;
  onSubmit: () => void;
  onToggleCustomTag: () => void;
  selectedColor: string;
  selectedTag: string;
}) {
  const isFileMode = item?.type === 'file';
  const shouldShowCustomTagInput = isCustomTagInputOpen || customTag.trim().length > 0;

  return (
    <Modal animationType="fade" transparent visible={Boolean(item)} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable style={styles.createModalCard}>
          <Text style={styles.modalTitle}>{isFileMode ? '파일 정보 수정' : '폴더 정보 수정'}</Text>
          <Text style={styles.modalDescription}>
            {isFileMode
              ? '이름과 색상을 변경하거나 파일을 삭제할 수 있습니다.'
              : '이름과 색상을 변경하거나 폴더를 삭제할 수 있습니다.'}
          </Text>

          <Text style={styles.inputLabel}>{isFileMode ? '파일 이름' : '폴더 이름'}</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isSubmitting}
            onChangeText={onChangeName}
            placeholder={isFileMode ? '파일 이름 입력' : '폴더 이름 입력'}
            placeholderTextColor="#A3A8B2"
            style={styles.textInput}
            value={name}
          />

          {isFileMode ? (
            <>
              <Text style={styles.inputLabel}>태그</Text>
              <View style={styles.chipRow}>
                {fileTags.map((tag) => (
                  <Pressable
                    disabled={isSubmitting}
                    key={tag}
                    onPress={() => onSelectTag(tag)}
                    style={[styles.tagChip, !customTag && selectedTag === tag && styles.tagChipActive]}>
                    <Text style={[styles.tagChipText, !customTag && selectedTag === tag && styles.tagChipTextActive]}>
                      {tag}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  disabled={isSubmitting}
                  onPress={onToggleCustomTag}
                  style={[styles.tagChip, styles.tagAddChip, shouldShowCustomTagInput && styles.tagChipActive]}>
                  <MaterialIcons name="add" size={18} color={shouldShowCustomTagInput ? '#FFFFFF' : '#6B7280'} />
                </Pressable>
              </View>

              {shouldShowCustomTagInput ? (
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                  onChangeText={onChangeCustomTag}
                  placeholder="직접 태그 입력"
                  placeholderTextColor="#A3A8B2"
                  style={[styles.textInput, styles.compactTextInput]}
                  value={customTag}
                />
              ) : null}
            </>
          ) : null}

          <Text style={styles.inputLabel}>테마 색상</Text>
          <View style={styles.colorRow}>
            {themeColors.map((color) => (
              <Pressable
                disabled={isSubmitting}
                key={color}
                onPress={() => onSelectColor(color)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: color },
                  selectedColor === color && styles.colorSwatchActive,
                ]}
              />
            ))}
          </View>

          <View style={styles.modalActions}>
            <Pressable disabled={isSubmitting} onPress={onClose} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>취소</Text>
            </Pressable>
            <Pressable disabled={isSubmitting} onPress={onDelete} style={styles.deleteButton}>
              <Text style={styles.deleteButtonText}>삭제</Text>
            </Pressable>
            <Pressable disabled={isSubmitting} onPress={onSubmit} style={styles.submitButton}>
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>변경</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function RailIcon({
  name,
  active,
  onPress,
}: {
  name: keyof typeof MaterialIcons.glyphMap;
  active?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.railIconButton, active && styles.railIconButtonActive]}>
      <MaterialIcons name={name} size={28} color="#FFFFFF" />
    </Pressable>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.sidebarItem, active && styles.sidebarItemActive]}>
      <MaterialIcons name={icon} size={20} color="rgba(255,255,255,0.86)" />
      <Text style={styles.sidebarItemText}>{label}</Text>
    </Pressable>
  );
}

function ToolIcon({
  icon,
  active,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.toolIcon, active && styles.toolIconActive]}>
      <MaterialIcons name={icon} size={23} color={active ? '#1D1D1F' : '#5F6571'} />
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <MaterialIcons name="folder-open" size={32} color="#A0A7B3" />
      <Text style={styles.emptyTitle}>표시할 파일이 없습니다.</Text>
      <Text style={styles.emptyDescription}>새 파일을 만들면 여기에 표시됩니다.</Text>
    </View>
  );
}

function WorkRow({
  item,
  selected,
  onOpenEdit,
  onToggle,
  onOpen,
}: {
  item: WorkItem;
  selected: boolean;
  onOpenEdit: () => void;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const icon = item.type === 'folder' ? 'folder' : item.tag === '회의' ? 'groups' : 'article';

  return (
    <Pressable onPress={onOpen} style={[styles.rowCard, selected && styles.rowCardSelected]}>
      <Pressable onPress={onToggle} style={[styles.check, selected && styles.checkSelected]}>
        {selected && <MaterialIcons name="check" size={13} color="#FFFFFF" />}
      </Pressable>

      <MaterialIcons name={item.starred ? 'star' : 'star-border'} size={24} color="#F4B400" />

      <View style={[styles.rowIcon, { backgroundColor: colorWithAlpha(item.color, 0.14) }]}>
        <MaterialIcons name={icon} size={24} color={item.color} />
      </View>

      <View style={styles.rowTitleBlock}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {item.name}
        </Text>
        <Text style={[styles.rowTag, { color: item.color }]}>{item.tag}</Text>
      </View>

      <Text style={styles.rowSource}>소스 {item.sourceCount}개</Text>

      <View style={styles.rowFolder}>
        <MaterialIcons name="folder" size={17} color="#8A8F98" />
        <Text numberOfLines={1} style={styles.rowFolderText}>
          {item.folder}
        </Text>
      </View>

      <Text numberOfLines={1} style={styles.rowDate}>
        {item.date}
      </Text>

      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          onOpenEdit();
        }}
        style={styles.rowMoreButton}>
        <MaterialIcons name="more-horiz" size={22} color="#8A8F98" />
      </Pressable>
    </Pressable>
  );
}

function WorkGridCard({
  cardStyle,
  item,
  onOpenEdit,
  onOpen,
}: {
  cardStyle: { height: number; width: number };
  item: WorkItem;
  onOpenEdit: () => void;
  onOpen: () => void;
}) {
  const icon = item.type === 'folder' ? 'folder' : item.tag === '회의' ? 'groups' : 'article';

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.gridCard,
        cardStyle,
        {
          backgroundColor: colorWithAlpha(item.color, 0.13),
        },
      ]}>
      <View style={styles.gridActions}>
        <MaterialIcons name={item.starred ? 'star' : 'star-border'} size={19} color="#F4B400" />
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            onOpenEdit();
          }}
          style={styles.gridMoreButton}>
          <MaterialIcons name="more-vert" size={19} color="#7D8490" />
        </Pressable>
      </View>

      <View style={[styles.gridIcon, { backgroundColor: 'rgba(255,255,255,0.68)' }]}>
        <MaterialIcons name={icon} size={25} color={item.color} />
      </View>

      <View style={styles.gridBody}>
        <Text numberOfLines={2} style={styles.gridTitle}>
          {item.name}
        </Text>
        <Text numberOfLines={1} style={styles.gridMeta}>
          {item.date} · 소스 {item.sourceCount}개
        </Text>
      </View>

      <View style={styles.gridTag}>
        <Text style={[styles.gridTagText, { color: item.color }]}>{item.tag}</Text>
      </View>
    </Pressable>
  );
}

function findDefaultFolderId(nodes: WorkspaceNode[]): string | null {
  for (const node of nodes) {
    if (node.type === 'folder') {
      if (node.isDefaultFolder) return node.id;
      const childDefaultId = findDefaultFolderId(node.children ?? []);
      if (childDefaultId) return childDefaultId;
    }
  }

  return null;
}

function isRealWorkspaceId(value: string) {
  return Boolean(value) && value !== 'all' && value !== 'favorite';
}

function colorWithAlpha(color: string, alpha: number) {
  const hex = color.replace('#', '');
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  app: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#000000',
    paddingBottom: 5,
    paddingLeft: 4,
    paddingRight: 20,
    paddingTop: 5,
  },
  rail: {
    backgroundColor: '#050506',
    alignItems: 'center',
    paddingTop: 28,
    paddingBottom: 24,
  },
  logo: {
    resizeMode: 'cover',
  },
  railNav: {
    alignItems: 'center',
    gap: 34,
    marginTop: 38,
  },
  railIconButton: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railIconButtonActive: {
    backgroundColor: '#27282E',
  },
  sidebar: {
    backgroundColor: '#050506',
  },
  sidebarInner: {
    flex: 1,
    paddingTop: 28,
    paddingHorizontal: 18,
    paddingBottom: 28,
    gap: 8,
  },
  sidebarItem: {
    height: 52,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  sidebarItemActive: {
    backgroundColor: '#27282E',
  },
  sidebarItemText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 16,
    fontWeight: '900',
  },
  folderHeader: {
    marginTop: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  folderHeaderText: {
    color: 'rgba(255,255,255,0.48)',
    fontSize: 14,
    fontWeight: '900',
  },
  folderAddButton: {
    width: 34,
    height: 34,
    borderRadius: 13,
    backgroundColor: '#27282E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderList: {
    marginTop: 4,
    gap: 8,
  },
  folderCreateRow: {
    height: 52,
    borderRadius: 18,
    backgroundColor: '#27282E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    shadowColor: '#302A3A',
    shadowOpacity: 0.08,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  folderCreateInput: {
    flex: 1,
    minWidth: 0,
    color: '#F7F7F8',
    fontSize: 15,
    fontWeight: '900',
    padding: 0,
  },
  folderCreateCancelButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderItem: {
    height: 52,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  folderItemActive: {
    backgroundColor: '#27282E',
  },
  folderName: {
    flex: 1,
    color: 'rgba(255,255,255,0.86)',
    fontSize: 16,
    fontWeight: '900',
  },
  folderCount: {
    color: 'rgba(255,255,255,0.46)',
    fontSize: 14,
    fontWeight: '900',
  },
  folderMoreButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainShell: {
    flex: 1,
    minWidth: 0,
    marginTop: 18,
    marginRight: 18,
    marginBottom: 18,
    borderRadius: 36,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#302A3A',
    shadowOpacity: 0.05,
    shadowRadius: 34,
    shadowOffset: { width: -10, height: 0 },
  },
  mainContent: {
    minHeight: '100%',
    paddingBottom: 72,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 34,
  },
  topbar: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  viewSegment: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(25,25,31,0.14)',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 3,
    shadowColor: '#1F222B',
    shadowOpacity: 0.05,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
  },
  toolIcon: {
    width: 42,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolIconActive: {
    backgroundColor: '#EDF0FB',
  },
  sortButton: {
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(25,25,31,0.12)',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  sortText: {
    color: '#1D1D1F',
    fontSize: 14,
    fontWeight: '900',
  },
  newFileButton: {
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0F1014',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    shadowColor: '#15161A',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
  },
  newFileText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  bellButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexShrink: 1,
    minWidth: 0,
    paddingTop: 5,
  },
  title: {
    color: '#1D1D1F',
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '900',
  },
  subtitle: {
    color: '#8A8F98',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 8,
  },
  statusBanner: {
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#FFD8C2',
    backgroundColor: '#FFF6F0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 18,
  },
  statusText: {
    flex: 1,
    color: '#A33B00',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
  },
  retryButton: {
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1D1D1F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  loadingBox: {
    minHeight: 240,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EEF1F6',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#8A8F98',
    fontSize: 14,
    fontWeight: '800',
  },
  listShell: {
    gap: 12,
  },
  listHead: {
    height: 50,
    borderRadius: 18,
    backgroundColor: '#F8F9FC',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  headText: {
    color: '#8A8F98',
    fontSize: 14,
    fontWeight: '900',
  },
  headMain: {
    flex: 1.6,
    paddingLeft: 84,
  },
  headSource: {
    flex: 0.45,
  },
  headFolder: {
    flex: 0.65,
  },
  headDate: {
    flex: 0.72,
  },
  rowList: {
    gap: 10,
  },
  emptyState: {
    minHeight: 230,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EEF1F6',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 28,
  },
  emptyTitle: {
    color: '#1D1D1F',
    fontSize: 17,
    fontWeight: '900',
  },
  emptyDescription: {
    color: '#8A8F98',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyCreateButton: {
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F1014',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    marginTop: 4,
  },
  emptyCreateText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
  },
  rowCard: {
    minHeight: 84,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EEF1F6',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 14,
    shadowColor: '#181C23',
    shadowOpacity: 0.035,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  rowCardSelected: {
    borderColor: '#8AA8FF',
    backgroundColor: '#FAFBFF',
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#D6DCE8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: '#355CFF',
    backgroundColor: '#355CFF',
  },
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitleBlock: {
    flex: 1.6,
    minWidth: 0,
  },
  rowTitle: {
    color: '#1D1D1F',
    fontSize: 16,
    fontWeight: '900',
  },
  rowTag: {
    fontSize: 11,
    fontWeight: '900',
    marginTop: 5,
  },
  rowSource: {
    flex: 0.45,
    color: '#5F6571',
    fontSize: 14,
    fontWeight: '900',
  },
  rowFolder: {
    flex: 0.65,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowFolderText: {
    color: '#5F6571',
    fontSize: 14,
    fontWeight: '900',
    minWidth: 0,
    flex: 1,
  },
  rowDate: {
    flex: 0.72,
    color: '#8A8F98',
    fontSize: 14,
    fontWeight: '900',
  },
  rowMoreButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  createCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(207,215,229,0.88)',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    shadowColor: '#181C23',
    shadowOpacity: 0.035,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 18 },
  },
  createIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EEF1FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createLabel: {
    color: '#1D1D1F',
    fontSize: 18,
    fontWeight: '900',
  },
  gridCard: {
    position: 'relative',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.76)',
    padding: 20,
    overflow: 'hidden',
    shadowColor: '#181C23',
    shadowOpacity: 0.05,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 18 },
  },
  gridActions: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  gridMoreButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 'auto',
  },
  gridBody: {
    marginTop: 'auto',
    paddingRight: 16,
  },
  gridTitle: {
    color: '#1D1D1F',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '900',
  },
  gridMeta: {
    color: '#8A8F98',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 8,
  },
  gridTag: {
    marginTop: 12,
    alignSelf: 'flex-start',
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.64)',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  gridTagText: {
    fontSize: 11,
    fontWeight: '900',
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.48)',
    padding: 32,
  },
  createModalCard: {
    width: 420,
    maxWidth: '100%',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 24,
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
  },
  modalTitle: {
    color: '#1D1D1F',
    fontSize: 26,
    fontWeight: '900',
  },
  modalDescription: {
    color: '#7D8490',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  inputLabel: {
    color: '#1D1D1F',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 8,
    marginTop: 12,
  },
  textInput: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DCE2EC',
    color: '#1D1D1F',
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 14,
  },
  compactTextInput: {
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  tagChip: {
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F2F4F8',
    justifyContent: 'center',
    paddingHorizontal: 13,
  },
  tagChipActive: {
    backgroundColor: '#111318',
  },
  tagAddChip: {
    width: 34,
    alignItems: 'center',
    paddingHorizontal: 0,
  },
  tagChipText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '900',
  },
  tagChipTextActive: {
    color: '#FFFFFF',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 12,
  },
  colorSwatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  colorSwatchActive: {
    borderColor: '#111318',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 24,
  },
  cancelButton: {
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '900',
  },
  submitButton: {
    minWidth: 92,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111318',
    paddingHorizontal: 22,
  },
  deleteButton: {
    minWidth: 92,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDE8E8',
    paddingHorizontal: 22,
  },
  deleteButtonText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '900',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
});
