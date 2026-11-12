// Table registry. Both tables share the playfield geometry (and therefore the tuned physics);
// everything the player sees and hears comes from these themes.

export const TABLES = {
  riff: {
    id: 'riff',
    name: 'Riffgewitter',
    layout: { targets: 'ROCK', lanes: 'AMP' },
    audioTheme: 'riff',
    art: 'riff',
    dmd: '--dmd',
    // where lightning comes from / goes to (renderer anchors)
    strikeFrom: ['teslaL', 'teslaR'],
    jets: 'flame',
    figure: 'pinup',
    sfx: { tunnel: 'shriek', kickback: 'kickback', frenzy: 'cheer' },
  },
  rotor: {
    id: 'rotor',
    name: 'Rotorsturm',
    layout: { targets: 'EVAC', lanes: 'SOS' },
    audioTheme: 'rotor',
    art: 'rotor',
    dmd: '--dmd',
    strikeFrom: ['teslaL', 'teslaR'],
    jets: 'smoke',
    figure: 'tower',
    heli: true,
    beams: false,
    sfx: { tunnel: 'radio', kickback: 'winch', frenzy: 'monsoon' },
  },
  alien: {
    id: 'alien',
    name: 'Erdabwehr',
    layout: { targets: 'ERDE', lanes: 'UFO' },
    audioTheme: 'alien',
    art: 'alien',
    dmd: '--dmd',
    strikeFrom: ['teslaL', 'teslaR'],
    jets: 'smoke',
    figure: 'robot',
    beams: true,
    sfx: { tunnel: 'robotLaser', kickback: 'shield', frenzy: 'invasionAlarm' },
  },
};

export const TABLE_IDS = Object.keys(TABLES);
export const tableById = (id) => TABLES[id] || TABLES.riff;
