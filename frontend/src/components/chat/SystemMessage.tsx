import { memo } from 'react';
import { ChatMessage } from '../../types';

export default memo(function SystemMessage({ msg }: {
  msg: ChatMessage;
}) {
  return (
    <article className="min-w-0" aria-label="System message">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-[#8BC3FF]">System</span>
        <time className="text-[0.6875rem] text-[#617386]" dateTime={msg.timestamp}>
          {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </time>
      </div>
      <p className="mt-0.5 break-words text-sm leading-5 text-[#91A0AF]">{msg.message}</p>
    </article>
  );
});
