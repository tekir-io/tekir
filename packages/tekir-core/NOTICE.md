# Third-party notices

`@tekir/core` adapts portions of [Elysia](https://github.com/elysiajs/elysia)
(MIT, Copyright 2022 saltyAom). The MIT license requires that this notice
travels with any copies or substantial portions of the borrowed code.

## Adapted code

The following implementation details in `src/server/server.ts` are adapted from
Elysia's AOT route compiler:

- The compiled-handler body parser that switches on
  `contentType.charCodeAt(12)` to dispatch JSON / urlencoded / multipart
  branches (Elysia: `src/compose.ts`, ~lines 1020–1040).
- The arrow-function source separator that detects parameter destructuring
  via `charCodeAt(0) === 40` (`(`) and walks until the matching `)` before
  searching for `=>` (Elysia: `src/sucrose.ts`, ~lines 50–90).
- The query-string parser bit flags (`f & 1` / `f & 2` / `f & 4` / `f & 8`)
  and `charCodeAt` switches on `&` (38), `=` (61), `+` (43), `%` (37)
  (Elysia: `src/parse-query.ts`).

The high-level pattern of generating per-route handler source as strings and
compiling it via `new Function(...)` is also inspired by Elysia.

## Elysia license

```
MIT License

Copyright 2022 saltyAom

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```
