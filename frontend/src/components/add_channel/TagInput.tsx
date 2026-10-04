import { useMemo, useState, type KeyboardEvent } from 'react';
import { Check, Plus, X } from 'lucide-react';

interface TagInputProps {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}

function TagInput({ tags, suggestions, onChange }: TagInputProps) {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const matchingSuggestions = useMemo(() => {
    const query = input.trim().toLocaleLowerCase();
    const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
    return suggestions
      .filter((tag) => !selected.has(tag.toLocaleLowerCase()))
      .filter((tag) => !query || tag.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.localeCompare(right));
  }, [input, suggestions, tags]);

  const normalizedInput = input.trim();
  const canCreate = normalizedInput.length > 0 && ![...tags, ...suggestions]
    .some((tag) => tag.toLocaleLowerCase() === normalizedInput.toLocaleLowerCase());
  const optionCount = matchingSuggestions.length + (canCreate ? 1 : 0);

  const addTag = (value: string) => {
    const suggestedTag = suggestions.find((tag) => tag.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
    const nextTag = (suggestedTag || value).trim();
    if (!nextTag || tags.some((tag) => tag.toLocaleLowerCase() === nextTag.toLocaleLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput('');
    setHighlightedIndex(0);
    setIsOpen(true);
  };

  const removeTag = (tagToRemove: string) => {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && optionCount > 0) {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((index) => (index + 1) % optionCount);
      return;
    }
    if (event.key === 'ArrowUp' && optionCount > 0) {
      event.preventDefault();
      setIsOpen(true);
      setHighlightedIndex((index) => (index - 1 + optionCount) % optionCount);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen && highlightedIndex < matchingSuggestions.length) {
        addTag(matchingSuggestions[highlightedIndex]);
      } else if (normalizedInput) {
        addTag(normalizedInput);
      }
      return;
    }
    if (event.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
      return;
    }
    if (event.key === 'Escape') setIsOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg bg-gray-700 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-blue-500/20 px-2 py-1 text-xs text-blue-200">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-sm text-blue-300 hover:bg-blue-400/20 hover:text-white"
              aria-label={`Remove ${tag} tag`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          id="tags"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setHighlightedIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={handleKeyDown}
          className="min-w-28 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-gray-400"
          placeholder={tags.length === 0 ? 'Type a tag and press Enter' : 'Add another tag'}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen && optionCount > 0}
          aria-controls="tag-suggestions"
        />
      </div>

      {isOpen && optionCount > 0 && (
        <div id="tag-suggestions" role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-gray-600 bg-gray-800 p-1 shadow-xl scroll-container">
          {matchingSuggestions.map((suggestion, index) => (
            <button
              key={suggestion}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => addTag(suggestion)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${highlightedIndex === index ? 'bg-gray-700 text-white' : 'text-gray-200 hover:bg-gray-700'}`}
            >
              <span>{suggestion}</span>
              {highlightedIndex === index && <Check className="h-4 w-4 text-blue-400" />}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={highlightedIndex === matchingSuggestions.length}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(matchingSuggestions.length)}
              onClick={() => addTag(normalizedInput)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${highlightedIndex === matchingSuggestions.length ? 'bg-gray-700 text-white' : 'text-gray-200 hover:bg-gray-700'}`}
            >
              <Plus className="h-4 w-4 text-blue-400" /> Create “{normalizedInput}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default TagInput;
