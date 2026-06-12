import type { FileValidationOptions } from './types'
import { UploadedFile, parseSize, formatSize } from './uploaded_file'


/**
 * Collection of uploaded files keyed by form field name.
 * Provides helpers to retrieve single or multiple files and apply inline validation.
 *
 * @example
 * ```ts
 * const files = new MultipartFiles()
 * files.add('avatar', uploadedFile)
 * const avatar = files.file('avatar', { size: '2mb', extnames: ['jpg'] })
 * ```
 */
export class MultipartFiles {
  private filesMap = new Map<string, UploadedFile[]>()

  /**
   * Add an uploaded file to the collection under the given field name.
   *
   * @param fieldName - The form field name the file was uploaded under.
   * @param file - The {@link UploadedFile} instance to add.
   */
  add(fieldName: string, file: UploadedFile) {
    if (!this.filesMap.has(fieldName)) this.filesMap.set(fieldName, [])
    const arr = this.filesMap.get(fieldName) as UploadedFile[]
    arr.push(file)
  }

  /**
   * Get a single file by field name. When multiple files exist for the same
   * field, only the first is returned. Optionally applies inline validation
   * for size and extension, resetting any previous errors.
   *
   * @param fieldName - The form field name to look up.
   * @param validation - Optional {@link FileValidationOptions} for size/extension checks.
   * @returns The first {@link UploadedFile} for the field, or `null` if none exists.
   *
   * @example
   * ```ts
   * const avatar = files.file('avatar', { size: '2mb', extnames: ['jpg', 'png'] })
   * if (avatar?.hasErrors) console.log(avatar.errors)
   * ```
   */
  file(fieldName: string, validation?: FileValidationOptions): UploadedFile | null {
    const files = this.filesMap.get(fieldName)
    if (!files || files.length === 0) return null
    const f = files[0]
    if (validation) {
      f.errors = []
      if (validation.size) {
        const maxBytes = parseSize(validation.size)
        if (f.size > maxBytes) {
          f.errors.push({ field: fieldName, rule: 'size', message: `File size ${formatSize(f.size)} exceeds maximum ${formatSize(maxBytes)}` })
        }
      }
      if (validation.extnames?.length && !validation.extnames.includes(f.extname)) {
        f.errors.push({ field: fieldName, rule: 'extname', message: `File extension .${f.extname} is not allowed. Allowed: ${validation.extnames.map(e => `.${e}`).join(', ')}` })
      }
    }
    return f
  }

  /**
   * Get all files uploaded under a field name (for `<input type="file" multiple>`).
   * Optionally applies inline validation for size and extension on each file.
   *
   * @param fieldName - The form field name to look up.
   * @param validation - Optional {@link FileValidationOptions} for size/extension checks.
   * @returns An array of {@link UploadedFile} instances (empty if none exist).
   *
   * @example
   * ```ts
   * const docs = files.files('documents', { size: '5mb', extnames: ['pdf'] })
   * const invalid = docs.filter(d => d.hasErrors)
   * ```
   */
  files(fieldName: string, validation?: FileValidationOptions): UploadedFile[] {
    const files = this.filesMap.get(fieldName) || []
    if (validation) {
      for (const f of files) {
        f.errors = []
        if (validation.size) {
          const maxBytes = parseSize(validation.size)
          if (f.size > maxBytes) {
            f.errors.push({ field: fieldName, rule: 'size', message: `File size ${formatSize(f.size)} exceeds maximum ${formatSize(maxBytes)}` })
          }
        }
        if (validation.extnames?.length && !validation.extnames.includes(f.extname)) {
          f.errors.push({ field: fieldName, rule: 'extname', message: `File extension .${f.extname} is not allowed. Allowed: ${validation.extnames.map(e => `.${e}`).join(', ')}` })
        }
      }
    }
    return files
  }

  /**
   * Check whether any files were uploaded for the given field name.
   *
   * @param fieldName - The form field name to check.
   * @returns `true` if at least one file exists for the field.
   */
  has(fieldName: string): boolean {
    const files = this.filesMap.get(fieldName)
    return !!files && files.length > 0
  }

  /**
   * Get every uploaded file across all fields as a flat array.
   *
   * @returns An array of all {@link UploadedFile} instances.
   */
  all(): UploadedFile[] {
    const all: UploadedFile[] = []
    for (const files of this.filesMap.values()) all.push(...files)
    return all
  }

  /**
   * Get the names of all form fields that have uploaded files.
   *
   * @returns An array of field name strings.
   */
  fields(): string[] {
    return [...this.filesMap.keys()]
  }

  /**
   * The total number of uploaded files across all fields.
   *
   * @returns The file count.
   */
  get count(): number {
    let n = 0
    for (const files of this.filesMap.values()) n += files.length
    return n
  }
}
