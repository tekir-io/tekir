export type { FileValidationOptions, BodyParserConfig, FileError } from './types'
export { UploadedFile } from './uploaded_file'
export { MultipartFiles } from './multipart_files'
export { parseMultipart, PayloadTooLargeError } from './parser'
export { bodyParser } from './middleware'
export { BodyParserProvider } from './provider'

import type { UploadedFile } from './uploaded_file'
import type { FileValidationOptions } from './types'

declare module '@tekir/core' {
  interface HttpContext {
    body: Record<string, unknown>
    rawBody: string
    /**
     * Get a single uploaded file by field name. Returns `undefined` when
     * no file was uploaded under that name (or the request was not
     * multipart). Pass an optional validation block for inline size /
     * extension checks; errors land on `file.errors`.
     */
    file: (fieldName: string, validation?: FileValidationOptions) => UploadedFile | undefined
    /**
     * Get every uploaded file under a field name (e.g. for
     * `<input type="file" multiple>`). Returns `[]` when no file was
     * uploaded under that name or the request was not multipart.
     */
    files: (fieldName: string, validation?: FileValidationOptions) => UploadedFile[]
    /**
     * Get every uploaded file across all fields as a flat array. Returns
     * `[]` when nothing was uploaded.
     */
    allFiles: () => UploadedFile[]
  }
}
