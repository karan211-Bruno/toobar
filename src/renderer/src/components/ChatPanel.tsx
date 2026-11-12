// In-Meeting Chat & File Sharing Panel
import React, { useRef, useEffect, useState } from 'react';
import type { ChatMessageItem } from '@shared/types';
import { useAppStore } from '../store';
import { webrtcManager } from '../webrtc';
import { formatFileSize, saveOrShareFile } from '../cloud-bus';

interface ChatPanelProps {
  messages: ChatMessageItem[];
  currentUserId: string;
  currentUserName: string;
}

export function ChatPanel({
  messages,
  currentUserId,
  currentUserName,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sendTo, setSendTo] = useState<'everyone' | string>('everyone');
  const [isDragging, setIsDragging] = useState(false);
  const participants = useAppStore((s) => s.currentMeeting?.participants || []);
  const otherParticipants = participants.filter((p) => p.id !== currentUserId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    webrtcManager.sendChatMessage(newMessage.trim(), sendTo);
    setNewMessage('');
  };

  const handleSendFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const caption = newMessage.trim();
    if (caption) setNewMessage('');
    for (let i = 0; i < arr.length; i++) {
      await webrtcManager.sendChatFile(arr[i], i === 0 ? caption : '', sendTo);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      e.preventDefault();
      await handleSendFiles(pastedFiles);
    }
  };

  const handleExportChatLog = () => {
    if (messages.length === 0) return;
    const lines = messages.map((m) => {
      const t = new Date(m.timestamp).toLocaleString('ko-KR');
      const priv = m.isPrivate ? ' [비공개]' : '';
      const filePart = m.attachment ? ` [첨부파일: ${m.attachment.name}]` : '';
      return `[${t}] ${m.fromName}${priv}: ${m.message}${filePart}`;
    });
    const textBlob = btoa(unescape(encodeURIComponent(lines.join('\n'))));
    saveOrShareFile(
      `Toobar-채팅기록-${new Date().toISOString().slice(0, 10)}.txt`,
      `data:text/plain;base64,${textBlob}`,
      'text/plain'
    );
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      className="flex flex-col h-full bg-secondary relative"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.length) {
          handleSendFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Chat Header */}
      <div className="p-3 border-b border-border-color">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-primary">회의 채팅 및 파일 전송</h3>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={handleExportChatLog}
              className="btn btn-secondary py-1 px-2 text-xs"
              title="대화 내역을 텍스트 파일로 저장합니다"
            >
              💾 기록 저장
            </button>
          )}
        </div>

        {/* Send To Selector */}
        <select
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          className="input w-full text-sm py-2"
        >
          <option value="everyone">모든 참가자에게 보내기</option>
          {otherParticipants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}님에게 1:1 비공개 전송
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 relative" role="log" aria-live="polite">
        {isDragging && (
          <div className="absolute inset-2 z-20 rounded-xl border-2 border-dashed border-blue-400 bg-blue-950/85 flex items-center justify-center text-sm font-semibold text-blue-200">
            📂 여기에 파일을 놓으면 참가자에게 전송됩니다
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted text-sm text-center px-4">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mb-3 opacity-50"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p>아직 채팅이나 공유된 파일이 없습니다</p>
            <p className="text-xs mt-1">
              문자 메시지나 📎 파일·사진을 보내보세요
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.from === currentUserId;
            const att = msg.attachment;
            const isImage = Boolean(att?.dataUrl && att.mimeType.startsWith('image/'));
            const isAudio = Boolean(att?.dataUrl && att.mimeType.startsWith('audio/'));
            const isVideo = Boolean(att?.dataUrl && att.mimeType.startsWith('video/'));

            return (
              <div
                key={msg.id}
                className={`flex gap-2 ${isMine ? 'flex-row-reverse' : ''}`}
              >
                {!isMine && (
                  <div className="avatar avatar-sm flex-shrink-0 bg-tertiary">
                    {msg.fromName.charAt(0).toUpperCase()}
                  </div>
                )}

                <div className={`max-w-[78%] ${isMine ? 'text-right' : 'text-left'}`}>
                  {!isMine && (
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-medium text-secondary">
                        {msg.fromName}
                      </span>
                      {msg.isPrivate && (
                        <span className="badge badge-yellow text-xs">비공개</span>
                      )}
                      <span className="text-xs text-muted">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  )}

                  <div
                    className={`inline-block px-3 py-2 rounded-2xl text-left ${
                      isMine
                        ? 'bg-accent-primary text-white rounded-tr-none'
                        : 'bg-tertiary text-primary rounded-tl-none'
                    }`}
                  >
                    {msg.message && (
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {msg.message}
                      </p>
                    )}

                    {att && (
                      <div className={`${msg.message ? 'mt-2' : ''} space-y-2`}>
                        {isImage && att.dataUrl && (
                          <img
                            src={att.dataUrl}
                            alt={att.name}
                            className="max-h-48 rounded-lg object-contain bg-black/30 cursor-pointer"
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
                            className="max-h-48 rounded-lg bg-black"
                          />
                        )}

                        <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/25">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">
                              📎 {att.name}
                            </div>
                            <div className="text-[11px] opacity-80">
                              {formatFileSize(att.size)}
                              {!att.isComplete && typeof att.progress === 'number'
                                ? ` · ${att.progress}%`
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
                              className="px-2.5 py-1 rounded-lg bg-white text-slate-900 font-semibold text-xs hover:bg-slate-100 flex-shrink-0"
                            >
                              저장
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {isMine && (
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      {msg.isPrivate && (
                        <span className="badge badge-yellow text-xs">비공개</span>
                      )}
                      <span className="text-xs text-muted">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  )}
                </div>

                {isMine && (
                  <div className="avatar avatar-sm flex-shrink-0 bg-accent-primary">
                    {currentUserName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            );
          })
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input & File Attachment */}
      <form onSubmit={handleSend} className="p-3 border-t border-border-color">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              handleSendFiles(e.target.files);
            }
            e.target.value = '';
          }}
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-secondary px-3"
            title="파일 · 사진 보내기"
            aria-label="파일 첨부"
          >
            📎
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onPaste={handlePaste}
            placeholder={
              sendTo === 'everyone'
                ? '메시지 입력 또는 파일 보내기...'
                : '1:1 비공개 메시지 또는 파일...'
            }
            className="input flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend(e);
              }
            }}
            aria-label="채팅 메시지 입력"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="btn btn-primary px-4"
            aria-label="메시지 전송"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
