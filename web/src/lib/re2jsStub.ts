// Build-time stand-in for the `re2js` package (aliased in vite.config.ts). Firestore 4.18+ imports
// re2js (~140 KB minified) only to evaluate the LIKE / regexContains / regexMatch expressions of
// its Pipelines API, which this app never uses; it wraps every RE2JS.compile() call in try/catch
// and returns an evaluation error on failure. Stubbing it removes ~140 KB from the cloud bundle
// on every first load. If we ever adopt Pipelines with regex/LIKE filters, drop the alias.

export class RE2JS {
  static compile(_pattern: string, _flags?: number): never {
    throw new Error("re2js is not bundled (see web/src/lib/re2jsStub.ts)");
  }
}

export default RE2JS;
