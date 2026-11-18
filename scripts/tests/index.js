// Entry point for `node --test scripts/tests/`. Since Node 21 that command treats the folder as a
// path to run, not a folder to search, so it loads this file (the folder's index); this file
// loads every *.test.mjs beside it, so one command runs them all.
'use strict'

const { readdirSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

;(async () => {
  const files = readdirSync(__dirname).filter((f) => f.endsWith('.test.mjs')).sort()
  for (const f of files) await import(pathToFileURL(join(__dirname, f)).href)
})()
