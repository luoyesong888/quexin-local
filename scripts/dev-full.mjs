// Compatibility entry: use the same managed local runtime.
process.argv[2]='start'
await import('./local-runtime.mjs')
