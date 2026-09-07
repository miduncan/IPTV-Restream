import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

const MIN_USERNAME_LENGTH = 2;
const MAX_USERNAME_LENGTH = 24;

interface UsernameModalProps {
  initialUsername: string;
  isEditing: boolean;
  onCancel: () => void;
  onSave: (username: string) => void;
}

function UsernameModal({ initialUsername, isEditing, onCancel, onSave }: UsernameModalProps) {
  const [value, setValue] = useState(initialUsername);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onCancel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = value.trim();

    if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
      setError(`Use ${MIN_USERNAME_LENGTH}–${MAX_USERNAME_LENGTH} characters.`);
      return;
    }
    if (/\p{Cc}/u.test(username)) {
      setError('Control characters are not allowed.');
      return;
    }

    onSave(username);
  };

  const keepFocusInDialog = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05080B]/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={keepFocusInDialog}
        className="w-full max-w-sm rounded-xl border border-[#304254] bg-[#101A24] shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-[#233242] px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-[-0.02em] text-[#EAF0F6]">
              {isEditing ? 'Change your username' : 'Choose a username'}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-[#91A0AF]">
              This is how you’ll appear in live chat.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close username dialog"
            className="rounded-md p-1 text-[#718396] transition-colors hover:bg-[#1C2D3E] hover:text-[#EAF0F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4EA1FF]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5">
          <label htmlFor="chat-username" className="block text-sm font-medium text-[#B8C5D1]">
            Username
          </label>
          <input
            ref={inputRef}
            id="chat-username"
            className="admin-input mt-2 w-full px-3 py-2.5"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            autoComplete="nickname"
            maxLength={MAX_USERNAME_LENGTH}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'chat-username-error' : 'chat-username-help'}
          />
          {error ? (
            <p id="chat-username-error" role="alert" className="mt-2 text-xs text-[#FF8B8B]">{error}</p>
          ) : (
            <p id="chat-username-help" className="mt-2 text-xs text-[#718396]">2–24 characters</p>
          )}

          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={onCancel} className="admin-secondary px-4 py-2 text-sm">
              Cancel
            </button>
            <button type="submit" className="admin-primary px-4 py-2 text-sm">
              {isEditing ? 'Save username' : 'Start chatting'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default UsernameModal;
