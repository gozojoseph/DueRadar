import { defineConfig } from "vitest/config";

// The first bearer-token verification in a fresh worker pays a one-off
// cold-start (initial JWKS fetch plus the first Ed25519 key import), which on
// Windows can take 3-6s inside the forked test worker — right at vitest's 5s
// default. 15s keeps genuine hangs detectable without flaking on this warm-up.
export default defineConfig({
  test: {
    testTimeout: 15_000,
  },
});
