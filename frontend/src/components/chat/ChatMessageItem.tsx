import { memo } from 'react';
import { ChatMessage } from '../../types';

const NAME_COLORS = ['#8BC3FF', '#70E0AE', '#E8B86D', '#D5A6FF', '#FF9FA3'];

function colorForName(name: string) {
  const hash = Array.from(name).reduce((value, character) => (
    ((value << 5) - value + character.charCodeAt(0)) | 0
  ), 0);
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

export default memo(function ChatMessageItem({
  msg,
  isCurrentUser,
}: {
  msg: ChatMessage;
  isCurrentUser: boolean;
}) {
  return (
    <article className="min-w-0" aria-label={`Message from ${msg.user.name}`}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className="truncate text-sm font-semibold"
          style={{ color: colorForName(msg.user.name) }}
        >
          {msg.user.name}
        </span>
        {isCurrentUser && (
          <span className="rounded bg-[#4EA1FF]/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-[#8BC3FF]">
            You
          </span>
        )}
        <time className="shrink-0 text-[0.6875rem] text-[#617386]" dateTime={msg.timestamp}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </time>
      </div>
      <p className="mt-0.5 break-words text-sm leading-5 text-[#DCE6EF]">{msg.message}</p>
    </article>
  );
});
