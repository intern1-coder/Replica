import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { API_BASE } from '../config';

export interface AutocompleteProps<T> {
  endpoint: string;
  placeholder: string;
  labelKey: (item: T) => string;
  subLabelKey?: (item: T) => string | undefined;
  onSelect: (item: T | null) => void;
  selectedItem: T | null;
  allowCreate?: boolean;
  onCreateNew?: (searchTerm: string) => void;
  defaultOptions?: T[];
  defaultOptionsTitle?: string;
}

export function SearchableAutocomplete<T extends { id: string }>({
  endpoint,
  placeholder,
  labelKey,
  subLabelKey,
  onSelect,
  selectedItem,
  allowCreate = false,
  onCreateNew,
  defaultOptions = [],
  defaultOptionsTitle
}: AutocompleteProps<T>) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const labelKeyRef = useRef(labelKey);
  labelKeyRef.current = labelKey;

  useEffect(() => {
    if (selectedItem) {
      setQuery(labelKeyRef.current(selectedItem));
    } else {
      setQuery('');
    }
  }, [selectedItem]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    if (query.length < 2) {
      setResults(defaultOptions.length > 0 ? defaultOptions : []);
      setIsLoading(false);
      return;
    }

    if (selectedItem && query === labelKeyRef.current(selectedItem)) {
      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const token = localStorage.getItem('affinity_token');
        const headers: HeadersInit = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(
          `${API_BASE}${endpoint}?q=${encodeURIComponent(query)}`,
          { headers, signal: controller.signal }
        );

        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        if (!controller.signal.aborted) {
          setResults(data.data || []);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        console.error(e);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isOpen, endpoint, selectedItem?.id, defaultOptions]);

  const handleSelect = (item: T) => {
    onSelect(item);
    setQuery(labelKeyRef.current(item));
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(null);
    setQuery('');
    setIsOpen(true);
  };

  const highlightMatch = (text: string, q: string) => {
    if (!q || !text) return text;
    const parts = text.split(new RegExp(`(${q})`, 'gi'));
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase()
            ? <span key={i} className="font-medium text-primary autocomplete-highlight">{part}</span>
            : part
        )}
      </>
    );
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (selectedItem && e.target.value !== labelKeyRef.current(selectedItem)) {
              onSelect(null);
            }
          }}
          onClick={() => setIsOpen(true)}
          placeholder={placeholder}
          style={{
            width: '100%',
            paddingLeft: '2.5rem',
            paddingRight: selectedItem ? '2.5rem' : '1rem',
            borderColor: isOpen ? 'var(--color-brand)' : 'var(--color-border)',
            boxShadow: isOpen ? '0 0 0 2px var(--color-brand-light)' : 'none'
          }}
        />
        <Search size={16} className="text-muted" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />

        {selectedItem && (
          <button
            type="button"
            onClick={handleClear}
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              fontSize: '1.2rem',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              padding: 0
            }}
          >
            &times;
          </button>
        )}
      </div>

      {isOpen && !selectedItem && (query.length >= 2 || defaultOptions.length > 0) && (
        <div className="section-card entering" style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 50,
          marginTop: '4px',
          maxHeight: '300px',
          overflowY: 'auto',
          padding: 0
        }}>
          {isLoading ? (
            <div className="text-muted flex justify-center items-center gap-2" style={{ padding: '1rem' }}>
              <Loader2 size={16} className="spin" /> Searching...
            </div>
          ) : results.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {query.length < 2 && defaultOptionsTitle && results.length > 0 && (
                <li className="font-medium text-secondary" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: 'var(--color-bg)', borderBottom: '1px solid var(--color-border)' }}>
                  {defaultOptionsTitle}
                </li>
              )}
              {results.map(item => (
                <li
                  key={item.id}
                  className="interactive-list-item"
                  style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)' }}
                  onClick={() => handleSelect(item)}
                >
                  <div className="font-medium text-primary">
                    {highlightMatch(labelKeyRef.current(item), query)}
                  </div>
                  {subLabelKey && subLabelKey(item) && (
                    <div className="text-secondary" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                      {highlightMatch(subLabelKey(item)!, query)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : query.length >= 2 ? (
            <div style={{ padding: '1rem', textAlign: 'center' }}>
              <p className="text-muted" style={{ marginBottom: '0.5rem', marginTop: 0 }}>
                No results found for "{query}".
              </p>
              {allowCreate && onCreateNew && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={() => {
                    setIsOpen(false);
                    onCreateNew(query);
                  }}
                >
                  <Plus size={16} /> Create "{query}"
                </button>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
