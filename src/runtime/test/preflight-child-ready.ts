// This test-only preload runs before the CLI entry and sends no arguments or output.
try { if (typeof process.send === "function") process.send("WHYJ_PREFLIGHT_BUN_READY"); }
catch { /* A missing diagnostic must not change the child command. */ }
