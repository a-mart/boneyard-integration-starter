# Contributing

1. Keep the contract language-agnostic. A change to `docs/contract.md` needs the matching change in
   `contract/boneyard.ts`, the kit check that tests it, and a CHANGELOG entry.
2. Every new kit check needs a test that proves a deliberately broken server fails it
   (see `kit/test/check.test.ts` and `kit/test/raw-server.ts`), and the reference server must still pass.
3. Mark each check `safe` only if it never calls a tool.
4. No real hostnames, credentials, customer data or regulated data anywhere, including fixtures and issues.
5. Code style. `npm run lint` (`scripts/standards.ts`, part of `npm run verify`) enforces: no comments
   in TypeScript (which also rules out type-check suppressions), no `any`, no non-null assertions,
   functions of at most 100 lines and files of at most 600. Review enforces the rest: parse every
   external input (requests, configuration, files, backend responses) with zod.
6. Run `npm run verify` before opening a pull request.
