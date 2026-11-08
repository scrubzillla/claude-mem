// Shop layout: the 5-bay test shop. Shared by the server (spot ids and types) and the 3D client
// (positions). Units are meters. The building spans x -15..15, z -12..0, and its front faces +z
// (the street side). Each spot carries a route out to the main aisle so cars can drive between spots.
export const BAY_W = 4.5;
export const BAY_X0 = -7.5;
export const WALL_H = 5.6;
export const DOOR_W = 3.8;
export const DOOR_H = 4.3;
export const BAY_COUNT = 5;
export const bayX = (i) => BAY_X0 + BAY_W / 2 + BAY_W * i;

const NOSE_IN = Math.PI / 2; // facing -z, into the building
const NOSE_OUT = -Math.PI / 2; // facing +z, toward the street

export const SPOT_DEFS = [
  ...Array.from({ length: BAY_COUNT }, (_, i) => ({
    id: `B${i + 1}`, label: `Bay ${i + 1}`, type: 'bay', bay: i, x: bayX(i), z: -6.2, heading: NOSE_IN, route: [[bayX(i), 5]],
  })),
  ...[-13.4, -11.0, -8.6].map((x, i) => ({
    id: `D${i + 1}`, label: `Drop-off ${i + 1}`, type: 'drop', x, z: 3.4, heading: NOSE_IN, route: [[x, 7.6]],
  })),
  ...[-14, -11, -8, -5, -2, 5, 8, 11, 14].map((x, i) => ({
    id: `P${i + 1}`, label: `Lot P${i + 1}`, type: 'lot', x, z: 14.4, heading: NOSE_OUT, route: [[x, 9.6]],
  })),
  ...[-10, -7, -4, -1, 2].map((z, i) => ({
    id: `S${i + 1}`, label: `Side S${i + 1}`, type: 'side', x: 21.3, z, heading: 0, route: [[16.6, z], [16.6, 6]],
  })),
];

// Cars arrive from the east along the near lane and leave to the west.
export const STREET_IN_DEF = { id: 'IN', x: 70, z: 24.5, heading: Math.PI, route: [[1.5, 24.5], [1.5, 19], [1.5, 9.6]] };
export const STREET_OUT_DEF = { id: 'OUT', x: -70, z: 24.5, heading: Math.PI, route: [[1.5, 24.5], [1.5, 19], [1.5, 9.6]] };
