'use client';

import { useEffect, useState } from 'react';
import { chooseViewpoint } from '@/lib/game/viewpoint';
import { isDifficulty, type Difficulty } from '@/lib/game/difficulty';
import { usePlayfield } from '@/components/game/usePlayfield';
import { FieldPanel } from '@/components/game/FieldPanel';
import { MapPanel } from '@/components/game/MapPanel';

export function DevPreview({ seed, difficulty }: { seed: number; difficulty: string }) {
  const d: Difficulty = isDifficulty(difficulty) ? difficulty : 'normal';
  const pf = usePlayfield(d);
  const { ready, loadMap, showView, map } = pf;
  const [info, setInfo] = useState('');
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const t = await loadMap(seed);
      const vp = chooseViewpoint(t);
      showView(vp.token);
      map.current?.setAnswer({ x: vp.x, z: vp.z, bearing: vp.bearing });
      setInfo(`${t.name} · ${t.character} · lakes ${t.lakes.length}${t.dam ? ' · dam' : ''} · falls ${t.falls.length} · token ${vp.token}`);
      document.body.dataset.preview = 'ready';
    })();
  }, [ready, seed, loadMap, showView, map]);
  return (
    <main className="play">
      <p className="eyebrow">Preview seed {seed} · {d}</p>
      <p className="muted">{info}</p>
      <div className="stage">
        <section className="view-area">
          <FieldPanel canvasRef={pf.fieldCanvas} loading={info ? null : 'Surveying'} countdown={null} lookAround={d === 'easy'}
            compass={null} start={pf.vp.current?.bearing ?? null} yaw={pf.yaw} webglError={pf.webglError} />
        </section>
        <section className="map-area">
          <MapPanel canvasRef={pf.mapCanvas} map={pf.map} tool={pf.tool} onTool={pf.setTool} interval={pf.contourInterval}
            readout={null} profile={pf.profile} onCloseProfile={() => pf.setProfile(null)} hint="" />
        </section>
      </div>
    </main>
  );
}
