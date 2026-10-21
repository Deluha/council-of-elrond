import { describe, expect, test } from 'claude-code/testing'

import { CLIENT_OPTIONS, sqlOf } from '../hooks/members/aragorn.js'
import { classify } from '../hooks/rules/classify.js'
import { CONTEXT, SHIPPED_COMPILED } from './fixtures.js'

const sqlFrom = (command: string) => sqlOf(classify({ tool: 'Bash', input: { command } }, SHIPPED_COMPILED, CONTEXT))

describe('Aragorn (database): the SQL a shell call carries', () => {
  test('sqlite3: the second positional is SQL, the first is the database file', () => {
    expect(sqlFrom('sqlite3 app.db "DROP TABLE x"').inline).toEqual([{ label: 'sqlite3 argument', text: 'DROP TABLE x' }])
    expect(sqlFrom('sqlite3 app.db').inline).toEqual([])
    expect(sqlFrom('sqlite3 -readonly -header app.db "select 1"').inline).toEqual([{ label: 'sqlite3 argument', text: 'select 1' }])
  })

  test('sqlite3: -cmd is inline SQL too, and does not shift the positionals', () => {
    expect(sqlFrom('sqlite3 -cmd "DELETE FROM t" app.db').inline).toEqual([{ label: 'sqlite3 -cmd', text: 'DELETE FROM t' }])
    expect(sqlFrom('sqlite3 -cmd ".headers on" app.db "DROP TABLE x"').inline).toEqual([
      { label: 'sqlite3 -cmd', text: '.headers on' },
      { label: 'sqlite3 argument', text: 'DROP TABLE x' },
    ])
  })

  test('sqlite3: the double-dash spelling of each option reads the same', () => {
    expect(sqlFrom('sqlite3 --cmd "DROP TABLE x" app.db').inline).toEqual([{ label: 'sqlite3 --cmd', text: 'DROP TABLE x' }])
    expect(sqlFrom('sqlite3 --separator , app.db "select 1"').inline).toEqual([{ label: 'sqlite3 argument', text: 'select 1' }])
    expect(sqlFrom('sqlite3 --pagecache 4096 10 app.db "select 1"').inline).toEqual([{ label: 'sqlite3 argument', text: 'select 1' }])
    expect(sqlFrom('sqlite3 --init setup.sql app.db').files.map(file => file.word)).toEqual(['setup.sql'])
  })

  test("sqlite3: an option's value is not taken as the database or the SQL", () => {
    expect(sqlFrom('sqlite3 -separator , app.db "DROP TABLE x"').inline).toEqual([{ label: 'sqlite3 argument', text: 'DROP TABLE x' }])
    expect(sqlFrom('sqlite3 -nullvalue NULL -vfs unix app.db "DROP TABLE x"').inline).toEqual([{ label: 'sqlite3 argument', text: 'DROP TABLE x' }])
    // The two-word options take SIZE and N.
    expect(sqlFrom('sqlite3 -pagecache 4096 10 app.db "DROP TABLE x"').inline).toEqual([{ label: 'sqlite3 argument', text: 'DROP TABLE x' }])
    // Only the value is skipped: with no SQL given, nothing is read as SQL.
    expect(sqlFrom('sqlite3 -separator , app.db').inline).toEqual([])
    expect(sqlFrom('sqlite3 -mmap 268435456 app.db').inline).toEqual([])
  })

  test('sqlite3: -init names a file of SQL, which is read as a file and is not the database', () => {
    const found = sqlFrom('sqlite3 -init setup.sql app.db "select 1"')
    expect(found.files.map(file => file.word)).toEqual(['setup.sql'])
    expect(found.inline).toEqual([{ label: 'sqlite3 argument', text: 'select 1' }])
  })

  test('sqlite3: a redirect from a .sql file is still named', () => {
    expect(sqlFrom('sqlite3 app.db < schema.sql').files.map(file => file.word)).toEqual(['schema.sql'])
  })

  test('the other clients are unchanged: only their own options carry SQL', () => {
    expect(sqlFrom('psql -h db -c "DELETE FROM users"').inline).toEqual([{ label: 'psql -c', text: 'DELETE FROM users' }])
    expect(sqlFrom('psql prod "select 1"').inline).toEqual([])
    expect(sqlFrom('mysql -h db app "select 1"').inline).toEqual([])
    for (const [client, options] of Object.entries(CLIENT_OPTIONS)) {
      if (client !== 'sqlite3') expect(options.sqlArgAt, client).toBeUndefined()
    }
  })
})
