'use client';

import { useEffect, useRef, useState } from 'react';

/** Read-only text with a copy button. `path` is resolved against the current origin. */
export function CopyField({ path, label }: { path: string; label: string }) {
  const [value, setValue] = useState(path);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setValue(path.startsWith('/') ? `${window.location.origin}${path}` : path);
  }, [path]);
  const copy = () => {
    const fallback = () => input.current?.select();
    try {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }, fallback);
    } catch {
      fallback();
    }
  };
  return (
    <div className="copy-field">
      <input ref={input} id={`copy-${label.replace(/\W+/g, '-').toLowerCase()}`} aria-label={label} readOnly value={value} onFocus={(e) => e.target.select()} />
      <button className="btn small" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
