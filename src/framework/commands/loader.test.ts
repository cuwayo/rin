import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadCommands } from './loader.ts'

test('discovers recursive command modules, excludes other files, and imports in path order', async () => {
    const imported: string[] = []
    const stateKey = `rin-loader-test-${crypto.randomUUID()}`
    Reflect.set(globalThis, stateKey, imported)

    try {
        await withCommandDirectory(
            [
                ['z-last.command.ts', importMarker(stateKey, 'z-last')],
                [
                    'nested/middle.command.ts',
                    importMarker(stateKey, 'nested-middle'),
                ],
                ['a-first.command.ts', importMarker(stateKey, 'a-first')],
                [
                    'excluded.command.test.ts',
                    importMarker(stateKey, 'excluded-test'),
                ],
                [
                    'nested/excluded.command.js',
                    importMarker(stateKey, 'excluded-js'),
                ],
                ['not-a-command.ts', importMarker(stateKey, 'not-a-command')],
            ],
            async (directory) => {
                const commandFiles = await loadCommands(
                    pathToFileURL(directory),
                )

                expect(commandFiles).toEqual([
                    join(directory, 'a-first.command.ts'),
                    join(directory, 'nested/middle.command.ts'),
                    join(directory, 'z-last.command.ts'),
                ])
                expect(imported).toEqual(['a-first', 'nested-middle', 'z-last'])
            },
        )
    } finally {
        Reflect.deleteProperty(globalThis, stateKey)
    }
})

test('rejects a command directory that is not a file URL', async () => {
    await expect(
        loadCommands(new URL('https://example.test/commands/')),
    ).rejects.toThrow('Command directory must be a file URL.')
})

function importMarker(stateKey: string, name: string): string {
    return `globalThis[${JSON.stringify(stateKey)}].push(${JSON.stringify(name)})\n`
}

async function withCommandDirectory(
    files: readonly (readonly [relativePath: string, contents: string])[],
    callback: (directory: string) => Promise<void>,
): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'rin-loader-test-'))

    try {
        for (const [relativePath, contents] of files) {
            const path = join(directory, relativePath)
            await mkdir(dirname(path), { recursive: true })
            await writeFile(path, contents)
        }

        await callback(directory)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
