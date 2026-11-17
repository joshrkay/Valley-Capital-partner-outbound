'use client';
// The app launcher: every page, grouped and searchable, in a native <dialog>. A client component only to open the dialog and filter the
// list as you type; the list is the static page list in lib/nav.mjs, so it holds no data.
import { useRef, useState } from 'react';
import { launcherGroups } from '../lib/nav.mjs';
import { Icon, Tile } from './icons.jsx';

export function Launcher() {
  const dialog = useRef(null);
  const input = useRef(null);
  const [q, setQ] = useState('');
  const open = () => {
    setQ('');
    const d = dialog.current;
    if (d && !d.open) { try { d.showModal(); } catch { d.setAttribute('open', ''); } }
    input.current?.focus();
  };
  const close = () => dialog.current?.close();
  const groups = launcherGroups(q);
  return (
    <>
      <button type="button" className="icon-btn waffle" aria-label="App launcher" aria-haspopup="dialog" title="App launcher" onClick={open}><Icon name="waffle" /></button>
      <dialog className="modal" ref={dialog} aria-labelledby="launch-title" onClick={(e) => { if (e.target === dialog.current || e.target.closest('a')) close(); }}>
        <div className="modal-head">
          <h2 id="launch-title">App launcher</h2>
          <button type="button" className="icon-btn modal-close" aria-label="Close" onClick={close}><Icon name="close" /></button>
        </div>
        <div className="modal-body">
          <div className="launch-search">
            <Icon name="search" />
            <label className="sr" htmlFor="launch-q">Search pages</label>
            <input ref={input} type="search" id="launch-q" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {groups.length ? groups.map((g) => (
            <section key={g.group} className="launch-sec">
              <h3>{g.group}</h3>
              <div className="launch-grid">
                {g.items.map((it) => (
                  <a key={it.href} className="launch-item" href={it.href}>
                    <Tile icon={it.icon} tone={it.tile} />
                    <span><b>{it.label}</b><small>{it.blurb}</small></span>
                  </a>
                ))}
              </div>
            </section>
          )) : <p className="muted empty">No page matches.</p>}
        </div>
      </dialog>
    </>
  );
}
