import { expect, test } from 'bun:test'
import {
    findCommand,
    isCommandGroup,
} from '../../framework/commands/command.decorator.ts'
import './cardinal.command.ts'

test('registers Cardinal administration as a command group', () => {
    const cardinal = findCommand('cardinal')

    expect(cardinal).toBeDefined()
    expect(cardinal && isCommandGroup(cardinal)).toBe(true)
    if (!cardinal || !isCommandGroup(cardinal)) return

    expect(cardinal.aliases).toEqual(['c'])
    expect(cardinal.subcommands.map((command) => command.name)).toEqual([
        'addmod',
        'delmod',
        'mods',
        'console',
        'debug',
    ])
    expect(findCommand('addmod')).toBeUndefined()
    expect(findCommand('console')).toBeUndefined()
})
