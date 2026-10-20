import type { Rng } from './noise';
import type { Character } from './elevation';

const PROPER = [
  'Hollis', 'Cinder', 'Marrow', 'Ellery', 'Quillan', 'Basswood', 'Tarn', 'Copperhead', 'Vesper', 'Granite',
  'Lantern', 'Whitbeck', 'Ostrander', 'Juniper', 'Calder', 'Fennimore', 'Ravel', 'Talus', 'Ashgrove', 'Kettle',
  'Larkin', 'Merriam', 'Pell', 'Sawtooth', 'Thimble', 'Winslow', 'Bracken', 'Crowley', 'Dunmore', 'Garnet',
  'Harlan', 'Isley', 'Kestrel', 'Lowry', 'Mattox', 'Norcross', 'Osprey', 'Pruett', 'Redfern', 'Stillwater',
  'Tamsin', 'Vance', 'Wren', 'Yarrow', 'Alder', 'Bellamy', 'Corwin', 'Dorset', 'Emmet', 'Frost',
];

const QUAD_SUFFIX: Record<Character, string[]> = {
  mountain: ['Ridge', 'Peak', 'Pass', 'Butte', 'Knob', 'Divide', 'Mountain'],
  lakeland: ['Lakes', 'Lake', 'Basin', 'Meadows'],
  coastal: ['Point', 'Bay', 'Head', 'Cove', 'Bluffs'],
  glacial: ['Glacier', 'Icefield', 'Cirque', 'Peak'],
};

export function makeNamer(rng: Rng) {
  const used = new Set<string>();
  const pick = () => {
    for (let i = 0; i < 20; i++) {
      const p = PROPER[Math.floor(rng() * PROPER.length)];
      if (!used.has(p)) { used.add(p); return p; }
    }
    return PROPER[Math.floor(rng() * PROPER.length)];
  };
  const from = (list: string[]) => list[Math.floor(rng() * list.length)];
  return {
    quad: (c: Character) => `${pick()} ${from(QUAD_SUFFIX[c])}`,
    lake: () => (rng() < 0.3 ? `Lake ${pick()}` : `${pick()} Lake`),
    reservoir: () => `${pick()} Reservoir`,
    river: (big: boolean) => `${pick()} ${big ? 'River' : 'Creek'}`,
    sea: () => `${pick()} ${from(['Bay', 'Sound', 'Inlet', 'Bight'])}`,
    falls: () => `${pick()} Falls`,
    dam: (reservoirName: string) => reservoirName.replace('Reservoir', 'Dam'),
  };
}
