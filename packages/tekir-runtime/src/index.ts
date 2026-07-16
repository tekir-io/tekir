// @tekir/runtime — cross-runtime abstraction layer for Bun and Node.js
// Minimum: Bun 1.0+ or Node.js 22.6.0+

export { detectRuntime, isBun, isNode, runtimeName, runtimeVersion, getRequire, type Runtime } from './detect.js'
export { readFile, readFileText, writeFile, fileResponse, fileSize, fileExists, isDirectory, fileStat, readDir, readDirRecursive } from './file.js'
export { serve, type ServeOptions, type RuntimeServer } from './server.js'
export { hashBcrypt, verifyBcrypt, hashArgon2, verifyArgon2 } from './password.js'
export { openDatabase } from './sqlite.js'
export { spawn, type SpawnOptions, type SpawnResult } from './spawn.js'
export { gc } from './gc.js'
