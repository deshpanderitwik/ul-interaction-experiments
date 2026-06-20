// Metro's `require.context` (the same bundler feature expo-router uses to
// discover routes). @types/node declares `require: NodeRequire` but without
// `context`, so we augment the interface with just the shape we use.
interface RequireContext {
  keys(): string[];
  <T = unknown>(id: string): T;
  resolve(id: string): string;
  id: string;
}

interface NodeRequire {
  context(
    directory: string,
    useSubdirectories?: boolean,
    regExp?: RegExp,
  ): RequireContext;
}
