/**
 * Validation rules applied to an uploaded file.
 */
export interface FileValidationOptions {
  /** Maximum file size as a human-readable string (`'2mb'`, `'500kb'`) or raw byte count. */
  size?: string | number
  /** Allowed file extensions without the leading dot, e.g. `['jpg', 'png', 'pdf']`. */
  extnames?: string[]
}

export interface BodyParserConfig {
  /**
   * HTTP methods to parse. Default: ['POST', 'PUT', 'PATCH', 'DELETE']
   */
  allowedMethods?: string[]

  /**
   * Allow HTTP method override via the `_method` query parameter
   * (PUT/PATCH/DELETE). Disabled by default: when on, a request can present a
   * mutating method that bypasses method-based protections (e.g. CSRF) unless
   * those run after parsing. Enable only when you understand the implications,
   * and only POST requests are upgraded.
   */
  methodSpoofing?: boolean

  /**
   * Convert empty strings to null across all parsers.
   */
  convertEmptyStringsToNull?: boolean

  /**
   * Trim leading/trailing whitespace from string values across all parsers.
   */
  trimWhitespace?: boolean

  /**
   * JSON parser config (application/json, etc.)
   */
  json?: {
    limit?: string | number        // default '1mb'
    strict?: boolean               // only accept objects/arrays at root, default true
    encoding?: string              // default 'utf-8'
    types?: string[]               // content types to handle
    convertEmptyStringsToNull?: boolean
    trimWhitespace?: boolean
  }

  /**
   * URL-encoded form parser config (application/x-www-form-urlencoded)
   */
  form?: {
    limit?: string | number        // default '1mb'
    encoding?: string              // default 'utf-8'
    types?: string[]               // content types to handle
    queryString?: {
      depth?: number               // default 5
      parameterLimit?: number      // default 1000
      allowDots?: boolean
      arrayLimit?: number
    }
    convertEmptyStringsToNull?: boolean
    trimWhitespace?: boolean
  }

  /**
   * Multipart parser config (multipart/form-data)
   */
  multipart?: {
    maxFileSize?: string | number  // default '8mb'
    maxFiles?: number              // default 20
    maxFields?: number             // max non-file form fields, default 1000
    limit?: string | number        // total request size limit, default '20mb'
    /**
     * Spill a streamed file part to a temp file on disk once it grows past
     * this many bytes, instead of holding it in memory. Keeps memory bounded
     * for large uploads. Default '1mb'. Requires `tmpDir` to be set; without
     * `tmpDir` everything stays in memory (bounded by `maxFileSize`).
     */
    spillThreshold?: string | number
    tmpDir?: string                // default os.tmpdir()
    autoProcess?: boolean | string[]  // true, false, or route patterns
    processManually?: string[]     // route patterns to skip auto-processing
    tmpFileName?: () => string     // custom temp file name generator
    encoding?: string              // default 'utf-8'
    types?: string[]               // content types to handle
    convertEmptyStringsToNull?: boolean
    trimWhitespace?: boolean
  }

  /**
   * Raw parser for custom content types (XML, YAML, etc.)
   */
  raw?: {
    limit?: string | number        // default '1mb'
    encoding?: string              // default 'utf-8'
    types?: string[]               // e.g. ['application/xml', 'text/xml']
  }
}

/**
 * Describes a single validation error on an uploaded file.
 */
export interface FileError {
  /** The form field name the file was uploaded under. */
  field: string
  /** The validation rule that failed (e.g. `'size'`, `'extname'`, `'totalSize'`). */
  rule: string
  /** A human-readable description of the failure. */
  message: string
}
