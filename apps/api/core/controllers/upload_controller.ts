import { Controller, Post, Middleware } from '@tekir/http-decorators'
import type { HttpContext } from '@tekir/core'
import { uploadLimiter } from '~/limiters'
import { randomUUID } from 'crypto'
import path from 'path'
import { ApiTag, ApiSummary, ApiResponse, ApiBearerAuth } from '@tekir/swagger-decorators'
import { auth, drive } from '#services'

function buildStoragePath(directory: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace('.', '')
  const unique = randomUUID()
  return `${directory}/${unique}.${ext}`
}

@Controller('/api/upload')
@ApiTag('Uploads')
export default class UploadController {
  /**
   * POST /api/upload/avatar
   * Upload a profile avatar image.
   * Constraints: max 2 MB, jpg/png only.
   */
  @Post('/avatar')
  @ApiSummary('Upload a profile avatar image (jpg/png, max 2 MB)')
  @ApiResponse(201, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          size: { type: 'integer' },
          mimeType: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse(400, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(422, {
    type: 'object',
    properties: { errors: { type: 'array', items: { type: 'object' } } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    uploadLimiter,
  ])
  async avatar(ctx: HttpContext) {
    const file = ctx.file('avatar', { size: '2mb', extnames: ['jpg', 'jpeg', 'png'] })

    if (!file) {
      return ctx.response.badRequest({ message: 'No file uploaded. Send a multipart field named "avatar".' })
    }

    if (file.hasErrors) {
      return ctx.response.unprocessableEntity({ errors: file.errors })
    }

    const storagePath = buildStoragePath('avatars', file.clientName)

    // Move file into the configured drive disk
    await file.moveToDisk(storagePath)

    const url = drive.use('local').getUrl(storagePath)

    return ctx.response.created({
      message: 'Avatar uploaded successfully.',
      data: {
        path: storagePath,
        url,
        size: file.size,
        mimeType: `${file.type}/${file.subtype}`,
      },
    })
  }

  /**
   * POST /api/upload/attachment
   * Upload a generic file attachment.
   * Constraints: max 10 MB.
   */
  @Post('/attachment')
  @ApiSummary('Upload a generic file attachment (max 10 MB)')
  @ApiResponse(201, {
    type: 'object',
    properties: {
      message: { type: 'string' },
      data: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          originalName: { type: 'string' },
          size: { type: 'integer' },
          mimeType: { type: 'string' },
          extension: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse(400, {
    type: 'object',
    properties: { message: { type: 'string' } },
  })
  @ApiResponse(422, {
    type: 'object',
    properties: { errors: { type: 'array', items: { type: 'object' } } },
  })
  @ApiBearerAuth()
  @Middleware([
    auth.middleware(),
    uploadLimiter,
  ])
  async attachment(ctx: HttpContext) {
    const file = ctx.file('attachment', { size: '10mb' })

    if (!file) {
      return ctx.response.badRequest({ message: 'No file uploaded. Send a multipart field named "attachment".' })
    }

    if (file.hasErrors) {
      return ctx.response.unprocessableEntity({ errors: file.errors })
    }

    const storagePath = buildStoragePath('attachments', file.clientName)

    // Move file into the drive
    await file.moveToDisk(storagePath)

    // Retrieve the signed URL valid for 24 hours (86400 seconds)
    const url = await drive.use('local').getSignedUrl(storagePath, { expiresIn: 86400 })

    return ctx.response.created({
      message: 'Attachment uploaded successfully.',
      data: {
        path: storagePath,
        url,
        originalName: file.clientName,
        size: file.size,
        mimeType: `${file.type}/${file.subtype}`,
        extension: file.extname,
      },
    })
  }
}
