import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Channel } from '../types';

interface ChannelChangeModalProps {
  channel: Channel | null;
  onCancel: () => void;
  onConfirm: () => void;
}

function ChannelChangeModal({ channel, onCancel, onConfirm }: ChannelChangeModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!channel) return;

    const previouslyFocusedElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusableElements?.length) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedElement?.focus();
    };
  }, [channel, onCancel]);

  if (!channel) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#05080B]/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="channel-change-title"
        aria-describedby="channel-change-description"
        className="w-full max-w-md overflow-hidden rounded-xl border border-[#304254] bg-[#101A24] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start gap-4 p-5 sm:p-6">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#F4B860]/30 bg-[#F4B860]/10 text-[#F4B860]">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="channel-change-title" className="pr-7 text-lg font-semibold tracking-[-0.01em] text-[#EAF0F6]">
              Change channel for everyone?
            </h2>
            <p id="channel-change-description" className="mt-2 break-words text-sm leading-6 text-[#AEBECC]">
              Switching to <span className="font-semibold text-[#DCE6EF]">{channel.name}</span> will change what is playing for everyone watching right now.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel channel change"
            className="-ml-10 rounded-md p-1.5 text-[#718396] transition-colors hover:bg-[#1C2D3E] hover:text-[#EAF0F6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4EA1FF]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-[#233242] bg-[#0E1720] px-5 py-4 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="admin-secondary px-4 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4EA1FF]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="admin-primary px-4 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4EA1FF]"
          >
            Change channel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ChannelChangeModal;
