import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Imports every command module in a user-owned directory.
 *
 * Command decorators register their classes as each module is evaluated, so
 * adding a `*.command.ts` file requires no central registry change.
 */
export async function loadCommands(
    commandDirectory: URL,
): Promise<readonly string[]> {
    if (commandDirectory.protocol !== 'file:') {
        throw new Error('Command directory must be a file URL.')
    }

    const directory = fileURLToPath(commandDirectory)
    const commandFiles: string[] = []
    const files = new Bun.Glob('**/*.command.ts').scan({
        cwd: directory,
        absolute: true,
        onlyFiles: true,
    })

    for await (const file of files) {
        commandFiles.push(file)
    }

    commandFiles.sort()
    for (const file of commandFiles) {
        await import(pathToFileURL(file).href)
    }
    return commandFiles
}
