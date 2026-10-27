export type Constructable<T> = new (...arguments_: never[]) => T
export type InjectionToken<T> = Constructable<T> | symbol

type DependencyList = readonly InjectionToken<unknown>[]

const dependenciesByType = new WeakMap<Constructable<unknown>, DependencyList>()

/**
 * Marks a class as container-managed and declares its constructor dependencies.
 *
 * TypeScript's standard decorators do not expose runtime parameter types, so
 * dependencies are deliberately explicit and remain safe across minification.
 */
export function Injectable(dependencies: DependencyList = []) {
    return (
        target: Constructable<unknown>,
        _context: ClassDecoratorContext,
    ): void => {
        dependenciesByType.set(target, dependencies)
    }
}

export class Container {
    private readonly values = new Map<InjectionToken<unknown>, unknown>()

    registerValue<T>(token: InjectionToken<T>, value: T): void {
        this.values.set(token, value)
    }

    resolve<T>(token: InjectionToken<T>): T {
        const value = this.values.get(token)
        if (value !== undefined) return value as T

        if (typeof token === 'symbol') {
            throw new Error(
                `No value registered for ${token.description ?? 'anonymous token'}.`,
            )
        }

        const dependencies = dependenciesByType.get(token)
        if (!dependencies) {
            throw new Error(
                `${token.name} is not injectable. Add @Injectable(...) or register a value.`,
            )
        }

        const injectableType = token as unknown as new (
            ...arguments_: unknown[]
        ) => T
        const instance = new injectableType(
            ...dependencies.map((dependency) => this.resolve(dependency)),
        )
        this.values.set(token, instance)
        return instance
    }
}
