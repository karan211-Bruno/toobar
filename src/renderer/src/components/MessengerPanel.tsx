// Standalone Cross-Platform Toobar Messenger (Text & File Transfer across Mac, iPhone, iPad, Windows, Ubuntu, Android)
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { MessengerConversation, MessengerMessage, MessengerPeer } from '@shared/types';
import {
  cloudBus,
  formatFileSize,
  getPlatformLabel,
  saveOrShareFile,
} from '../cloud-bus';

interface MessengerPanelProps {
  userName: string;
  onUserNameChange?: (name: string) => void;
  onJoinMeetingById?: (meetingId: string) => void;
  embedded?: boolean;
}

export function MessengerPanel({
  userName,
  onUserNameChange,
  onJoinMeetingById,
  embedded = false,
}: MessengerPanelProps) {
  const [conversations, setConversations] = useState<MessengerConversation[]>(() =>
    cloudBus.getConversations()
  );
  const [onlinePeers, setOnlinePeers] = useState<MessengerPeer[]>(() =>
    cloudBus.getOnlinePeers()
  );
  const [activeConvId, setActiveConvId] = useState<string>('public');
  const [messages, setMessages] = useState<MessengerMessage[]>(() =>
    cloudBus.getMessages('public')
  );
  const [isOnline, setIsOnline] = useState<boolean>(() => cloudBus.isOnline());
  const [text, setText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [targetCodeInput, setTargetCodeInput] = useState('');
  const [showAddModal, setShowAddModal] = useState<'dm' | 'room' | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const myIdentity = cloudBus.getMyIdentity();

  const refreshState = useCallback(() => {
    setConversations(cloudBus.getConversations());
    setOnlinePeers(cloudBus.getOnlinePeers());
    setMessages([...cloudBus.getMessages(activeConvId)]);
    setIsOnline(cloudBus.isOnline());
  }, [activeConvId]);

  useEffect(() => {
    cloudBus.start();
    if (userName.trim()) {
      cloudBus.setMyName(userName.trim());
    }
    refreshState();
    cloudBus.markConversationRead(activeConvId);

    const unsubscribe = cloudBus.onMessengerUpdate(() => {
      setConversations(cloudBus.getConversations());
      setOnlinePeers(cloudBus.getOnlinePeers());
      setMessages([...cloudBus.getMessages(activeConvId)]);
      setIsOnline(cloudBus.isOnline());
      cloudBus.markConversationRead(activeConvId);
    });

    return unsubscribe;
  }, [activeConvId, refreshState, userName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeConvId]);

  const handleSelectConversation = (convId: string) => {
    setActiveConvId(convId);
    cloudBus.markConversationRead(convId);
    setMessages([...cloudBus.getMessages(convId)]);
    setMobileShowList(false);
  };

  const handleStartDmWithPeer = (peer: MessengerPeer) => {
    const conv = cloudBus.openDmConversation(peer.userCode, peer.userName);
    handleSelectConversation(conv.id);
  };

  const handleAddDmOrRoom = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = targetCodeInput.trim().toUpperCase();
    if (!cleaned) return;
    if (showAddModal === 'dm') {
      const normalized = cleaned.startsWith('TB-') ? cleaned : `TB-${cleaned}`;
      const conv = cloudBus.openDmConversation(normalized);
      handleSelectConversation(conv.id);
    } else if (showAddModal === 'room') {
      const conv = cloudBus.openRoomConversation(cleaned);
      handleSelectConversation(conv.id);
    }
    setTargetCodeInput('');
    setShowAddModal(null);
  };

  const ensureNameBeforeSend = () => {
    const clean = userName.trim() || myIdentity.userName || '사용자';
    cloudBus.setMyName(clean);
    onUserNameChange?.(clean);
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    ensureNameBeforeSend();
    cloudBus.sendTextMessage(activeConvId, text);
    setText('');
  };

  const handleFilesSelected = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    ensureNameBeforeSend();
    const caption = text.trim();
    if (caption) setText('');
    for (let i = 0; i < arr.length; i++) {
      await cloudBus.sendFileMessage(activeConvId, arr[i], i === 0 ? caption : '');
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await handleFilesSelected(files);
    }
  };

  const handleSendVideoInvite = () => {
    ensureNameBeforeSend();
    const roomId = uuidv4().slice(0, 8).toUpperCase();
    cloudBus.sendTextMessage(
      activeConvId,
      `📹 화상 회의를 시작했습니다! 아래 버튼을 누르면 바로 입장됩니다. (회의 ID: ${roomId})`,
      roomId
    );
    onJoinMeetingById?.(roomId);
  };

  const activeConv =
    conversations.find((c) => c.id === activeConvId) || conversations[0];

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <div
      className={`messenger-shell ${embedded ? 'embedded' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          handleFilesSelected(e.dataTransfer.files);
        }
      }}
    >
      {/* Top My Code & Connection Bar */}
      <div className="messenger-topbar">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: isOnline ? '#10b981' : '#f59e0b' }}
          />
          <span className="text-xs font-semibold text-primary">
            내 고유 코드:
          </span>
          <code className="px-2 py-0.5 rounded bg-primary border border-border-color font-mono text-xs font-bold text-blue-400 select-all">
            {myIdentity.userCode}
          </code>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(myIdentity.userCode);
              setCodeCopied(true);
              setTimeout(() => setCodeCopied(false), 1800);
            }}
            className="btn btn-secondary py-1 px-2 text-xs"
          >
            {codeCopied ? '✓ 복사됨' : '코드 복사'}
          </button>
          <span className="text-xs text-muted hidden sm:inline">
            ({getPlatformLabel(myIdentity.platform)})
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMobileShowList(!mobileShowList)}
            className="btn btn-secondary py-1 px-2.5 text-xs sm:hidden"
          >
            {mobileShowList ? '💬 대화창 보기' : `👥 목록 (${onlinePeers.length})`}
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal('dm')}
            className="btn btn-secondary py-1 px-2.5 text-xs"
          >
            + 1:1 코드 추가
          </button>
          <button
            type="button"
            onClick={() => setShowAddModal('room')}
            className="btn btn-secondary py-1 px-2.5 text-xs"
          >
            # 그룹방
          </button>
        </div>
      </div>

      {/* Main Split Body */}
      <div className="messenger-body">
        {/* Left Sidebar: Conversations & Online Users */}
        <aside className={`messenger-sidebar scrollable ${mobileShowList ? 'mobile-open' : ''}`}>
          <div className="p-2.5 border-b border-border-color">
            <div className="text-xs font-semibold text-muted mb-1.5 px-1">대화방 목록</div>
            <div className="space-y-1">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => handleSelectConversation(conv.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition ${
                    conv.id === activeConvId
                      ? 'bg-accent-primary text-white font-semibold'
                      : 'hover:bg-tertiary text-secondary'
                  }`}
                >
                  <span className="truncate">{conv.title}</span>
                  {conv.unreadCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-red-500 text-white font-bold ml-1">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="p-2.5">
            <div className="flex items-center justify-between mb-1.5 px-1">
              <span className="text-xs font-semibold text-muted">
                실시간 접속자 ({onlinePeers.length}명)
              </span>
              <button
                type="button"
                onClick={() => {
                  cloudBus.announcePresence();
                  cloudBus.sendPacket('bridge-presence-ping', 'GLOBAL', {
                    fromCode: myIdentity.userCode,
                  });
                }}
                className="text-[11px] text-blue-400 hover:underline"
              >
                새로고침
              </button>
            </div>

            {onlinePeers.length === 0 ? (
              <p className="text-xs text-muted px-1 py-3 leading-relaxed">
                현재 접속 중인 다른 기기를 찾는 중입니다. 상대방의 고유 코드(예: TB-XXXX)를 추가해 바로 문자를 보낼 수도 있습니다.
              </p>
            ) : (
              <div className="space-y-1">
                {onlinePeers.map((peer) => (
                  <button
                    key={peer.userCode}
                    type="button"
                    onClick={() => handleStartDmWithPeer(peer)}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-tertiary text-left transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                        <span className="text-xs font-medium text-primary truncate">
                          {peer.userName}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted truncate mt-0.5">
                        {peer.userCode} · {getPlatformLabel(peer.platform)}
                      </div>
                    </div>
                    <span className="text-[11px] text-blue-400 ml-1">문자</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Right Chat Area */}
        <section className="messenger-chat-pane">
          {/* Active Conversation Header */}
          <div className="px-3.5 py-2.5 border-b border-border-color flex items-center justify-between bg-secondary/70">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-primary truncate">
                {activeConv?.title || '전체 라운지'}
              </div>
              <div className="text-[11px] text-muted">
                {activeConv?.type === 'dm'
                  ? '1:1 암호화 채널 · 실시간 문자 및 파일 전송'
                  : activeConv?.type === 'room'
                  ? `그룹 코드 ${activeConv.roomCode} 참가자 전용`
                  : 'Toobar를 실행 중인 모든 기기와 문자·파일을 주고받습니다'}
              </div>
            </div>

            {onJoinMeetingById && (
              <button
                type="button"
                onClick={handleSendVideoInvite}
                className="btn btn-primary py-1.5 px-3 text-xs"
                title="이 대화방에 화상회의 초대장을 보내고 바로 시작합니다"
              >
                📹 화상통화 걸기
              </button>
            )}
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 scrollable relative">
            {isDragging && (
              <div className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/80 flex items-center justify-center text-sm font-semibold text-blue-200">
                📂 여기에 파일을 놓으면 즉시 전송됩니다
              </div>
            )}

            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-muted py-8">
                <p className="text-sm font-medium text-secondary">
                  아직 주고받은 메시지가 없습니다
                </p>
                <p className="text-xs mt-1 max-w-xs leading-relaxed">
                  맥북·아이폰·아이패드·윈도우·우분투·안드로이드 사용자들과 실시간으로 문자와 사진·문서·압축파일을 주고받아 보세요!
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.fromCode === myIdentity.userCode;
                const att = msg.attachment;
                const isImage = Boolean(
                  att?.dataUrl && att.mimeType.startsWith('image/')
                );
                const isAudio = Boolean(
                  att?.dataUrl && att.mimeType.startsWith('audio/')
                );
                const isVideo = Boolean(
                  att?.dataUrl && att.mimeType.startsWith('video/')
                );

                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    {!isMine && (
                      <div className="flex items-center gap-1.5 mb-1 px-1">
                        <span className="text-xs font-semibold text-secondary">
                          {msg.fromName}
                        </span>
                        <span className="text-[10px] text-muted font-mono">
                          ({msg.fromCode})
                        </span>
                        <span className="text-[10px] text-muted">
                          {getPlatformLabel(msg.fromPlatform)}
                        </span>
                      </div>
                    )}

                    <div
                      className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${
                        isMine
                          ? 'bg-accent-primary text-white rounded-tr-sm'
                          : 'bg-tertiary text-primary rounded-tl-sm border border-border-color'
                      }`}
                    >
                      {msg.text && (
                        <p className="text-sm whitespace-pre-wrap break-words">
                          {msg.text}
                        </p>
                      )}

                      {msg.meetingInviteId && onJoinMeetingById && (
                        <button
                          type="button"
                          onClick={() => onJoinMeetingById(msg.meetingInviteId!)}
                          className="mt-2 w-full py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow"
                        >
                          🚀 화상회의 바로 입장 ({msg.meetingInviteId})
                        </button>
                      )}

                      {att && (
                        <div className={`${msg.text ? 'mt-2' : ''} space-y-2`}>
                          {isImage && att.dataUrl && (
                            <img
                              src={att.dataUrl}
                              alt={att.name}
                              className="max-h-56 rounded-xl object-contain bg-black/30 cursor-pointer"
                              onClick={() =>
                                saveOrShareFile(att.name, att.dataUrl!, att.mimeType)
                              }
                            />
                          )}

                          {isAudio && att.dataUrl && (
                            <audio controls src={att.dataUrl} className="max-w-full" />
                          )}

                          {isVideo && att.dataUrl && (
                            <video
                              controls
                              playsInline
                              src={att.dataUrl}
                              className="max-h-56 rounded-xl bg-black"
                            />
                          )}

                          <div className="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-black/25">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold truncate">
                                📎 {att.name}
                              </div>
                              <div className="text-[11px] opacity-80">
                                {formatFileSize(att.size)}
                                {!att.isComplete && typeof att.progress === 'number'
                                  ? ` · 전송 중 ${att.progress}%`
                                  : ''}
                              </div>
                              {!att.isComplete && (
                                <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden mt-1">
                                  <div
                                    className="h-full bg-emerald-400 transition-all"
                                    style={{ width: `${att.progress || 0}%` }}
                                  />
                                </div>
                              )}
                            </div>

                            {att.dataUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  saveOrShareFile(att.name, att.dataUrl!, att.mimeType)
                                }
                                className="px-2.5 py-1.5 rounded-lg bg-white text-slate-900 font-semibold text-xs hover:bg-slate-100 flex-shrink-0"
                              >
                                저장/공유
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <span className="text-[10px] text-muted mt-1 px-1">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Composer */}
          <form
            onSubmit={handleSendText}
            className="p-2.5 border-t border-border-color bg-secondary flex items-center gap-2"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleFilesSelected(e.target.files);
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary p-2.5"
              title="파일 · 사진 · 문서 보내기"
              aria-label="파일 보내기"
            >
              📎
            </button>

            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handlePaste}
              placeholder="메시지 입력 또는 파일 드래그/붙여넣기..."
              className="input flex-1 text-sm py-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSendText(e);
                }
              }}
            />

            <button
              type="submit"
              disabled={!text.trim()}
              className="btn btn-primary px-4 py-2 text-sm"
            >
              전송
            </button>
          </form>
        </section>
      </div>

      {/* Add DM or Room Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(null)}>
          <div
            className="modal-content w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-primary mb-1">
              {showAddModal === 'dm'
                ? '상대방 고유 코드로 1:1 대화 시작'
                : '그룹 대화방 만들기 / 참여'}
            </h3>
            <p className="text-xs text-muted mb-4">
              {showAddModal === 'dm'
                ? '상대방 화면 상단에 표시된 TB-XXXX 코드를 입력하세요.'
                : '같은 그룹 이름을 입력한 사람들끼리 문자와 파일을 주고받습니다.'}
            </p>
            <form onSubmit={handleAddDmOrRoom} className="space-y-3">
              <input
                type="text"
                value={targetCodeInput}
                onChange={(e) => setTargetCodeInput(e.target.value)}
                placeholder={showAddModal === 'dm' ? '예: TB-4829' : '예: TEAM-1'}
                className="input w-full font-mono uppercase"
                autoFocus
                required
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(null)}
                  className="btn btn-secondary px-3 py-2 text-xs"
                >
                  취소
                </button>
                <button type="submit" className="btn btn-primary px-4 py-2 text-xs">
                  열기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
