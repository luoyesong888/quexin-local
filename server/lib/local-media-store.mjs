import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import sharp from 'sharp'

const allowedFormats = new Set(['jpeg', 'png', 'webp'])

export class MediaProcessingError extends Error {
  constructor(message) { super(message); this.name = 'MediaProcessingError' }
}

export class LocalMediaStore {
  constructor(root = process.env.MEDIA_ROOT ?? resolve('.local-data/media')) {
    this.root = resolve(root)
  }

  pathFor(key) {
    const candidate = resolve(this.root, key)
    if (candidate !== this.root && !candidate.startsWith(`${this.root}${sep}`)) throw new MediaProcessingError('媒体路径无效')
    return candidate
  }

  async atomicWrite(key, buffer) {
    const target = this.pathFor(key)
    await mkdir(dirname(target), { recursive: true })
    const temporary = `${target}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }

  async saveImage({ spaceId, mediaId, input }) {
    let metadata
    try {
      metadata = await sharp(input, { limitInputPixels: 40_000_000, animated: false }).metadata()
    } catch { throw new MediaProcessingError('图片无法解析或已经损坏') }
    if (!metadata.format || !allowedFormats.has(metadata.format)) throw new MediaProcessingError('仅支持 JPEG、PNG 或 WebP 图片')
    try {
      const large = await sharp(input, { limitInputPixels: 40_000_000, animated: false })
        .autoOrient().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 }).toBuffer({ resolveWithObject: true })
      const thumbnail = await sharp(input, { limitInputPixels: 40_000_000, animated: false })
        .autoOrient().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 }).toBuffer()
      const prefix = `${spaceId}/${mediaId}`
      const objectKey = `${prefix}/image.webp`, thumbnailKey = `${prefix}/thumbnail.webp`
      await this.atomicWrite(objectKey, large.data)
      try { await this.atomicWrite(thumbnailKey, thumbnail) }
      catch (error) { await rm(this.pathFor(objectKey), { force: true }); throw error }
      return {
        objectKey, thumbnailKey, outputContentType: 'image/webp',
        storedByteSize: large.data.length, width: large.info.width, height: large.info.height,
      }
    } catch (error) {
      if (error instanceof MediaProcessingError) throw error
      throw new MediaProcessingError('图片处理失败，请换一张图片重试')
    }
  }

  async read(key) { return readFile(this.pathFor(key)) }

  async remove(media) {
    await Promise.all([media.objectKey, media.thumbnailKey].filter(Boolean).map(key => rm(this.pathFor(key), { force: true })))
  }
}
