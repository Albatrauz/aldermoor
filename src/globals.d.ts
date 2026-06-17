// Ambient declarations for browser globals the game touches that aren't part of
// the standard DOM lib. Scaffolding for the staged TS migration — keep this thin
// and prefer real types in the source files over widening things here.
export {};

declare global {
  interface Window {
    // Safari ships AudioContext under a vendor prefix (see src/audio.ts).
    webkitAudioContext: typeof AudioContext;
    // Debug / automated-test hook installed by src/main.ts.
    __town: unknown;
  }
}
