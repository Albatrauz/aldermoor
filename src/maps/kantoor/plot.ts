/* ============================ kantoor — the plot ============================ */
// The rectangle the four boundary walls enclose (their inner faces), in game
// metres. The building stands in the middle of it, x −35.6…35, z −35…35: the
// street runs along the south (+Z), the paved yard lies north (−Z), and a
// driveway passes down each side. Outside the building distances are not held to
// the 2.5× of the interior — the street and yard are drawn in a little.
export const PLOT = { x0: -58, x1: 58, z0: -76, z1: 76 };
export const WALL_H = 9;   // boundary walls: nothing inside the plot may let a player over this
